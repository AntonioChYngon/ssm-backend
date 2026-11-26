// HU-18 · Gestión de la vigencia del ciclo de acreditación y su carpeta de evidencias.
// Un ciclo por licenciatura, con su organismo o IEVA y una vigencia de hasta 5 años que escribe la Administradora.
// Al crearlo se genera la carpeta /Evidencias/[Licenciatura]/[nombre]/. Solo puede haber un ciclo activo por
// licenciatura; al terminar su vigencia se bloquea la captura y, al iniciar el siguiente, el anterior pasa a HISTORICO.
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { leerLicenciaturaIds } from '../../common/licenciaturas';
import { EstadoVersion, Rol } from '../../common/enums';
import { Licenciatura } from '../../database/entities';
import { CicloAcreditacion, Indicador, OrganismoAcreditador, VersionPlan } from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { ProveedorCarpetas } from './carpetas';
import { cicloActivo, hoyEnMexico, nombreCiclo, rutaCarpetaCiclo, validarId, validarVigencia } from './reglas';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

/** POST /ciclos y PATCH /ciclos/:cicloId. Fechas AAAA-MM-DD escritas por la Administradora. */
export class CicloDto {
  @IsString() licenciaturaId: string;
  @IsString() organismoId: string;
  /** Opcional: si se deja vacío se usa "AAAA-AAAA" con los años de la vigencia. */
  @IsOptional() @IsString() @Length(0, 40) nombre?: string;
  /** Fecha en que el organismo o IEVA emitió la constancia: identifica el ciclo en el histórico (HU-16). */
  @IsDateString() fechaEmision: string;
  @IsDateString() vigenciaInicio: string;
  @IsDateString() vigenciaFin: string;
  @IsOptional() @IsString() @Length(0, 255) referenciaConstancia?: string;
}

export type CicloAdministracion = {
  id: string;
  nombre: string;
  licenciatura: { id: string; nombre: string };
  organismo: { id: string; nombre: string };
  fechaEmision: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  estado: CicloAcreditacion['estado'];
  /** VIGENTE y sin pasar su fecha de fin: se puede capturar plan, avances y evidencias. */
  activo: boolean;
  referenciaConstancia: string | null;
  carpeta: { ruta: string; url: string | null } | null;
  /** Última versión del plan, o null si la coordinación aún no captura nada. */
  plan: { versionId: string; numero: number; estado: EstadoVersion; recomendaciones: number } | null;
};

const vigenciaTexto = (c: { vigenciaInicio: string; vigenciaFin: string }) => `Vigencia ${c.vigenciaInicio} a ${c.vigenciaFin}`;

// ---------- Servicio ----------

@Injectable()
export class CiclosService {
  private readonly logger = new Logger(CiclosService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly carpetas: ProveedorCarpetas,
  ) {}

  /** Todos los ciclos (vigentes e históricos) con el estado de su plan. */
  async listar(licenciaturaIds?: string[]): Promise<CicloAdministracion[]> {
    const ciclos = await this.db.getRepository(CicloAcreditacion).find({
      // HU-13: una, varias o todas las licenciaturas.
      where: licenciaturaIds?.length ? { licenciaturaId: In(licenciaturaIds) } : {},
      relations: { licenciatura: true, organismo: true },
    });
    return this.resumir(this.db.manager, ciclos);
  }

  /** "Iniciar nuevo ciclo": valida, archiva el anterior si ya terminó y crea la carpeta de evidencias. */
  async crear(admin: UsuarioToken, dto: CicloDto): Promise<CicloAdministracion> {
    const hoy = hoyEnMexico();
    const { id, archivado } = await this.db
      .transaction(async (tx) => {
        const { licenciatura, organismo, nombre } = await this.validar(tx, dto);
        // Un ciclo cuya vigencia ya terminó se registra directo como histórico (consulta de HU-16).
        const estado = dto.vigenciaFin < hoy ? 'HISTORICO' : 'VIGENTE';
        let archivado: CicloAcreditacion | null = null;
        if (estado === 'VIGENTE') {
          const anterior = await tx.findOne(CicloAcreditacion, { where: { licenciaturaId: licenciatura.id, estado: 'VIGENTE' }, lock: { mode: 'pessimistic_write' } });
          if (anterior && cicloActivo(anterior, hoy)) {
            throw new ConflictException(
              `${licenciatura.nombre} tiene activo el ciclo ${anterior.nombre} hasta el ${anterior.vigenciaFin}. Podrás iniciar uno nuevo cuando termine.`,
            );
          }
          if (anterior) {
            await tx.update(CicloAcreditacion, { id: anterior.id }, { estado: 'HISTORICO' });
            archivado = anterior;
          }
        }
        const ciclo = await tx.save(
          tx.create(CicloAcreditacion, {
            licenciaturaId: licenciatura.id,
            organismoId: organismo.id,
            nombre,
            fechaEmision: dto.fechaEmision,
            vigenciaInicio: dto.vigenciaInicio,
            vigenciaFin: dto.vigenciaFin,
            estado,
            referenciaConstancia: dto.referenciaConstancia?.trim() || null,
            carpetaRuta: null,
            carpetaUrl: null,
          }),
        );
        // Dentro de la transacción: si la carpeta no se puede crear, el ciclo tampoco se guarda.
        await this.crearCarpeta(tx, ciclo.id, licenciatura.nombre, nombre);
        return { id: ciclo.id, archivado };
      })
      .catch(traducirDuplicado);

    if (archivado) {
      await this.auditoria.registrar(admin, { entidad: 'ciclo_acreditacion', entidadId: archivado.id, campo: 'estado', anterior: 'VIGENTE', nuevo: 'HISTORICO' });
    }
    await this.auditoria.registrar(admin, { entidad: 'ciclo_acreditacion', entidadId: id, campo: 'alta', nuevo: `${dto.nombre?.trim() || ''} ${vigenciaTexto(dto)}`.trim() });
    return this.obtener(id);
  }

