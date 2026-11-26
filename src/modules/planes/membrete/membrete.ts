// HU-06 · Datos del encabezado institucional comunes al PDF y al Word del Plan de Mejora Continua.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2024-11-28" → "28 de noviembre de 2024". Sin zona horaria: la fecha se toma tal como está guardada. */
export const fechaLarga = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '—';
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : '—';
};

/** "2024-11-28" → "28/11/2024" para las celdas de la tabla. */
export const fechaCorta = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export type DatosMembrete = { licenciatura: string; organismo: string; ciclo: string; vigenciaInicio: string; vigenciaFin: string };

/** Las tres líneas que pide HU-06: licenciatura, organismo o IEVA y fecha de acreditación / vigencia. */
export const lineasMembrete = (d: DatosMembrete) => [
  { etiqueta: 'Licenciatura', valor: d.licenciatura },
  { etiqueta: 'Organismo acreditador o IEVA', valor: d.organismo },
  { etiqueta: 'Vigencia de la acreditación', valor: `${fechaLarga(d.vigenciaInicio)} al ${fechaLarga(d.vigenciaFin)} (ciclo ${d.ciclo})` },
];

/** Encabezados de la tabla del Anexo 1, iguales en PDF y Word. */
export const COLUMNAS_PLAN = ['N.º', 'Categoría', 'Indicador', 'Recomendación', 'Acciones', 'Metas', 'Área responsable', 'Fecha de cumplimiento'];

type Meta = { descripcion: string; fechaCompromiso: string | null; porcentajeEsperado: number | null };
export type RecomendacionReporte = {
  numero: number;
  categoria: string;
  indicador: string;
  descripcion: string;
  acciones: string[];
  metas: Meta[];
  areaResponsable: string | null;
  fechaCumplimiento: string | null;
};

/** "1. Capacitar al 80% · 30/06/2027 · 50%", una meta por renglón (plan e informe). */
export const textoMetas = (metas: Meta[]) =>
  metas.length
    ? metas
        .map((m, i) => `${i + 1}. ${m.descripcion}${m.fechaCompromiso ? ` · ${fechaCorta(m.fechaCompromiso)}` : ''}${m.porcentajeEsperado === null ? '' : ` · ${m.porcentajeEsperado}%`}`)
        .join('\n')
    : '—';

/** Texto de cada celda (los saltos de línea separan acciones y metas). */
export const celdasRecomendacion = (r: RecomendacionReporte) => [
  String(r.numero),
  r.categoria,
  r.indicador,
  r.descripcion,
  r.acciones.length ? r.acciones.map((a, i) => `${i + 1}. ${a}`).join('\n') : '—',
  textoMetas(r.metas),
  r.areaResponsable ?? '—',
  fechaCorta(r.fechaCumplimiento),
];

export const fechaGeneracion = (ahora = new Date()) =>
  new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(ahora);
