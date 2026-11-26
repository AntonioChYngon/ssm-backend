// HU-10 · Recordatorios automáticos (fechas límite e hitos intermedios).
// Una vez al arrancar y cada día a RECORDATORIOS_HORA revisa el plan aprobado de cada licenciatura con ciclo activo
// (HU-18) y avisa a su coordinación por correo e In-App: fecha límite próxima con avance < 100 % y rezago en un hito
// (HU-12). Cada recordatorio se envía una sola vez (tabla recordatorio_enviado). El banner al iniciar sesión
// (GET /recordatorios) se calcula en el momento, así que desaparece en cuanto se captura el avance.
// No bloquea nada: pasada la fecha límite se puede seguir capturando (No Bloqueo).
import { Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Column, DataSource, Entity, In, PrimaryColumn, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { EstadoVersion, Rol } from '../../common/enums';
import { CicloAcreditacion, VersionPlan } from '../../database/plan.entities';
import { cicloActivo, hoyEnMexico } from '../planes/reglas';
import { NotificacionesService } from '../notificaciones/notificaciones.module';
import {
  avisoRecordatorios,
  detectarRecordatorios,
  msHastaLaHora,
  Recordatorio,
  RecomendacionSeguimiento,
  TIPOS_CON_AVISO,
} from './reglas';

@Entity('recordatorio_enviado')
export class RecordatorioEnviado {
  @PrimaryColumn({ type: 'varchar', length: 160 })
  clave: string;

  @Column({ name: 'licenciatura_id', type: 'bigint' })
  licenciaturaId: string;

  @Column({ name: 'enviado_en', type: 'datetime', insert: false, update: false })
  enviadoEn: Date;
}

export type ResumenEjecucion = { fecha: string; licenciaturas: number; recordatorios: number; avisosNuevos: number };

/** Respuesta del banner (contrato: RecordatoriosLicenciatura en ssm-frontend/src/lib/types.ts). */
export type RecordatoriosLicenciatura = { cicloActivo: boolean; diasAntes: number; recordatorios: Recordatorio[] };

const etiquetaIndicador = (i: { clave: string | null; descripcion: string }) => (i.clave ? `${i.clave} ${i.descripcion}` : i.descripcion);

@Injectable()
export class RecordatoriosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RecordatoriosService.name);
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(CicloAcreditacion) private readonly ciclos: Repository<CicloAcreditacion>,
    @InjectRepository(VersionPlan) private readonly planes: Repository<VersionPlan>,
    @InjectRepository(RecordatorioEnviado) private readonly enviados: Repository<RecordatorioEnviado>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly notificaciones: NotificacionesService,
    private readonly config: ConfigService,
  ) {}

  get diasAntes() {
    const dias = Number(this.config.get('RECORDATORIOS_DIAS_ANTES', 7));
    return Number.isInteger(dias) && dias >= 0 ? dias : 7;
  }

  private get hora() {
    const hora = Number(this.config.get('RECORDATORIOS_HORA', 8));
    return Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 8;
  }

  onApplicationBootstrap() {
    if (this.config.get('RECORDATORIOS_ACTIVOS', 'true') !== 'true') {
      this.logger.log('Recordatorios automáticos desactivados (RECORDATORIOS_ACTIVOS).');
      return;
    }
    // Primera revisión poco después de arrancar: si el servidor estuvo apagado a la hora programada, no se pierde el día.
    this.programar(15_000);
  }

  onModuleDestroy() {
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  private programar(ms: number) {
    this.temporizador = setTimeout(() => void this.turno(), ms);
    this.temporizador.unref();
  }

  private async turno() {
    try {
      const r = await this.ejecutar();
      this.logger.log(`Recordatorios ${r.fecha}: ${r.licenciaturas} licenciaturas revisadas, ${r.avisosNuevos} avisos nuevos.`);
    } catch (error) {
      this.logger.error('Falló la revisión de recordatorios', error as Error);
    } finally {
      this.programar(msHastaLaHora(this.hora));
    }
  }

  /** Revisa todas las licenciaturas (o las indicadas) y envía los recordatorios que aún no se habían enviado. */
  async ejecutar(opciones: { hoy?: string; licenciaturaIds?: string[] } = {}): Promise<ResumenEjecucion> {
    const hoy = opciones.hoy ?? hoyEnMexico();
    const seguimiento = await this.seguimiento(hoy, opciones.licenciaturaIds);
    let total = 0;
    let avisosNuevos = 0;
    for (const { ciclo, recomendaciones } of seguimiento) {
      const recordatorios = detectarRecordatorios(recomendaciones, hoy, this.diasAntes).filter((r) => TIPOS_CON_AVISO.has(r.tipo));
      total += recordatorios.length;
      if (!recordatorios.length) continue;
      const yaEnviados = new Set(
        (await this.enviados.find({ select: { clave: true }, where: { clave: In(recordatorios.map((r) => r.clave)) } })).map((e) => e.clave),
      );
      const nuevos = recordatorios.filter((r) => !yaEnviados.has(r.clave));
      if (!nuevos.length) continue;
      // Primero se registran: si el correo falla, el aviso In-App queda como FALLIDA y no se repite cada día.
      await this.enviados.insert(nuevos.map((r) => ({ clave: r.clave, licenciaturaId: ciclo.licenciaturaId })));
      for (const tipo of ['FECHA_LIMITE', 'REZAGO'] as const) {
        const lista = nuevos.filter((r) => r.tipo === tipo);
        if (!lista.length) continue;
        await this.notificaciones.notificarLicenciatura(ciclo.licenciaturaId, avisoRecordatorios(ciclo.licenciatura.nombre, tipo, lista, this.diasAntes));
        avisosNuevos += 1;
      }
    }
    return { fecha: hoy, licenciaturas: seguimiento.length, recordatorios: total, avisosNuevos };
  }

  /** Banner al iniciar sesión: los recordatorios vigentes de la licenciatura, calculados en el momento. */
  async deLicenciatura(licenciaturaId: string, hoy = hoyEnMexico()): Promise<RecordatoriosLicenciatura> {
    const [actual] = await this.seguimiento(hoy, [licenciaturaId]);
    return {
      cicloActivo: Boolean(actual),
      diasAntes: this.diasAntes,
      recordatorios: actual ? detectarRecordatorios(actual.recomendaciones, hoy, this.diasAntes) : [],
    };
  }

  /** Plan aprobado más reciente de cada ciclo activo, con el avance del último informe capturado (D13). */
  private async seguimiento(hoy: string, licenciaturaIds?: string[]) {
    const ciclos = (
      await this.ciclos.find({
        where: { estado: 'VIGENTE', ...(licenciaturaIds ? { licenciaturaId: In(licenciaturaIds) } : {}) },
        relations: { licenciatura: true },
      })
    ).filter((c) => cicloActivo(c, hoy));

    const resultado: { ciclo: CicloAcreditacion; recomendaciones: RecomendacionSeguimiento[] }[] = [];
    for (const ciclo of ciclos) {
      const plan = await this.planes.findOne({
        where: { cicloId: ciclo.id, estado: EstadoVersion.APROBADO },
        order: { numeroVersion: 'DESC' },
        relations: { indicadores: { recomendaciones: { metas: true } } },
      });
      if (!plan) continue;
      const recomendaciones = plan.indicadores
        .sort((a, b) => a.orden - b.orden)
        .flatMap((i) => i.recomendaciones.sort((a, b) => a.orden - b.orden).map((r) => ({ indicador: i, r })));
      const avances = await this.ultimosAvances(recomendaciones.map(({ r }) => r.id));
      resultado.push({
        ciclo,
        recomendaciones: recomendaciones.map(({ indicador, r }) => ({
          id: r.id,
          indicador: etiquetaIndicador(indicador),
          recomendacion: r.descripcion,
          fechaCumplimiento: r.fechaCumplimiento,
          metas: r.metas
            .sort((a, b) => a.orden - b.orden)
            .map((m) => ({ id: m.id, descripcion: m.descripcion, fechaCompromiso: m.fechaCompromiso, porcentajeEsperado: m.porcentajeEsperado })),
          avanceActual: avances.get(r.id) ?? 0,
        })),
      });
    }
    return resultado;
  }

  /** % de cada recomendación en el informe más reciente que la registró (su última versión), sin importar su estado. */
  private async ultimosAvances(recomendacionIds: string[]) {
    const avances = new Map<string, number>();
    if (!recomendacionIds.length) return avances;
    const filas: { recomendacion: string; porcentaje: string }[] = await this.ds.query(
      `SELECT ar.recomendacion_id AS recomendacion, ar.porcentaje
       FROM avance_recomendacion ar
       JOIN version_informe vi ON vi.version_informe_id = ar.version_informe_id
       JOIN informe i ON i.informe_id = vi.informe_id
       WHERE ar.recomendacion_id IN (?)
       ORDER BY i.fecha_fin DESC, vi.numero_version DESC, ar.avance_id DESC`,
      [recomendacionIds],
    );
    for (const f of filas) if (!avances.has(String(f.recomendacion))) avances.set(String(f.recomendacion), Number(f.porcentaje));
    return avances;
  }
}

@ApiTags('Recordatorios')
@ApiBearerAuth()
@Controller('recordatorios')
export class RecordatoriosController {
  constructor(private readonly servicio: RecordatoriosService) {}

  /** Banner al iniciar sesión (HU-10): recordatorios vigentes de la licenciatura de la cuenta. */
  @Get()
  @Roles(Rol.CAPTURA, Rol.AUXILIAR)
  deMiLicenciatura(@UsuarioActual() usuario: UsuarioToken) {
    if (!usuario.licenciaturaId) return { cicloActivo: false, diasAntes: this.servicio.diasAntes, recordatorios: [] };
    return this.servicio.deLicenciatura(usuario.licenciaturaId);
  }

  /** Corre la revisión diaria en este momento (pruebas y demostraciones). No repite avisos ya enviados. */
  @Post('ejecutar')
  @Roles(Rol.ADMINISTRADOR)
  ejecutar() {
    return this.servicio.ejecutar();
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([RecordatorioEnviado, CicloAcreditacion, VersionPlan])],
  controllers: [RecordatoriosController],
  providers: [RecordatoriosService],
  exports: [RecordatoriosService],
})
export class RecordatoriosModule {}