  /** Corrige un ciclo mientras su coordinación no haya capturado nada; la licenciatura no cambia. */
  async actualizar(admin: UsuarioToken, cicloId: string, dto: CicloDto): Promise<CicloAdministracion> {
    validarId(cicloId, 'ciclo');
    const hoy = hoyEnMexico();
    const anterior = await this.db
      .transaction(async (tx) => {
        const ciclo = await tx.findOne(CicloAcreditacion, { where: { id: cicloId }, relations: { licenciatura: true } });
        if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');
        if (dto.licenciaturaId !== ciclo.licenciaturaId) {
          throw new ConflictException('La licenciatura de un ciclo no se puede cambiar. Registra un ciclo nuevo para la otra licenciatura.');
        }
        if (await tx.existsBy(VersionPlan, { cicloId })) {
          throw new ConflictException('La coordinación ya empezó a capturar su plan; la vigencia ya no se puede cambiar.');
        }
        const { organismo, nombre } = await this.validar(tx, dto);
        const antes = `${ciclo.nombre} ${vigenciaTexto(ciclo)}`;
        await tx.update(CicloAcreditacion, { id: cicloId }, {
          organismoId: organismo.id,
          nombre,
          fechaEmision: dto.fechaEmision,
          vigenciaInicio: dto.vigenciaInicio,
          vigenciaFin: dto.vigenciaFin,
          estado: dto.vigenciaFin < hoy ? 'HISTORICO' : 'VIGENTE',
          referenciaConstancia: dto.referenciaConstancia?.trim() || null,
        });
        // Con otro nombre se crea su carpeta; la anterior (vacía) se conserva: nunca se borran carpetas.
        if (nombre !== ciclo.nombre || !ciclo.carpetaRuta) await this.crearCarpeta(tx, cicloId, ciclo.licenciatura.nombre, nombre);
        return antes;
      })
      .catch(traducirDuplicado);

    await this.auditoria.registrar(admin, { entidad: 'ciclo_acreditacion', entidadId: cicloId, campo: 'vigencia', anterior, nuevo: `${dto.nombre?.trim() || ''} ${vigenciaTexto(dto)}`.trim() });
    return this.obtener(cicloId);
  }

  /** Crea (o vuelve a crear) la carpeta de un ciclo que no la tiene, p. ej. los registrados antes de HU-18. */
  async asegurarCarpeta(admin: UsuarioToken, cicloId: string): Promise<CicloAdministracion> {
    validarId(cicloId, 'ciclo');
    const ciclo = await this.db.getRepository(CicloAcreditacion).findOne({ where: { id: cicloId }, relations: { licenciatura: true } });
    if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');
    await this.crearCarpeta(this.db.manager, ciclo.id, ciclo.licenciatura.nombre, ciclo.nombre);
    await this.auditoria.registrar(admin, { entidad: 'ciclo_acreditacion', entidadId: cicloId, campo: 'carpeta', nuevo: rutaCarpetaCiclo(ciclo.licenciatura.nombre, ciclo.nombre).join('/') });
    return this.obtener(cicloId);
  }

  // ---------- Pasos internos ----------

  private async crearCarpeta(tx: EntityManager, cicloId: string, licenciatura: string, nombre: string) {
    try {
      const carpeta = await this.carpetas.asegurar(rutaCarpetaCiclo(licenciatura, nombre));
      await tx.update(CicloAcreditacion, { id: cicloId }, { carpetaRuta: carpeta.ruta, carpetaUrl: carpeta.url });
    } catch (error) {
      this.logger.error(`No se pudo crear la carpeta del ciclo ${cicloId}`, error as Error);
      throw new InternalServerErrorException('No se pudo crear la carpeta de evidencias del ciclo. Intenta de nuevo o avisa al equipo de sistemas.');
    }
  }

