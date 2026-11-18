// HU-04 · Captura del Plan de Mejora · HU-05 · Validación · HU-12 · Configuración de Metas.
// Ver la lista de tareas en CONTRIBUTING.md.
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { EstadoVersion, Rol } from '../../common/enums';
import {
  AccionRecomendacion,
  AreaResponsable,
  AvanceRecomendacion,
  Categoria,
  CicloAcreditacion,
  HitoAvance,
  Indicador,
  Meta,
  ObservacionPlan,
  OrganismoAcreditador,
  Recomendacion,
  RevisionPlan,
  VersionPlan,
} from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { NotificacionesService } from '../notificaciones/notificaciones.module';
import {
  claveTexto,
  esEditable,
  inicioHitos,
  limpiarListaOpcional,
  validarEnvio,
  validarFechaCumplimiento,
  validarMetas,
  verificarTransicion,
} from './reglas';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

export type ItemCatalogo = { id: string; nombre: string };
export type Catalogos = { categorias: ItemCatalogo[]; areas: ItemCatalogo[]; organismos: ItemCatalogo[] };

export type PlanResumen = {
  id: string;
  cicloId: string;
  licenciatura: string;
  organismo: string;
  ciclo: string;
  recomendaciones: number;
  avance: number;
  estado: EstadoVersion;
  actualizado: string;
};

export type MetaPlan = { id: string; descripcion: string; fechaCompromiso: string | null; porcentajeEsperado: number | null };

export type RecomendacionPlan = {
  id: string;
  numero: number;
  categoriaId: string;
  categoria: string;
  indicador: string;
  descripcion: string;
  acciones: string[];
  metas: MetaPlan[];
  areaResponsable: string | null;
  fechaCumplimiento: string | null;
  /** Observación del Administrador en la última devolución. */
  observacion: string | null;
};

export type RevisionResumen = { decision: 'APROBADO' | 'DEVUELTO'; comentario: string | null; revisor: string; fecha: string };

export type PlanDetalle = PlanResumen & {
  vigenciaInicio: string;
  vigenciaFin: string;
  editable: boolean;
  recomendacionesDetalle: RecomendacionPlan[];
  ultimaRevision: RevisionResumen | null;
};

export type CicloResumen = { id: string; licenciatura: string; organismo: string; vigenciaInicio: string; vigenciaFin: string };
export type MiPlan = { ciclo: CicloResumen; plan: PlanDetalle | null };

/** "Guardar borrador": Categoría, Indicador y Recomendación son obligatorios; el resto se exige al enviar. */
export class RecomendacionDto {
  @IsString() categoriaId: string;
  @IsString() @Length(3, 2000) indicador: string;
  @IsString() @Length(3, 4000) descripcion: string;
  /** Acciones para atender la recomendación. */
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(4000, { each: true }) acciones?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(2000, { each: true }) metas?: string[];
  @IsOptional() @IsString() @MaxLength(250) areaResponsable?: string;
  @IsOptional() @IsDateString({ strict: true }) fechaCumplimiento?: string;
}

export class MetaConfigDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(1, 2000) descripcion: string;
  @IsDateString({ strict: true }) fechaCompromiso: string;
  @IsInt() @Min(1) @Max(99) porcentajeEsperado: number;
}

export class GuardarMetasDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MetaConfigDto) metas: MetaConfigDto[];
}

export class ValidarPlanDto {
  @IsOptional() @IsString() @MaxLength(4000) comentario?: string;
}

export class ObservacionDto {
  @IsString() recomendacionId: string;
  @IsString() @Length(1, 4000) comentario: string;
}

export class DevolverPlanDto {
  @IsString() @Length(5, 4000) motivo: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ObservacionDto) observaciones?: ObservacionDto[];
}

// ---------- Utilidades ----------

const fechaCorta = (fecha: Date | null | undefined) =>
  fecha ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' }).format(fecha) : '—';

