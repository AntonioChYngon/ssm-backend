// HU-04 · Captura del Plan de Mejora Continua.
// Responsable: Jesús. Ver la lista de tareas en CONTRIBUTING.md.
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken, verificarCoordinacion } from '../../common/auth';
import { EstadoVersion, Rol } from '../../common/enums';
import { Coordinacion } from '../../database/entities';
import {
  AccionRecomendacion,
  AreaResponsable,
  Categoria,
  CicloAcreditacion,
  Indicador,
  Meta,
  OrganismoAcreditador,
  Recomendacion,
  VersionPlan,
} from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import {
  esEditable,
  exigirPlanEditable,
  limpiarLista,
  siguienteOrden,
  textoObligatorio,
  validarCatalogo,
  validarCategoriaDelIndicador,
  validarFechaCumplimiento,
  validarId,
} from './reglas';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

export type ItemCatalogo = { id: string; nombre: string };
export type Catalogos = { categorias: ItemCatalogo[]; areas: ItemCatalogo[]; organismos: ItemCatalogo[] };

export class NuevaRecomendacionDto {
  @IsString() categoriaId: string;

  /** Usa un indicador existente del plan, o escribe uno nuevo. */
  @IsOptional() @IsString() indicadorId?: string;
  @ValidateIf((o: NuevaRecomendacionDto) => !o.indicadorId) @IsString() @Length(3, 2000) indicador?: string;

  @IsString() @Length(3, 4000) descripcion: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @Type(() => String) acciones: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @Type(() => String) metas: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) areaIds: string[];
  @IsDateString() fechaCumplimiento: string;
  @IsOptional() @IsString() @Length(0, 80) etiquetaFecha?: string;
}

/** Una recomendación con todo lo que muestra la tabla "Plan de Mejora Continua" (Anexo 1). */
export type RecomendacionPlan = {
  id: string;
  descripcion: string;
  acciones: string[];
  metas: string[];
  areas: ItemCatalogo[];
  fechaCumplimiento: string;
  etiquetaFecha: string | null;
};

export type IndicadorPlan = {
  id: string;
  clave: string | null;
  descripcion: string;
  categoria: ItemCatalogo;
  recomendaciones: RecomendacionPlan[];
};

/** GET /mi-plan y GET /ciclos/:cicloId/plan. `version` es null si el ciclo aún no tiene plan. */
export type PlanDeMejora = {
  cicloId: string;
  licenciatura: string;
  organismo: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  version: { id: string; numero: number; estado: EstadoVersion; editable: boolean } | null;
  indicadores: IndicadorPlan[];
};

// ---------- Conversión de entidades al contrato ----------

const porOrden = <T extends { orden: number }>(lista: T[] = []) => [...lista].sort((a, b) => a.orden - b.orden);