  private async obtener(id: string): Promise<CicloAdministracion> {
    const ciclo = await this.db.getRepository(CicloAcreditacion).findOne({ where: { id }, relations: { licenciatura: true, organismo: true } });
    if (!ciclo) throw new NotFoundException('No existe ese ciclo de acreditación.');
    const [resumen] = await this.resumir(this.db.manager, [ciclo]);
    return resumen;
  }

  private async validar(tx: EntityManager, dto: CicloDto) {
    validarId(dto.licenciaturaId, 'licenciatura');
    validarId(dto.organismoId, 'organismo acreditador');
    validarVigencia(dto);
    const nombre = nombreCiclo(dto.nombre, dto.vigenciaInicio, dto.vigenciaFin);
    const licenciatura = await tx.findOneBy(Licenciatura, { id: dto.licenciaturaId, activa: true });
    if (!licenciatura) throw new NotFoundException('Selecciona una licenciatura del catálogo.');
    const organismo = await tx.findOneBy(OrganismoAcreditador, { id: dto.organismoId, activo: true });
    if (!organismo) throw new NotFoundException('Selecciona un organismo acreditador del catálogo.');
    return { licenciatura, organismo, nombre };
  }

  /** Agrega a cada ciclo su última versión de plan y cuántas recomendaciones tiene. */
  private async resumir(manager: EntityManager, ciclos: CicloAcreditacion[]): Promise<CicloAdministracion[]> {
    if (ciclos.length === 0) return [];
    const hoy = hoyEnMexico();
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
    const porVersion = new Map<string, number>(conteos.map((c): [string, number] => [String(c.version), Number(c.total)]));

    return ciclos
      .map((c): CicloAdministracion => {
        const v = ultima.get(c.id);
        return {
          id: c.id,
          nombre: c.nombre,
          licenciatura: { id: c.licenciatura.id, nombre: c.licenciatura.nombre },
          organismo: { id: c.organismo.id, nombre: c.organismo.nombre },
          fechaEmision: c.fechaEmision,
          vigenciaInicio: c.vigenciaInicio,
          vigenciaFin: c.vigenciaFin,
          estado: c.estado,
          activo: cicloActivo(c, hoy),
          referenciaConstancia: c.referenciaConstancia,
          carpeta: c.carpetaRuta ? { ruta: c.carpetaRuta, url: c.carpetaUrl } : null,
          plan: v ? { versionId: v.id, numero: v.numeroVersion, estado: v.estado, recomendaciones: porVersion.get(v.id) ?? 0 } : null,
        };
      })
      .sort((a, b) => a.licenciatura.nombre.localeCompare(b.licenciatura.nombre, 'es') || b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  }
}

/** Traduce los UNIQUE del esquema a mensajes para la Administradora. */
const traducirDuplicado = (error: unknown): never => {
  const driver = typeof error === 'object' && error !== null ? (error as { code?: string; sqlMessage?: string; driverError?: { code?: string; sqlMessage?: string } }) : {};
  const codigo = driver.code ?? driver.driverError?.code;
  const mensaje = driver.sqlMessage ?? driver.driverError?.sqlMessage ?? '';
  if (codigo === 'ER_DUP_ENTRY') {
    if (mensaje.includes('uq_ciclo_vigente_por_licenciatura')) throw new ConflictException('Esa licenciatura ya tiene un ciclo vigente.');
    throw new ConflictException('Ya existe un ciclo de esa licenciatura con el mismo organismo y fecha de emisión.');
  }
  throw error;
};

// ---------- Controlador (solo Administradora) ----------

@ApiTags('HU-18 · Ciclos de acreditación')
@ApiBearerAuth()
@Controller('ciclos')
@Roles(Rol.ADMINISTRADOR)
export class CiclosController {
  constructor(private readonly servicio: CiclosService) {}

  @Get()
  listar(@Query('licenciaturaIds') licenciaturaIds?: string) {
    return this.servicio.listar(leerLicenciaturaIds(licenciaturaIds));
  }

  @Post()
  crear(@UsuarioActual() admin: UsuarioToken, @Body() dto: CicloDto) {
    return this.servicio.crear(admin, dto);
  }

  @Patch(':cicloId')
  actualizar(@UsuarioActual() admin: UsuarioToken, @Param('cicloId') cicloId: string, @Body() dto: CicloDto) {
    return this.servicio.actualizar(admin, cicloId, dto);
  }

  @Post(':cicloId/carpeta')
  asegurarCarpeta(@UsuarioActual() admin: UsuarioToken, @Param('cicloId') cicloId: string) {
    return this.servicio.asegurarCarpeta(admin, cicloId);
  }
}
