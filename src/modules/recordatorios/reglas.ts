// HU-10 · Reglas puras de los recordatorios automáticos. Las fechas son textos YYYY-MM-DD (hora de la Ciudad de México).

/** Una recomendación del plan aprobado de un ciclo activo, con su avance más reciente. */
export type RecomendacionSeguimiento = {
  id: string;
  indicador: string;
  recomendacion: string;
  /** Fecha límite final de la recomendación (Plan de Mejora). */
  fechaCumplimiento: string | null;
  /** Hitos de HU-12: metas con fecha compromiso y % esperado. */
  metas: ReadonlyArray<{ id: string; descripcion: string; fechaCompromiso: string | null; porcentajeEsperado: number | null }>;
  /** % del último informe capturado (D13); 0 si todavía no hay ninguno. */
  avanceActual: number;
};

export type TipoRecordatorio = 'FECHA_LIMITE' | 'VENCIDA' | 'REZAGO';

export type Recordatorio = {
  /** Identifica lo que se avisó; el correo de cada clave se manda una sola vez. */
  clave: string;
  tipo: TipoRecordatorio;
  recomendacionId: string;
  indicador: string;
  recomendacion: string;
  /** Meta pendiente: la del hito vencido o, para la fecha límite, las metas que siguen abiertas. */
  meta: string;
  comprometido: number;
  actual: number;
  /** Fecha del hito (REZAGO) o null. */
  fechaHito: string | null;
  fechaLimite: string | null;
  /** Días que faltan para la fecha límite (negativo si ya pasó); null sin fecha límite. */
  diasRestantes: number | null;
};

/** Los tipos que se mandan por correo y In-App. VENCIDA solo se muestra en el banner (No Bloqueo: se puede regularizar). */
export const TIPOS_CON_AVISO: ReadonlySet<TipoRecordatorio> = new Set(['FECHA_LIMITE', 'REZAGO']);

const DIA_MS = 86_400_000;
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS);

/**
 * Recordatorios de una recomendación a la fecha `hoy`:
 * - FECHA_LIMITE: faltan `diasAntes` días o menos para la fecha límite y el avance es menor al 100 %.
 * - VENCIDA: la fecha límite ya pasó sin llegar al 100 %.
 * - REZAGO: llegó la fecha de un hito y el avance actual es menor a su % comprometido. Si vencieron varios,
 *   se avisa del más exigente (mayor %), que es el compromiso vigente.
 */
export const recordatoriosDe = (r: RecomendacionSeguimiento, hoy: string, diasAntes: number): Recordatorio[] => {
  if (r.avanceActual >= 100) return [];
  const base = { recomendacionId: r.id, indicador: r.indicador, recomendacion: r.recomendacion, actual: r.avanceActual, fechaLimite: r.fechaCumplimiento };
  const restantes = r.fechaCumplimiento ? diasEntre(hoy, r.fechaCumplimiento) : null;
  const resultado: Recordatorio[] = [];

  if (r.fechaCumplimiento && restantes !== null && restantes <= diasAntes) {
    const pendientes = r.metas.filter((m) => m.porcentajeEsperado == null || m.porcentajeEsperado > r.avanceActual);
    resultado.push({
      ...base,
      clave: `${restantes < 0 ? 'VENCIDA' : 'LIMITE'}:${r.id}:${r.fechaCumplimiento}`,
      tipo: restantes < 0 ? 'VENCIDA' : 'FECHA_LIMITE',
      meta: (pendientes.length ? pendientes : r.metas).map((m) => m.descripcion).join('; ') || 'Sin metas registradas',
      comprometido: 100,
      fechaHito: null,
      diasRestantes: restantes,
    });
  }

  const vencidos = r.metas.filter(
    (m): m is typeof m & { fechaCompromiso: string; porcentajeEsperado: number } =>
      m.fechaCompromiso !== null && m.porcentajeEsperado !== null && m.fechaCompromiso <= hoy,
  );
  const hito = vencidos.reduce<(typeof vencidos)[number] | null>(
    (mayor, m) => (!mayor || m.porcentajeEsperado > mayor.porcentajeEsperado ? m : mayor),
    null,
  );
  if (hito && r.avanceActual < hito.porcentajeEsperado) {
    resultado.push({
      ...base,
      clave: `REZAGO:${hito.id}:${hito.fechaCompromiso}:${hito.porcentajeEsperado}`,
      tipo: 'REZAGO',
      meta: hito.descripcion,
      comprometido: hito.porcentajeEsperado,
      fechaHito: hito.fechaCompromiso,
      diasRestantes: restantes,
    });
  }
  return resultado;
};