const aRecomendacionPlan = (r: Recomendacion): RecomendacionPlan => ({
  id: r.id,
  descripcion: r.descripcion,
  acciones: porOrden(r.acciones).map((a) => a.descripcion),
  metas: porOrden(r.metas).map((m) => m.descripcion),
  areas: (r.areas ?? []).map((a) => ({ id: a.id, nombre: a.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  fechaCumplimiento: r.fechaCumplimiento,
  etiquetaFecha: r.etiquetaFecha,
});

export const aPlanDeMejora = (ciclo: CicloAcreditacion, version: VersionPlan | null): PlanDeMejora => ({
  cicloId: ciclo.id,
  licenciatura: ciclo.licenciatura.nombre,
  organismo: ciclo.organismo.nombre,
  vigenciaInicio: ciclo.vigenciaInicio,
  vigenciaFin: ciclo.vigenciaFin,
  version: version && { id: version.id, numero: version.numeroVersion, estado: version.estado, editable: esEditable(version.estado) },
  // Anexo 1: por categoría (orden del catálogo) y luego por indicador.
  indicadores: [...(version?.indicadores ?? [])]
    .sort((a, b) => a.categoria.orden - b.categoria.orden || a.orden - b.orden)
    .map((i) => ({
      id: i.id,
      clave: i.clave,
      descripcion: i.descripcion,
      categoria: { id: i.categoria.id, nombre: i.categoria.nombre },
      recomendaciones: porOrden(i.recomendaciones).map(aRecomendacionPlan),
    })),
});

// ---------- Servicio ----------

@Injectable()
export class PlanesService {
  constructor(
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(AreaResponsable) private readonly areas: Repository<AreaResponsable>,
    @InjectRepository(OrganismoAcreditador) private readonly organismos: Repository<OrganismoAcreditador>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Catálogos para los selectores del formulario. */
  async catalogos(): Promise<Catalogos> {
    const [categorias, areas, organismos] = await Promise.all([
      this.categorias.find({ where: { activa: true }, order: { orden: 'ASC' } }),
      this.areas.find({ where: { activa: true }, order: { nombre: 'ASC' } }),
      this.organismos.find({ where: { activo: true }, order: { nombre: 'ASC' } }),
    ]);
    const item = (x: { id: string; nombre: string }) => ({ id: x.id, nombre: x.nombre });
    return { categorias: categorias.map(item), areas: areas.map(item), organismos: organismos.map(item) };
  }

  /** Plan del ciclo VIGENTE de la licenciatura del usuario (Captura y Auxiliar). */
  async miPlan(usuario: UsuarioToken): Promise<PlanDeMejora> {
    if (!usuario.licenciaturaId) throw new NotFoundException('Tu cuenta no está asignada a una licenciatura.');
    const ciclo = await this.db.getRepository(CicloAcreditacion).findOne({
      where: { licenciaturaId: usuario.licenciaturaId, estado: 'VIGENTE' },
      order: { vigenciaInicio: 'DESC' },
    });
    if (!ciclo) throw new NotFoundException('Tu licenciatura no tiene un ciclo de acreditación vigente.');
    return this.planDelCiclo(usuario, ciclo.id);
  }

  /** Última versión del plan de un ciclo, con indicadores → recomendaciones → acciones, metas y áreas. */
  async planDelCiclo(usuario: UsuarioToken, cicloId: string): Promise<PlanDeMejora> {
    const ciclo = await this.cicloAutorizado(this.db.manager, usuario, cicloId);
    const version = await this.db.getRepository(VersionPlan).findOne({
      where: { cicloId: ciclo.id },
      order: { numeroVersion: 'DESC' },
      relations: {
        indicadores: { categoria: true, recomendaciones: { acciones: true, metas: true, areas: true } },
      },
    });
    return aPlanDeMejora(ciclo, version);
  }

  /**
   * Agrega una recomendación completa al plan, en una sola transacción.
   * Si el ciclo aún no tiene plan, crea la versión 1 en BORRADOR.
   */
  async agregarRecomendacion(usuario: UsuarioToken, cicloId: string, dto: NuevaRecomendacionDto): Promise<RecomendacionPlan> {
    const resultado = await this.db.transaction(async (tx) => {
      // Bloquear el ciclo serializa las capturas simultáneas (Captura y Auxiliar a la vez).
      const ciclo = await this.cicloAutorizado(tx, usuario, cicloId, true);
      if (ciclo.estado !== 'VIGENTE') throw new BadRequestException('El ciclo de acreditación ya no está vigente.');

      const { version, creada } = await this.versionEditable(tx, ciclo.id, usuario);

      const categoria = await this.categoriaValida(tx, dto.categoriaId);
      validarFechaCumplimiento(dto.fechaCumplimiento, ciclo.vigenciaInicio, ciclo.vigenciaFin);
      const acciones = limpiarLista(dto.acciones, 'acción');
      const metas = limpiarLista(dto.metas, 'meta');
      const areas = await this.areasValidas(tx, dto.areaIds);
      const descripcion = textoObligatorio(dto.descripcion, 'la recomendación');
      const etiquetaFecha = dto.etiquetaFecha?.trim() || null;

      const indicador = await this.indicadorParaRecomendacion(tx, version.id, categoria.id, dto);

      const ordenes = await tx.find(Recomendacion, { where: { indicadorId: indicador.id }, select: { orden: true } });
      const recomendacion = await tx.save(
        tx.create(Recomendacion, {
          indicadorId: indicador.id,
          descripcion,
          fechaCumplimiento: dto.fechaCumplimiento,
          etiquetaFecha,
          orden: siguienteOrden(ordenes.map((r) => r.orden)),
          transversal: false,
        }),
      );
      await tx.insert(AccionRecomendacion, acciones.map((texto, i) => ({ recomendacionId: recomendacion.id, descripcion: texto, orden: i + 1 })));
      await tx.insert(Meta, metas.map((texto, i) => ({ recomendacionId: recomendacion.id, descripcion: texto, orden: i + 1 })));
      await tx.createQueryBuilder().relation(Recomendacion, 'areas').of(recomendacion.id).add(areas.map((a) => a.id));

      const respuesta: RecomendacionPlan = {
        id: recomendacion.id,
        descripcion,
        acciones,
        metas,
        areas: areas.map((a) => ({ id: a.id, nombre: a.nombre })),
        fechaCumplimiento: dto.fechaCumplimiento,
        etiquetaFecha,
      };
      return { respuesta, version, versionCreada: creada, indicador };
    });

    // La auditoría se escribe después del commit: si la transacción falla, no queda un registro falso.
    if (resultado.versionCreada) {
      await this.auditoria.registrar(usuario, {
        entidad: 'version_plan',
        entidadId: resultado.version.id,
        campo: 'alta',
        nuevo: `Versión ${resultado.version.numeroVersion} (${EstadoVersion.BORRADOR}) del ciclo ${cicloId}`,
      });
    }
    await this.auditoria.registrar(usuario, {
      entidad: 'recomendacion',
      entidadId: resultado.respuesta.id,
      campo: 'alta',
      nuevo: `Indicador ${resultado.indicador.id}: ${resultado.respuesta.descripcion.slice(0, 200)}`,
    });
    return resultado.respuesta;
  }

  // ---------- Pasos internos ----------

  /** Busca el ciclo y verifica que el usuario pertenezca a la coordinación de esa licenciatura. */
  private async cicloAutorizado(manager: EntityManager, usuario: UsuarioToken, cicloId: string, bloquear = false) {
    validarId(cicloId, 'ciclo');
    const consulta = manager
      .createQueryBuilder(CicloAcreditacion, 'c')
      .innerJoinAndSelect('c.licenciatura', 'l')
      .innerJoinAndSelect('c.organismo', 'o')
      .where('c.id = :cicloId', { cicloId });
    if (bloquear) consulta.setLock('pessimistic_write');
    const ciclo = await consulta.getOne();
    if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');

    if (usuario.rol !== Rol.ADMINISTRADOR) {
      const coordinacion = await manager.findOneBy(Coordinacion, { licenciaturaId: ciclo.licenciaturaId });
      verificarCoordinacion(usuario, coordinacion?.id ?? '');
    }
    return ciclo;
  }

  /** Última versión del plan si se puede editar; si no hay ninguna, crea la versión 1. */
  private async versionEditable(tx: EntityManager, cicloId: string, usuario: UsuarioToken) {
    const ultima = await tx.findOne(VersionPlan, { where: { cicloId }, order: { numeroVersion: 'DESC' } });
    if (ultima) {
      exigirPlanEditable(ultima.estado);
      return { version: ultima, creada: false };
    }
    const nueva = await tx.save(
      tx.create(VersionPlan, { cicloId, numeroVersion: 1, estado: EstadoVersion.BORRADOR, creadoPor: usuario.sub }),
    );
    return { version: nueva, creada: true };
  }

  private async categoriaValida(tx: EntityManager, categoriaId: string) {
    const activas = await tx.find(Categoria, { where: { activa: true } });
    const [id] = validarCatalogo([categoriaId], new Set(activas.map((c) => c.id)), 'la categoría');
    return activas.find((c) => c.id === id)!;
  }

  private async areasValidas(tx: EntityManager, areaIds: string[]) {
    const solicitadas = areaIds.map((id) => id.trim()).filter((id) => /^\d{1,19}$/.test(id));
    const activas = solicitadas.length ? await tx.find(AreaResponsable, { where: { id: In(solicitadas), activa: true } }) : [];
    const ids = validarCatalogo(areaIds, new Set(activas.map((a) => a.id)), 'el área responsable');
    return ids.map((id) => activas.find((a) => a.id === id)!);
  }

  /** Reutiliza un indicador del mismo plan (misma categoría) o crea uno nuevo al final. */
  private async indicadorParaRecomendacion(tx: EntityManager, versionPlanId: string, categoriaId: string, dto: NuevaRecomendacionDto) {
    if (dto.indicadorId) {
      validarId(dto.indicadorId, 'indicador');
      const existente = await tx.findOneBy(Indicador, { id: dto.indicadorId, versionPlanId });
      if (!existente) throw new NotFoundException('Ese indicador no pertenece a este plan.');
      validarCategoriaDelIndicador(existente.categoriaId, categoriaId);
      return existente;
    }
    const ordenes = await tx.find(Indicador, { where: { versionPlanId }, select: { orden: true } });
    return tx.save(
      tx.create(Indicador, {
        versionPlanId,
        categoriaId,
        clave: null,
        descripcion: textoObligatorio(dto.indicador, 'el indicador'),
        orden: siguienteOrden(ordenes.map((i) => i.orden)),
      }),
    );
  }
}

// ---------- Controlador ----------

@ApiTags('HU-04 · Plan de mejora')
@ApiBearerAuth()
@Controller()
export class PlanesController {
  constructor(private readonly servicio: PlanesService) {}

  @Get('catalogos')
  catalogos() {
    return this.servicio.catalogos();
  }

  /** El frontend de Captura/Auxiliar no conoce su cicloId: lo obtiene aquí. */
  @Get('mi-plan')
  @Roles(Rol.CAPTURA, Rol.AUXILIAR)
  miPlan(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.miPlan(usuario);
  }

  @Get('ciclos/:cicloId/plan')
  plan(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string) {
    return this.servicio.planDelCiclo(usuario, cicloId);
  }

  @Post('ciclos/:cicloId/plan/recomendaciones')
  @Roles(Rol.CAPTURA, Rol.AUXILIAR)
  agregar(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string, @Body() dto: NuevaRecomendacionDto) {
    return this.servicio.agregarRecomendacion(usuario, cicloId, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Categoria, AreaResponsable, OrganismoAcreditador])],
  controllers: [PlanesController],
  providers: [PlanesService],
})
export class PlanesModule {}