const ultimaFecha = (v: VersionPlan) => [v.aprobadoEn, v.enviadoEn, v.creadoEn].filter((f): f is Date => Boolean(f)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

const etiquetaCiclo = (c: CicloAcreditacion) => `${c.vigenciaInicio.slice(0, 4)}–${c.vigenciaFin.slice(0, 4)}`;

const nombreOrganismo = (o: OrganismoAcreditador) => o.siglas ?? o.nombre;

/** Captura y Auxiliar solo ven su licenciatura; el Administrador ve todas. */
const verificarLicenciatura = (usuario: UsuarioToken, licenciaturaId: string) => {
  if (usuario.rol !== Rol.ADMINISTRADOR && usuario.licenciaturaId !== licenciaturaId) {
    throw new ForbiddenException('Solo puedes consultar los planes de tu licenciatura.');
  }
};

// ---------- Servicio ----------

@Injectable()
export class PlanesService {
  constructor(
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(AreaResponsable) private readonly areas: Repository<AreaResponsable>,
    @InjectRepository(OrganismoAcreditador) private readonly organismos: Repository<OrganismoAcreditador>,
    @InjectRepository(CicloAcreditacion) private readonly ciclos: Repository<CicloAcreditacion>,
    @InjectRepository(VersionPlan) private readonly versiones: Repository<VersionPlan>,
    @InjectRepository(Recomendacion) private readonly recomendaciones: Repository<Recomendacion>,
    @InjectRepository(RevisionPlan) private readonly revisiones: Repository<RevisionPlan>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesService,
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

  // ----- Consultas -----

  /** Planes con su estado actual: el Administrador ve todos (incluidos borradores); Captura y Auxiliar, los de su licenciatura. */
  async listar(usuario: UsuarioToken): Promise<PlanResumen[]> {
    const q = this.versiones
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.ciclo', 'c')
      .innerJoinAndSelect('c.licenciatura', 'l')
      .innerJoinAndSelect('c.organismo', 'o')
      // Solo la versión más reciente de cada ciclo.
      .where('v.numeroVersion = (SELECT MAX(v2.numero_version) FROM version_plan v2 WHERE v2.ciclo_id = v.ciclo_id)');
    if (usuario.rol !== Rol.ADMINISTRADOR) q.andWhere('c.licenciaturaId = :lic', { lic: usuario.licenciaturaId ?? '0' });
    const versiones = await q.getMany();
    const totales = await this.totalesPorVersion(versiones.map((v) => v.id));
    return versiones
      .map((v) => this.resumen(v, totales.get(v.id)))
      .sort((a, b) => (a.licenciatura.localeCompare(b.licenciatura, 'es') || b.ciclo.localeCompare(a.ciclo)));
  }

  /** Detalle de un plan con sus recomendaciones y metas. También alimenta la Configuración de Metas. */
  async obtener(usuario: UsuarioToken, versionId: string): Promise<PlanDetalle> {
    const version = await this.versiones.findOne({ where: { id: versionId }, relations: { ciclo: { licenciatura: true, organismo: true } } });
    if (!version) throw new NotFoundException('Plan de mejora no encontrado.');
    verificarLicenciatura(usuario, version.ciclo.licenciaturaId);
    return this.detalle(version);
  }

  /** Ciclo vigente de la licenciatura del usuario y su plan (null si aún no se captura nada). */
  async miPlan(usuario: UsuarioToken): Promise<MiPlan> {
    const ciclo = await this.cicloVigente(usuario);
    const version = await this.versiones.findOne({ where: { cicloId: ciclo.id }, order: { numeroVersion: 'DESC' }, relations: { ciclo: { licenciatura: true, organismo: true } } });
    return {
      ciclo: { id: ciclo.id, licenciatura: ciclo.licenciatura.nombre, organismo: nombreOrganismo(ciclo.organismo), vigenciaInicio: ciclo.vigenciaInicio, vigenciaFin: ciclo.vigenciaFin },
      plan: version ? await this.detalle(version) : null,
    };
  }

  // ----- Captura (Guardar borrador) -----

  /** Agrega (o, con recomendacionId, actualiza) una recomendación. Si el ciclo no tiene plan, crea la versión 1 en BORRADOR. */
  async guardarRecomendacion(usuario: UsuarioToken, cicloId: string, dto: RecomendacionDto, recomendacionId?: string): Promise<PlanDetalle> {
    const ciclo = await this.ciclos.findOneBy({ id: cicloId });
    if (!ciclo) throw new NotFoundException('Ciclo de acreditación no encontrado.');
    verificarLicenciatura(usuario, ciclo.licenciaturaId);
    if (ciclo.estado !== 'VIGENTE') throw new ConflictException('Solo se captura el plan de un ciclo vigente.');
    if (!(await this.categorias.existsBy({ id: dto.categoriaId, activa: true }))) throw new NotFoundException('La categoría no existe.');
    if (dto.fechaCumplimiento) validarFechaCumplimiento(dto.fechaCumplimiento, ciclo.vigenciaInicio, ciclo.vigenciaFin);

    const { versionId, recId, creada } = await this.dataSource.transaction(async (tx) => {
      let version = await tx.findOne(VersionPlan, { where: { cicloId }, order: { numeroVersion: 'DESC' }, lock: { mode: 'pessimistic_write' } });
      if (!version) {
        version = await tx.save(tx.create(VersionPlan, { cicloId, numeroVersion: 1, estado: EstadoVersion.BORRADOR, creadoPor: usuario.sub, enviadoEn: null, aprobadoEn: null }));
      }
      verificarTransicion(version.estado, 'editar');
      const indicador = await this.indicadorPara(tx, version.id, dto.categoriaId, dto.indicador);

      const datos = {
        descripcion: dto.descripcion.trim(),
        areaResponsable: dto.areaResponsable?.trim() || null,
        fechaCumplimiento: dto.fechaCumplimiento || null,
      };
      let rec: Recomendacion;
      if (recomendacionId) {
        rec = await this.recomendacionDeVersion(tx, recomendacionId, version.id);
        const anterior = rec.indicadorId;
        const cambios: Partial<Recomendacion> = { ...datos };
        if (anterior !== indicador.id) Object.assign(cambios, { indicadorId: indicador.id, orden: await this.siguienteOrden(tx, 'recomendacion', 'indicador_id', indicador.id) });
        await tx.update(Recomendacion, rec.id, cambios);
        if (anterior !== indicador.id) await this.borrarIndicadorSiVacio(tx, anterior);
      } else {
        rec = await tx.save(tx.create(Recomendacion, { ...datos, indicadorId: indicador.id, etiquetaFecha: null, transversal: false, orden: await this.siguienteOrden(tx, 'recomendacion', 'indicador_id', indicador.id) }));
      }
      await this.reemplazarAcciones(tx, rec.id, limpiarListaOpcional(dto.acciones));
      await this.sincronizarMetas(tx, rec.id, limpiarListaOpcional(dto.metas));
      return { versionId: version.id, recId: rec.id, creada: !recomendacionId };
    });

    await this.auditoria.registrar(usuario, {
      entidad: 'recomendacion',
      entidadId: recId,
      campo: creada ? 'creada (borrador)' : 'actualizada (borrador)',
      nuevo: dto.descripcion.slice(0, 250),
    });
    return this.obtener(usuario, versionId);
  }

  /** Actualiza una recomendación existente: el ciclo se toma de su plan. */
  async actualizarRecomendacion(usuario: UsuarioToken, recomendacionId: string, dto: RecomendacionDto): Promise<PlanDetalle> {
    const rec = await this.recomendaciones.findOne({ where: { id: recomendacionId }, relations: { indicador: { versionPlan: true } } });
    if (!rec) throw new NotFoundException('Recomendación no encontrada.');
    return this.guardarRecomendacion(usuario, rec.indicador.versionPlan.cicloId, dto, recomendacionId);
  }

  async eliminarRecomendacion(usuario: UsuarioToken, recomendacionId: string): Promise<PlanDetalle> {
    const rec = await this.recomendaciones.findOne({ where: { id: recomendacionId }, relations: { indicador: { versionPlan: { ciclo: true } } } });
    if (!rec) throw new NotFoundException('Recomendación no encontrada.');
    const version = rec.indicador.versionPlan;
    verificarLicenciatura(usuario, version.ciclo.licenciaturaId);
    verificarTransicion(version.estado, 'editar');

    await this.dataSource.transaction(async (tx) => {
      if (await tx.existsBy(AvanceRecomendacion, { recomendacionId })) {
        throw new ConflictException('La recomendación ya tiene avances registrados y no se puede eliminar.');
      }
      await tx.delete(AccionRecomendacion, { recomendacionId });
      await tx.delete(Meta, { recomendacionId });
      await tx.delete(HitoAvance, { recomendacionId });
      await tx.query('DELETE FROM recomendacion_area WHERE recomendacion_id = ?', [recomendacionId]);
      await tx.query('DELETE FROM recomendacion_transversal WHERE recomendacion_id = ?', [recomendacionId]);
      // Conserva el historial de observaciones sin la referencia a la recomendación eliminada.
      await tx.update(ObservacionPlan, { recomendacionId }, { recomendacionId: null });
      await tx.delete(Recomendacion, { id: recomendacionId });
      await this.borrarIndicadorSiVacio(tx, rec.indicadorId);
    });
    await this.auditoria.registrar(usuario, { entidad: 'recomendacion', entidadId: recomendacionId, campo: 'eliminada', anterior: rec.descripcion.slice(0, 250) });
    return this.obtener(usuario, version.id);
  }

  // ----- Flujo de validación -----

  /** "Enviar a validación": revisa que el plan esté completo, lo pasa a EN_REVISION y avisa a los Administradores. */
  async enviar(usuario: UsuarioToken, versionId: string): Promise<PlanDetalle> {
    const version = await this.versionConCiclo(versionId);
    verificarLicenciatura(usuario, version.ciclo.licenciaturaId);
    verificarTransicion(version.estado, 'enviar');
    const plan = await this.detalle(version);
    validarEnvio(
      plan.recomendacionesDetalle.map((r) => ({
        numero: r.numero,
        acciones: r.acciones.length,
        metas: r.metas.length,
        // HU-12: solo cuentan como hito las metas que ya tienen fecha y % esperado.
        metasConfiguradas: r.metas.filter((m) => m.fechaCompromiso && m.porcentajeEsperado != null).length,
        areaResponsable: r.areaResponsable,
        fechaCumplimiento: r.fechaCumplimiento,
      })),
      version.ciclo.vigenciaInicio,
      version.ciclo.vigenciaFin,
    );
    await this.cambiarEstado(version, EstadoVersion.EN_REVISION, { enviadoEn: new Date() });
    await this.auditoria.registrar(usuario, { entidad: 'version_plan', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.EN_REVISION });
    await this.notificaciones.notificarAdministradores({
      tipo: 'PLAN_ENVIADO',
      titulo: 'Plan de mejora por validar',
      mensaje: `${version.ciclo.licenciatura.nombre} envió su plan de mejora ${etiquetaCiclo(version.ciclo)} a validación.`,
    });
    return this.obtener(usuario, versionId);
  }

  /** El Administrador valida: el plan queda bloqueado para edición. */
  async validar(admin: UsuarioToken, versionId: string, dto: ValidarPlanDto): Promise<PlanDetalle> {
    const version = await this.versionConCiclo(versionId);
    verificarTransicion(version.estado, 'validar');
    await this.dataSource.transaction(async (tx) => {
      await tx.insert(RevisionPlan, { versionPlanId: version.id, revisorId: admin.sub, decision: 'APROBADO', comentarioGeneral: dto.comentario?.trim() || null });
      await this.cambiarEstado(version, EstadoVersion.APROBADO, { aprobadoEn: new Date() }, tx);
    });
    await this.auditoria.registrar(admin, { entidad: 'version_plan', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.APROBADO });
    await this.notificaciones.notificarLicenciatura(version.ciclo.licenciaturaId, {
      tipo: 'PLAN_VALIDADO',
      titulo: 'Plan de mejora validado',
      mensaje: `La Administración validó el plan de mejora ${etiquetaCiclo(version.ciclo)}.`,
    });
    return this.obtener(admin, versionId);
  }

  /** El Administrador devuelve con un motivo general y, opcionalmente, observaciones por recomendación. */
  async devolver(admin: UsuarioToken, versionId: string, dto: DevolverPlanDto): Promise<PlanDetalle> {
    const version = await this.versionConCiclo(versionId);
    verificarTransicion(version.estado, 'devolver');
    const observaciones = (dto.observaciones ?? []).filter((o) => o.comentario.trim());
    const propias = new Set((await this.detalle(version)).recomendacionesDetalle.map((r) => r.id));
    if (observaciones.some((o) => !propias.has(o.recomendacionId))) {
      throw new NotFoundException('Una observación apunta a una recomendación que no es de este plan.');
    }
    await this.dataSource.transaction(async (tx) => {
      const revision = await tx.save(tx.create(RevisionPlan, { versionPlanId: version.id, revisorId: admin.sub, decision: 'DEVUELTO', comentarioGeneral: dto.motivo.trim() }));
      if (observaciones.length) {
        await tx.insert(ObservacionPlan, observaciones.map((o) => ({ revisionPlanId: revision.id, recomendacionId: o.recomendacionId, comentario: o.comentario.trim() })));
      }
      await this.cambiarEstado(version, EstadoVersion.DEVUELTO, {}, tx);
    });
    await this.auditoria.registrar(admin, { entidad: 'version_plan', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.DEVUELTO });
    await this.notificaciones.notificarLicenciatura(version.ciclo.licenciaturaId, {
      tipo: 'PLAN_DEVUELTO',
      titulo: 'Plan de mejora devuelto',
      mensaje: `La Administración devolvió tu plan con ${observaciones.length} observación(es): ${dto.motivo.trim().slice(0, 300)}`,
    });
    return this.obtener(admin, versionId);
  }

  // ----- Configuración de Metas -----

  /** Reemplaza las metas de una recomendación con su fecha compromiso y % esperado. */
  async guardarMetas(usuario: UsuarioToken, recomendacionId: string, dto: GuardarMetasDto): Promise<PlanDetalle> {
    const rec = await this.recomendaciones.findOne({ where: { id: recomendacionId }, relations: { indicador: { versionPlan: { ciclo: true } } } });
    if (!rec) throw new NotFoundException('Recomendación no encontrada.');
    const version = rec.indicador.versionPlan;
    verificarLicenciatura(usuario, version.ciclo.licenciaturaId);
    verificarTransicion(version.estado, 'editar');
    const metas = dto.metas.map((m) => ({ ...m, descripcion: m.descripcion.trim() }));
    validarMetas(metas, inicioHitos(version.creadoEn, version.ciclo.vigenciaInicio), rec.fechaCumplimiento ?? version.ciclo.vigenciaFin);

    await this.dataSource.transaction(async (tx) => {
      const actuales = await tx.find(Meta, { where: { recomendacionId } });
      const ids = new Set(actuales.map((m) => m.id));
      if (metas.some((m) => m.id && !ids.has(m.id))) throw new NotFoundException('Una meta no pertenece a esta recomendación.');
      const conservadas = new Set(metas.filter((m) => m.id).map((m) => m.id as string));
      const borrar = actuales.filter((m) => !conservadas.has(m.id)).map((m) => m.id);
      if (borrar.length) await tx.delete(Meta, { id: In(borrar) });
      // Dos pasos para no chocar con UNIQUE (recomendacion_id, orden) y (recomendacion_id, fecha_compromiso).
      for (const [i, id] of [...conservadas].entries()) await tx.update(Meta, id, { orden: 10_000 + i, fechaCompromiso: null });
      for (const [i, m] of metas.entries()) {
        const valores = { descripcion: m.descripcion, fechaCompromiso: m.fechaCompromiso, porcentajeEsperado: m.porcentajeEsperado, orden: i + 1 };
        if (m.id) await tx.update(Meta, m.id, valores);
        else await tx.insert(Meta, { ...valores, recomendacionId });
      }
    });
    await this.auditoria.registrar(usuario, { entidad: 'recomendacion', entidadId: recomendacionId, campo: 'metas configuradas', nuevo: `${metas.length} meta(s)` });
    return this.obtener(usuario, version.id);
  }

  // ----- Ayudantes -----

  private async cicloVigente(usuario: UsuarioToken) {
    if (!usuario.licenciaturaId) throw new ForbiddenException('Tu cuenta no tiene una licenciatura asignada.');
    const ciclo = await this.ciclos.findOne({
      where: { licenciaturaId: usuario.licenciaturaId, estado: 'VIGENTE' },
      relations: { licenciatura: true, organismo: true },
      order: { vigenciaInicio: 'DESC' },
    });
    if (!ciclo) throw new NotFoundException('Tu licenciatura no tiene un ciclo de acreditación vigente. Pide a la Administración que lo registre.');
    return ciclo;
  }

  private async versionConCiclo(versionId: string) {
    const version = await this.versiones.findOne({ where: { id: versionId }, relations: { ciclo: { licenciatura: true, organismo: true } } });
    if (!version) throw new NotFoundException('Plan de mejora no encontrado.');
    return version;
  }

  private async cambiarEstado(version: VersionPlan, estado: EstadoVersion, extra: Partial<VersionPlan>, tx?: EntityManager) {
    const repo = tx ? tx.getRepository(VersionPlan) : this.versiones;
    // Condición sobre el estado anterior para evitar dobles envíos o validaciones simultáneas.
    const r = await repo.update({ id: version.id, estado: version.estado }, { estado, ...extra });
    if (!r.affected) throw new ConflictException('El plan cambió de estado mientras tanto. Recarga la página.');
  }

  /** Reutiliza el indicador del plan con la misma categoría y texto; si no existe, lo crea. */
  private async indicadorPara(tx: EntityManager, versionPlanId: string, categoriaId: string, texto: string) {
    const existentes = await tx.find(Indicador, { where: { versionPlanId, categoriaId } });
    const clave = claveTexto(texto);
    const igual = existentes.find((i) => claveTexto(i.descripcion) === clave);
    if (igual) return igual;
    return tx.save(tx.create(Indicador, { versionPlanId, categoriaId, clave: null, descripcion: texto.trim(), orden: await this.siguienteOrden(tx, 'indicador', 'version_plan_id', versionPlanId) }));
  }

  /** Siguiente `orden` libre de indicadores (por plan) o recomendaciones (por indicador). Tabla y columna son constantes. */
  private async siguienteOrden(tx: EntityManager, tabla: 'indicador' | 'recomendacion', columna: 'version_plan_id' | 'indicador_id', valor: string) {
    const [fila]: Array<{ max: string | number }> = await tx.query(`SELECT COALESCE(MAX(orden), 0) AS max FROM ${tabla} WHERE ${columna} = ?`, [valor]);
    return Number(fila?.max ?? 0) + 1;
  }

  private async borrarIndicadorSiVacio(tx: EntityManager, indicadorId: string) {
    if (!(await tx.existsBy(Recomendacion, { indicadorId }))) await tx.delete(Indicador, { id: indicadorId });
  }

  private async recomendacionDeVersion(tx: EntityManager, id: string, versionPlanId: string) {
    const rec = await tx.findOne(Recomendacion, { where: { id }, relations: { indicador: true } });
    if (!rec || rec.indicador.versionPlanId !== versionPlanId) throw new NotFoundException('La recomendación no pertenece al plan de este ciclo.');
    return rec;
  }

  private async reemplazarAcciones(tx: EntityManager, recomendacionId: string, acciones: string[]) {
    await tx.delete(AccionRecomendacion, { recomendacionId });
    if (acciones.length) await tx.insert(AccionRecomendacion, acciones.map((descripcion, i) => ({ recomendacionId, descripcion, orden: i + 1 })));
  }

  /**
   * Sincroniza las metas escritas en el formulario sin perder su configuración (fecha y %):
   * primero empareja por texto idéntico, luego reutiliza las restantes en orden y borra o crea las demás.
   */
  private async sincronizarMetas(tx: EntityManager, recomendacionId: string, descripciones: string[]) {
    const actuales = await tx.find(Meta, { where: { recomendacionId }, order: { orden: 'ASC' } });
    const libres = [...actuales];
    const asignadas: (Meta | null)[] = descripciones.map((d) => {
      const i = libres.findIndex((m) => claveTexto(m.descripcion) === claveTexto(d));
      return i >= 0 ? libres.splice(i, 1)[0]! : null;
    });
    asignadas.forEach((m, i) => {
      if (!m && libres.length) asignadas[i] = libres.shift()!;
    });
    if (libres.length) await tx.delete(Meta, { id: In(libres.map((m) => m.id)) });
    const conservadas = asignadas.filter((m): m is Meta => m !== null);
    for (const [i, m] of conservadas.entries()) await tx.update(Meta, m.id, { orden: 10_000 + i });
    for (const [i, descripcion] of descripciones.entries()) {
      const meta = asignadas[i];
      if (meta) await tx.update(Meta, meta.id, { descripcion, orden: i + 1 });
      else await tx.insert(Meta, { recomendacionId, descripcion, orden: i + 1, fechaCompromiso: null, porcentajeEsperado: null });
    }
  }

  /** Número de recomendaciones y avance promedio (último % registrado por recomendación) de cada versión. */
  private async totalesPorVersion(ids: string[]) {
    const mapa = new Map<string, { recomendaciones: number; avance: number }>();
    if (!ids.length) return mapa;
    const filas: Array<{ id: string; total: string | number; avance: string | number | null }> = await this.dataSource.query(
      `SELECT i.version_plan_id AS id, COUNT(r.recomendacion_id) AS total, AVG(COALESCE(x.porcentaje, 0)) AS avance
       FROM indicador i
       JOIN recomendacion r ON r.indicador_id = i.indicador_id
       LEFT JOIN (SELECT recomendacion_id, MAX(porcentaje) AS porcentaje FROM avance_recomendacion GROUP BY recomendacion_id) x
         ON x.recomendacion_id = r.recomendacion_id
       WHERE i.version_plan_id IN (?)
       GROUP BY i.version_plan_id`,
      [ids],
    );
    filas.forEach((f) => mapa.set(String(f.id), { recomendaciones: Number(f.total), avance: Math.round(Number(f.avance ?? 0)) }));
    return mapa;
  }

  private resumen(v: VersionPlan, totales?: { recomendaciones: number; avance: number }): PlanResumen {
    return {
      id: v.id,
      cicloId: v.cicloId,
      licenciatura: v.ciclo.licenciatura.nombre,
      organismo: nombreOrganismo(v.ciclo.organismo),
      ciclo: etiquetaCiclo(v.ciclo),
      recomendaciones: totales?.recomendaciones ?? 0,
      avance: totales?.avance ?? 0,
      estado: v.estado,
      actualizado: fechaCorta(ultimaFecha(v)),
    };
  }

  private async detalle(version: VersionPlan): Promise<PlanDetalle> {
    const indicadores = await this.dataSource.getRepository(Indicador).find({
      where: { versionPlanId: version.id },
      relations: { categoria: true, recomendaciones: { acciones: true, metas: true } },
      order: { orden: 'ASC', recomendaciones: { orden: 'ASC', acciones: { orden: 'ASC' }, metas: { orden: 'ASC' } } },
    });
    const revision = await this.revisiones.findOne({
      where: { versionPlanId: version.id },
      relations: { revisor: true, observaciones: true },
      order: { id: 'DESC' },
    });
    const observacionDe = new Map<string, string>();
    if (revision?.decision === 'DEVUELTO') {
      revision.observaciones.filter((o) => o.recomendacionId).forEach((o) => observacionDe.set(o.recomendacionId as string, o.comentario));
    }

    let numero = 0;
    const recomendacionesDetalle: RecomendacionPlan[] = indicadores.flatMap((ind) =>
      ind.recomendaciones.map((r) => ({
        id: r.id,
        numero: ++numero,
        categoriaId: ind.categoriaId,
        categoria: ind.categoria.nombre,
        indicador: ind.descripcion,
        descripcion: r.descripcion,
        acciones: r.acciones.map((a) => a.descripcion),
        metas: r.metas.map((m) => ({ id: m.id, descripcion: m.descripcion, fechaCompromiso: m.fechaCompromiso, porcentajeEsperado: m.porcentajeEsperado })),
        areaResponsable: r.areaResponsable,
        fechaCumplimiento: r.fechaCumplimiento,
        observacion: observacionDe.get(r.id) ?? null,
      })),
    );
    const totales = await this.totalesPorVersion([version.id]);
    return {
      ...this.resumen(version, totales.get(version.id)),
      vigenciaInicio: version.ciclo.vigenciaInicio,
      vigenciaFin: version.ciclo.vigenciaFin,
      editable: esEditable(version.estado),
      recomendacionesDetalle,
      ultimaRevision: revision
        ? {
            decision: revision.decision,
            comentario: revision.comentarioGeneral,
            revisor: `${revision.revisor.nombre} ${revision.revisor.apellido}`,
            fecha: fechaCorta(revision.revisadoEn),
          }
        : null,
    };
  }
}

// ---------- Controlador ----------

const CAPTURA = [Rol.CAPTURA, Rol.AUXILIAR];

@ApiTags('HU-04 · Plan de mejora')
@ApiBearerAuth()
@Controller()
export class PlanesController {
  constructor(private readonly servicio: PlanesService) {}

  @Get('catalogos')
  catalogos() {
    return this.servicio.catalogos();
  }

  /** Dashboard y selector de la Configuración de Metas. */
  @Get('planes')
  listar(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.listar(usuario);
  }

  @Get('planes/mio')
  @Roles(...CAPTURA)
  miPlan(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.miPlan(usuario);
  }

  @Get('planes/:id')
  obtener(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.servicio.obtener(usuario, id);
  }

  /** Guardar borrador: nueva recomendación. */
  @Post('ciclos/:cicloId/plan/recomendaciones')
  @Roles(...CAPTURA)
  agregar(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string, @Body() dto: RecomendacionDto) {
    return this.servicio.guardarRecomendacion(usuario, cicloId, dto);
  }

  /** Guardar borrador: recomendación existente. */
  @Put('recomendaciones/:id')
  @Roles(...CAPTURA)
  actualizar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: RecomendacionDto) {
    return this.servicio.actualizarRecomendacion(usuario, id, dto);
  }

  @Delete('recomendaciones/:id')
  @Roles(...CAPTURA)
  eliminar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.servicio.eliminarRecomendacion(usuario, id);
  }

  @Put('recomendaciones/:id/metas')
  @Roles(...CAPTURA)
  guardarMetas(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: GuardarMetasDto) {
    return this.servicio.guardarMetas(usuario, id, dto);
  }

  @Post('planes/:id/enviar')
  @HttpCode(200)
  @Roles(...CAPTURA)
  enviar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.servicio.enviar(usuario, id);
  }

  @Post('planes/:id/validar')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  validar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: ValidarPlanDto) {
    return this.servicio.validar(usuario, id, dto);
  }

  @Post('planes/:id/devolver')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  devolver(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: DevolverPlanDto) {
    return this.servicio.devolver(usuario, id, dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Categoria, AreaResponsable, OrganismoAcreditador, CicloAcreditacion, VersionPlan, Recomendacion, RevisionPlan]),
  ],
  controllers: [PlanesController],
  providers: [PlanesService],
})
export class PlanesModule {}