export const detectarRecordatorios = (recomendaciones: readonly RecomendacionSeguimiento[], hoy: string, diasAntes: number) =>
  recomendaciones.flatMap((r) => recordatoriosDe(r, hoy, diasAntes));

const fechaLegible = (fecha: string) => {
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
};

const plazo = (dias: number | null) => {
  if (dias === null) return '';
  if (dias < 0) return ` (venció hace ${-dias} ${-dias === 1 ? 'día' : 'días'})`;
  if (dias === 0) return ' (vence hoy)';
  return ` (${dias === 1 ? 'falta 1 día' : `faltan ${dias} días`})`;
};

/** Bloque del mensaje con el contenido que pide HU-10: indicador, recomendación, meta pendiente, % y fecha límite. */
export const detalleRecordatorio = (r: Recordatorio) =>
  [
    `• Indicador: ${r.indicador}`,
    `  Recomendación: ${r.recomendacion}`,
    `  Meta pendiente: ${r.meta}`,
    `  % comprometido: ${r.comprometido} % · % actual: ${r.actual} %`,
    ...(r.fechaHito ? [`  Fecha del hito: ${fechaLegible(r.fechaHito)}`] : []),
    `  Fecha límite: ${r.fechaLimite ? fechaLegible(r.fechaLimite) + plazo(r.diasRestantes) : 'sin fecha registrada'}`,
  ].join('\n');

const NO_BLOQUEO = 'Puedes seguir capturando avances y evidencias aunque la fecha ya haya pasado.';

/** Aviso (correo e In-App) con los recordatorios nuevos de una licenciatura, uno por tipo. */
export const avisoRecordatorios = (licenciatura: string, tipo: 'FECHA_LIMITE' | 'REZAGO', lista: readonly Recordatorio[], diasAntes: number) => {
  const n = lista.length;
  const plural = n === 1 ? 'recomendación' : 'recomendaciones';
  const encabezado =
    tipo === 'FECHA_LIMITE'
      ? `${licenciatura}: ${n} ${plural} con fecha límite en los próximos ${diasAntes} días y avance menor al 100 %.`
      : `${licenciatura}: ${n} ${plural} con rezago detectado. El avance actual es menor al % comprometido en su hito.`;
  return {
    tipo: tipo === 'FECHA_LIMITE' ? ('RECORDATORIO_FECHA_LIMITE' as const) : ('REZAGO_DETECTADO' as const),
    titulo: tipo === 'FECHA_LIMITE' ? `Recordatorio: fecha límite próxima (${n})` : `Rezago detectado (${n})`,
    mensaje: [encabezado, '', ...lista.map(detalleRecordatorio).join('\n\n').split('\n'), '', NO_BLOQUEO].join('\n'),
  };
};

/** Milisegundos hasta la próxima `hora` en punto de la Ciudad de México (UTC-6 todo el año desde 2022). */
export const msHastaLaHora = (hora: number, ahora = new Date()) => {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(ahora);
  let objetivo = Date.parse(`${hoy}T${String(hora).padStart(2, '0')}:00:00-06:00`);
  if (objetivo <= ahora.getTime()) objetivo += DIA_MS;
  return objetivo - ahora.getTime();
};
