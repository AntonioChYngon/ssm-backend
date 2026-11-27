// Dashboards con datos reales (antes eran de ejemplo).
// - GET /dashboard/admin: planes por validar, informes en revisión, avance real contra esperado por licenciatura y
//   alertas de fechas (vencidas, rezagos y fechas límite próximas). Acepta licenciaturaIds (HU-13).
// - GET /dashboard/licenciatura: los mismos indicadores para la coordinación, sobre su ciclo vigente.
// Solo cuenta el ciclo vigente y activo de cada licenciatura (el histórico está en /historico). El % actual es el del
// último informe capturado (D13), igual que en recordatorios y reportes.
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsOptional, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { ultimosAvances } from '../../common/avances';
import { Rol } from '../../common/enums';
import { leerLicenciaturaIds, PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import { hoyEnMexico } from '../planes/reglas';
import type { RecomendacionSeguimiento } from '../recordatorios/reglas';
import { Alerta, alertasDe, avanceContraEsperado, MetaProxima, metasProximas, ordenarAlertas } from './reglas';

/** Días hacia adelante para "fechas límite próximas" en los dashboards. */
const DIAS_ADMIN = 30;
const DIAS_LICENCIATURA = 15;

type PlanVigente = {
  licenciaturaId: string;
  licenciatura: string;
  ciclo: string;
  organismo: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  estado: string;
  recomendaciones: RecomendacionSeguimiento[];
};

/** Contratos (DashboardAdmin y DashboardLicenciatura en ssm-frontend/src/lib/types.ts). */
export type DashboardAdmin = {
  fecha: string;
  licenciaturas: number;
  conPlan: number;
  planesValidados: number;
  porValidar: { planes: number; informes: number };
  alertas: { vencidas: number; licenciaturas: number };
  avance: { licenciatura: string; real: number; esperado: number }[];
  vencimientos: Alerta[];
};

export type DashboardLicenciatura = {
  fecha: string;
  ciclo: { nombre: string; licenciatura: string; organismo: string; vigenciaInicio: string; vigenciaFin: string } | null;
  planEstado: string | null;
  recomendaciones: number;
  atendidas: number;
  porVencer: number;
  vencidas: number;
  avance: { real: number; esperado: number };
  metas: MetaProxima[];
};

export class FiltroDashboardDto {
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
}

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async admin(filtros: FiltroDashboardDto): Promise<DashboardAdmin> {
    const hoy = hoyEnMexico();
    const ids = leerLicenciaturaIds(filtros.licenciaturaIds);
    const planes = await this.planesVigentes(hoy, ids);
    const [{ total }] = await this.ds.query(
      `SELECT COUNT(*) AS total FROM licenciatura WHERE activa = TRUE${ids ? ' AND licenciatura_id IN (?)' : ''}`,
      ids ? [ids] : [],
    );
    const [{ informes }] = await this.ds.query(
      `SELECT COUNT(*) AS informes FROM version_informe vi
       JOIN informe i ON i.informe_id = vi.informe_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = i.ciclo_id
       WHERE vi.estado = 'EN_REVISION'
         AND vi.numero_version = (SELECT MAX(x.numero_version) FROM version_informe x WHERE x.informe_id = vi.informe_id)
         ${ids ? 'AND c.licenciatura_id IN (?)' : ''}`,
      ids ? [ids] : [],
    );
    const aprobados = planes.filter((p) => p.estado === 'APROBADO');
    const alertas = aprobados.flatMap((p) => alertasDe(p.licenciatura, p.recomendaciones, hoy, DIAS_ADMIN));
    const atrasadas = alertas.filter((a) => a.tipo !== 'FECHA_LIMITE');
    return {
      fecha: hoy,
      licenciaturas: Number(total),
      conPlan: planes.length,
      planesValidados: aprobados.length,
      porValidar: { planes: planes.filter((p) => p.estado === 'EN_REVISION').length, informes: Number(informes) },
      alertas: { vencidas: atrasadas.length, licenciaturas: new Set(atrasadas.map((a) => a.licenciatura)).size },
      avance: aprobados.map((p) => ({ licenciatura: p.licenciatura, ...avanceContraEsperado(p.recomendaciones, hoy) })),
      vencimientos: ordenarAlertas(alertas).slice(0, 8),
    };
  }

  async licenciatura(usuario: UsuarioToken): Promise<DashboardLicenciatura> {
    const hoy = hoyEnMexico();
    const [plan] = usuario.licenciaturaId ? await this.planesVigentes(hoy, [usuario.licenciaturaId], true) : [];
    const vacio = { fecha: hoy, ciclo: null, planEstado: null, recomendaciones: 0, atendidas: 0, porVencer: 0, vencidas: 0, avance: { real: 0, esperado: 0 }, metas: [] };
    if (!plan) return vacio;
    const recs = plan.recomendaciones;
    const alertas = alertasDe(plan.licenciatura, recs, hoy, DIAS_LICENCIATURA);
    return {
      fecha: hoy,
      ciclo: { nombre: plan.ciclo, licenciatura: plan.licenciatura, organismo: plan.organismo, vigenciaInicio: plan.vigenciaInicio, vigenciaFin: plan.vigenciaFin },
      planEstado: plan.estado || null,
      recomendaciones: recs.length,
      atendidas: recs.filter((r) => r.avanceActual >= 100).length,
      porVencer: alertas.filter((a) => a.tipo === 'FECHA_LIMITE').length,
      vencidas: alertas.filter((a) => a.tipo !== 'FECHA_LIMITE').length,
      avance: avanceContraEsperado(recs, hoy),
      metas: metasProximas(recs, hoy),
    };
  }

  /**
   * Último plan (cualquier estado) del ciclo vigente y activo de cada licenciatura, con sus metas y el % actual.
   * Con `incluirSinPlan`, una licenciatura con ciclo pero sin plan aparece con estado vacío y sin recomendaciones.
   */
  private async planesVigentes(hoy: string, ids?: string[], incluirSinPlan = false): Promise<PlanVigente[]> {
    const ciclos: {
      ciclo_id: string | number;
      licenciatura_id: string | number;
      licenciatura: string;
      ciclo: string;
      organismo: string;
      vigencia_inicio: string;
      vigencia_fin: string;
      version_id: string | number | null;
      estado: string | null;
    }[] = await this.ds.query(
      `SELECT c.ciclo_id, c.licenciatura_id, l.nombre AS licenciatura, c.nombre AS ciclo, COALESCE(o.siglas, o.nombre) AS organismo,
              c.vigencia_inicio, c.vigencia_fin, vp.version_plan_id AS version_id, vp.estado
       FROM ciclo_acreditacion c
       JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       JOIN organismo_acreditador o ON o.organismo_id = c.organismo_id
       LEFT JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id
         AND vp.numero_version = (SELECT MAX(x.numero_version) FROM version_plan x WHERE x.ciclo_id = c.ciclo_id)
       WHERE c.estado = 'VIGENTE' AND c.vigencia_fin >= ?${ids ? ' AND c.licenciatura_id IN (?)' : ''}
       ORDER BY l.nombre`,
      ids ? [hoy, ids] : [hoy],
    );
    const conPlan = ciclos.filter((c) => c.version_id !== null || incluirSinPlan);
    const versiones = conPlan.filter((c) => c.version_id !== null).map((c) => String(c.version_id));
    const recs: { id: string | number; version_id: string | number; descripcion: string; fecha: string | null; clave: string | null; indicador: string }[] = versiones.length
      ? await this.ds.query(
          `SELECT r.recomendacion_id AS id, i.version_plan_id AS version_id, r.descripcion, r.fecha_cumplimiento AS fecha, i.clave, i.descripcion AS indicador
           FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id
           WHERE i.version_plan_id IN (?) ORDER BY i.orden, r.orden`,
          [versiones],
        )
      : [];
    const recIds = recs.map((r) => String(r.id));
    const metas: { id: string | number; rec: string | number; descripcion: string; fecha: string | null; porcentaje: string | number | null }[] = recIds.length
      ? await this.ds.query(
          'SELECT meta_id AS id, recomendacion_id AS rec, descripcion, fecha_compromiso AS fecha, porcentaje_esperado AS porcentaje FROM meta WHERE recomendacion_id IN (?) ORDER BY orden',
          [recIds],
        )
      : [];
    const avances = await ultimosAvances(this.ds, recIds);
    const fecha = (v: string | null) => (v ? String(v).slice(0, 10) : null);
    return conPlan.map((c) => ({
      licenciaturaId: String(c.licenciatura_id),
      licenciatura: c.licenciatura,
      ciclo: c.ciclo,
      organismo: c.organismo,
      vigenciaInicio: String(c.vigencia_inicio).slice(0, 10),
      vigenciaFin: String(c.vigencia_fin).slice(0, 10),
      estado: c.estado ?? '',
      recomendaciones: recs
        .filter((r) => c.version_id !== null && String(r.version_id) === String(c.version_id))
        .map((r) => ({
          id: String(r.id),
          indicador: r.clave ? `${r.clave} ${r.indicador}` : r.indicador,
          recomendacion: r.descripcion,
          fechaCumplimiento: fecha(r.fecha),
          metas: metas
            .filter((m) => String(m.rec) === String(r.id))
            .map((m) => ({ id: String(m.id), descripcion: m.descripcion, fechaCompromiso: fecha(m.fecha), porcentajeEsperado: m.porcentaje === null ? null : Number(m.porcentaje) })),
          avanceActual: avances.get(String(r.id)) ?? 0,
        })),
    }));
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly servicio: DashboardService) {}

  @Get('admin')
  @Roles(Rol.ADMINISTRADOR)
  admin(@Query() filtros: FiltroDashboardDto) {
    return this.servicio.admin(filtros);
  }

  @Get('licenciatura')
  @Roles(Rol.CAPTURA, Rol.AUXILIAR)
  licenciatura(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.licenciatura(usuario);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
