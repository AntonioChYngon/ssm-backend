// Dashboards (Administrador y coordinación) · reglas puras sobre los datos reales.
import { avanceConsolidado } from '../../common/avances';
import { detectarRecordatorios, Recordatorio, RecomendacionSeguimiento } from '../recordatorios/reglas';

/** % que ya debería llevar una recomendación hoy: el mayor % de sus metas vencidas, o 100 si pasó su fecha límite. */
export const esperadoAlDia = (r: RecomendacionSeguimiento, hoy: string) => {
  if (r.fechaCumplimiento && r.fechaCumplimiento <= hoy) return 100;
  return r.metas.reduce((mayor, m) => (m.fechaCompromiso && m.porcentajeEsperado !== null && m.fechaCompromiso <= hoy ? Math.max(mayor, m.porcentajeEsperado) : mayor), 0);
};

/** Avance real contra esperado de una licenciatura (promedios enteros). */
export const avanceContraEsperado = (recomendaciones: readonly RecomendacionSeguimiento[], hoy: string) => ({
  real: avanceConsolidado(recomendaciones.map((r) => r.avanceActual)) ?? 0,
  esperado: avanceConsolidado(recomendaciones.map((r) => esperadoAlDia(r, hoy))) ?? 0,
});

export type Alerta = Recordatorio & { licenciatura: string };

/** Fechas límite próximas, vencidas y rezagos, ordenados por urgencia (vencidas y rezagos primero, luego por fecha). */
export const alertasDe = (licenciatura: string, recomendaciones: readonly RecomendacionSeguimiento[], hoy: string, diasAntes: number): Alerta[] =>
  detectarRecordatorios(recomendaciones, hoy, diasAntes).map((r) => ({ ...r, licenciatura }));

const PRIORIDAD: Record<Recordatorio['tipo'], number> = { VENCIDA: 0, REZAGO: 1, FECHA_LIMITE: 2 };
const fechaDe = (a: Alerta) => a.fechaHito ?? a.fechaLimite ?? '9999-12-31';
export const ordenarAlertas = (alertas: readonly Alerta[]) =>
  [...alertas].sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo] || fechaDe(a).localeCompare(fechaDe(b)));

export type EstadoMeta = 'CUMPLIDA' | 'PENDIENTE' | 'VENCIDA';
export type MetaProxima = {
  recomendacion: string;
  meta: string;
  fecha: string;
  esperado: number;
  actual: number;
  estado: EstadoMeta;
};

/** Metas con fecha: primero las vencidas sin cumplir y luego las siguientes por fecha. */
export const metasProximas = (recomendaciones: readonly RecomendacionSeguimiento[], hoy: string, limite = 5): MetaProxima[] => {
  const metas = recomendaciones.flatMap((r) =>
    r.metas
      .filter((m): m is typeof m & { fechaCompromiso: string } => m.fechaCompromiso !== null)
      .map((m): MetaProxima => {
        const esperado = m.porcentajeEsperado ?? 100;
        const estado: EstadoMeta = r.avanceActual >= esperado ? 'CUMPLIDA' : m.fechaCompromiso < hoy ? 'VENCIDA' : 'PENDIENTE';
        return { recomendacion: r.recomendacion, meta: m.descripcion, fecha: m.fechaCompromiso, esperado, actual: r.avanceActual, estado };
      }),
  );
  const vencidas = metas.filter((m) => m.estado === 'VENCIDA').sort((a, b) => a.fecha.localeCompare(b.fecha));
  const siguientes = metas.filter((m) => m.estado !== 'VENCIDA' && m.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return [...vencidas, ...siguientes].slice(0, limite);
};
