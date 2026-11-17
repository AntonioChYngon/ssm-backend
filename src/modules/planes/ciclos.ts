// HU-04 · Ciclos de acreditación: la Administradora registra la vigencia a mano (decisión D7).
// Sin ciclo VIGENTE, la coordinación no puede capturar su plan: la fecha de cumplimiento depende de esa vigencia.
import { Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { EstadoVersion, Rol } from '../../common/enums';
import { Licenciatura } from '../../database/entities';
import { CicloAcreditacion, Indicador, OrganismoAcreditador, VersionPlan } from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { validarId, validarVigencia } from './reglas';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

/** POST /ciclos y PATCH /ciclos/:cicloId. Todas las fechas las escribe la Administradora (AAAA-MM-DD). */
export class CicloDto {
  @IsString() licenciaturaId: string;
  @IsString() organismoId: string;
  /** Fecha en que el organismo o IEVA emitió la constancia: identifica el ciclo en el histórico. */
  @IsDateString() fechaEmision: string;
  @IsDateString() vigenciaInicio: string;
  @IsDateString() vigenciaFin: string;
  @IsOptional() @IsString() @Length(0, 255) referenciaConstancia?: string;
}

export type CicloResumen = {
  id: string;
  licenciatura: { id: string; nombre: string };
  organismo: { id: string; nombre: string };
  fechaEmision: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  estado: CicloAcreditacion['estado'];
  referenciaConstancia: string | null;
  /** Última versión del plan, o null si la coordinación aún no captura nada. */
  plan: { versionId: string; numero: number; estado: EstadoVersion; recomendaciones: number } | null;
};

// ---------- Servicio ----------

@Injectable()
export class CiclosService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Todos los ciclos con el estado de su plan (vista "Planes de mejora" de la Administradora). */
  async listar(): Promise<CicloResumen[]> {
    const ciclos = await this.db.getRepository(CicloAcreditacion).find({
      relations: { licenciatura: true, organismo: true },
      order: { vigenciaInicio: 'DESC' },
    });
    return this.resumir(this.db.manager, ciclos);
  }

  async crear(admin: UsuarioToken, dto: CicloDto): Promise<CicloResumen> {
    const id = await this.db.transaction(async (tx) => {
      const { licenciatura, organismo } = await this.validar(tx, dto);
      const vigente = await tx.findOneBy(CicloAcreditacion, { licenciaturaId: licenciatura.id, estado: 'VIGENTE' });
      if (vigente) {
        throw new ConflictException(`${licenciatura.nombre} ya tiene un ciclo vigente (${vigente.vigenciaInicio} a ${vigente.vigenciaFin}).`);
      }
      const ciclo = await tx.save(
        tx.create(CicloAcreditacion, {
          licenciaturaId: licenciatura.id,
          organismoId: organismo.id,
          fechaEmision: dto.fechaEmision,
          vigenciaInicio: dto.vigenciaInicio,
          vigenciaFin: dto.vigenciaFin,
          estado: 'VIGENTE',
          referenciaConstancia: dto.referenciaConstancia?.trim() || null,
        }),
      );
      return ciclo.id;
    }).catch(traducirDuplicado);

    await this.auditoria.registrar(admin, {
      entidad: 'ciclo_acreditacion',
      entidadId: id,
      campo: 'alta',
      nuevo: `Vigencia ${dto.vigenciaInicio} a ${dto.vigenciaFin}`,
    });
    return this.obtener(id);
  }

  /** Corrige un ciclo mientras su coordinación no haya capturado nada (después, las fechas del plan dependen de él). */
  async actualizar(admin: UsuarioToken, cicloId: string, dto: CicloDto): Promise<CicloResumen> {
    validarId(cicloId, 'ciclo');
    const anterior = await this.db.transaction(async (tx) => {
      const ciclo = await tx.findOneBy(CicloAcreditacion, { id: cicloId });
      if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');
      if (await tx.existsBy(VersionPlan, { cicloId })) {
        throw new ConflictException('La coordinación ya empezó a capturar su plan; la vigencia ya no se puede cambiar.');
      }
      const { licenciatura, organismo } = await this.validar(tx, dto);
      if (licenciatura.id !== ciclo.licenciaturaId) {
        const vigente = await tx.findOneBy(CicloAcreditacion, { licenciaturaId: licenciatura.id, estado: 'VIGENTE' });
        if (vigente) throw new ConflictException(`${licenciatura.nombre} ya tiene un ciclo vigente.`);
      }
      const antes = `Vigencia ${ciclo.vigenciaInicio} a ${ciclo.vigenciaFin}`;
      await tx.update(CicloAcreditacion, { id: cicloId }, {
        licenciaturaId: licenciatura.id,
        organismoId: organismo.id,
        fechaEmision: dto.fechaEmision,
        vigenciaInicio: dto.vigenciaInicio,
        vigenciaFin: dto.vigenciaFin,
        referenciaConstancia: dto.referenciaConstancia?.trim() || null,
      });
      return antes;
    }).catch(traducirDuplicado);

    await this.auditoria.registrar(admin, {
      entidad: 'ciclo_acreditacion',
      entidadId: cicloId,
      campo: 'vigencia',
      anterior,
      nuevo: `Vigencia ${dto.vigenciaInicio} a ${dto.vigenciaFin}`,
    });
    return this.obtener(cicloId);
  }

  // ---------- Pasos internos ----------

  private async obtener(id: string): Promise<CicloResumen> {
    const ciclo = await this.db.getRepository(CicloAcreditacion).findOne({ where: { id }, relations: { licenciatura: true, organismo: true } });
    if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');
    const [resumen] = await this.resumir(this.db.manager, [ciclo]);
    return resumen;
  }

  private async validar(tx: EntityManager, dto: CicloDto) {
    validarId(dto.licenciaturaId, 'licenciatura');
    validarId(dto.organismoId, 'organismo acreditador');
    validarVigencia(dto);
    const licenciatura = await tx.findOneBy(Licenciatura, { id: dto.licenciaturaId, activa: true });
    if (!licenciatura) throw new NotFoundException('Selecciona una licenciatura del catálogo.');
    const organismo = await tx.findOneBy(OrganismoAcreditador, { id: dto.organismoId, activo: true });
    if (!organismo) throw new NotFoundException('Selecciona un organismo acreditador del catálogo.');
    return { licenciatura, organismo };
  }

  /** Agrega a cada ciclo su última versión de plan y cuántas recomendaciones tiene. */
  private async resumir(manager: EntityManager, ciclos: CicloAcreditacion[]): Promise<CicloResumen[]> {
    if (ciclos.length === 0) return [];
    const versiones = await manager.find(VersionPlan, { where: { cicloId: In(ciclos.map((c) => c.id)) }, order: { numeroVersion: 'DESC' } });
    const ultima = new Map<string, VersionPlan>();
    for (const v of versiones) if (!ultima.has(v.cicloId)) ultima.set(v.cicloId, v);

    const ids = [...ultima.values()].map((v) => v.id);
    const conteos = ids.length
      ? await manager
          .createQueryBuilder(Indicador, 'i')
          .innerJoin('i.recomendaciones', 'r')
          .select('i.versionPlanId', 'version')
          .addSelect('COUNT(r.id)', 'total')
          .where('i.versionPlanId IN (:...ids)', { ids })
          .groupBy('i.versionPlanId')
          .getRawMany<{ version: string; total: string }>()
      : [];
    const porVersion = new Map(conteos.map((c) => [String(c.version), Number(c.total)]));

    return ciclos
      .map((c) => {
        const v = ultima.get(c.id);
        return {
          id: c.id,
          licenciatura: { id: c.licenciatura.id, nombre: c.licenciatura.nombre },
          organismo: { id: c.organismo.id, nombre: c.organismo.nombre },
          fechaEmision: c.fechaEmision,
          vigenciaInicio: c.vigenciaInicio,
          vigenciaFin: c.vigenciaFin,
          estado: c.estado,
          referenciaConstancia: c.referenciaConstancia,
          plan: v ? { versionId: v.id, numero: v.numeroVersion, estado: v.estado, recomendaciones: porVersion.get(v.id) ?? 0 } : null,
        };
      })
      .sort((a, b) => a.licenciatura.nombre.localeCompare(b.licenciatura.nombre, 'es'));
  }
}

/** uq_ciclo_lic_organismo_emision: mismo organismo y misma fecha de emisión para la misma licenciatura. */
const traducirDuplicado = (error: unknown): never => {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
    throw new ConflictException('Ya existe un ciclo de esa licenciatura con el mismo organismo y fecha de emisión.');
  }
  throw error;
};

// ---------- Controlador (solo Administradora) ----------

@ApiTags('HU-04 · Ciclos de acreditación')
@ApiBearerAuth()
@Controller('ciclos')
@Roles(Rol.ADMINISTRADOR)
export class CiclosController {
  constructor(private readonly servicio: CiclosService) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Post()
  crear(@UsuarioActual() admin: UsuarioToken, @Body() dto: CicloDto) {
    return this.servicio.crear(admin, dto);
  }

  @Patch(':cicloId')
  actualizar(@UsuarioActual() admin: UsuarioToken, @Param('cicloId') cicloId: string, @Body() dto: CicloDto) {
    return this.servicio.actualizar(admin, cicloId, dto);
  }
}
