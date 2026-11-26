// HU-09 · Exportación del Informe de Seguimiento en Word y PDF, con el mismo membrete institucional del plan (HU-06)
// y las evidencias como hipervínculos clickeables.
// - Enlaces (Plan B) y evidencias con vista de Drive: se exporta su URL tal cual.
// - Archivos guardados en la carpeta local del sistema: se exporta la página del sistema que los abre con sesión
//   (FRONTEND_URL/evidencias/:id). Cuando se conecte Drive, esas evidencias traerán su URL de Drive y los
//   evaluadores externos podrán abrirlas sin cuenta del sistema (permisos de visualización de HU-09).
import { fechaCorta, textoMetas } from '../planes/membrete/membrete';
import type { CeldaReporte, ReporteTabla } from '../planes/membrete/reporte-pdf';
import { EstadoVersion } from '../../common/enums';
import type { EvidenciaInforme, InformeDetalle } from './contrato';

export const COLUMNAS_INFORME = [
  { titulo: 'N.º', proporcion: 25 },
  { titulo: 'Categoría / Indicador', proporcion: 95 },
  { titulo: 'Recomendación', proporcion: 145 },
  { titulo: 'Metas', proporcion: 125 },
  { titulo: '% esperado al corte', proporcion: 48 },
  { titulo: '% de avance', proporcion: 45 },
  { titulo: 'Observaciones', proporcion: 135 },
  { titulo: 'Evidencias', proporcion: 132 },
];

/** URL que se exporta para cada evidencia. */
export const urlEvidencia = (evidencia: EvidenciaInforme, frontendUrl: string) =>
  evidencia.externo ? evidencia.enlace : `${frontendUrl.replace(/\/+$/, '')}/evidencias/${encodeURIComponent(evidencia.id)}`;

const porcentaje = (valor: number | null, vacio: string) => (valor === null ? vacio : `${valor}%`);

export const AVISO_PRELIMINAR = 'Versión preliminar: este informe aún no ha sido validado por la Unidad de Planeación.';
export const NOTA_EVIDENCIAS_LOCALES = 'Las evidencias guardadas en el sistema se consultan iniciando sesión en el SSM.';

/** Datos del reporte (independientes del formato) a partir del detalle que ya calcula consulta.service. */
export const reporteInforme = (informe: InformeDetalle, frontendUrl: string): ReporteTabla & { tituloDocumento: string } => {
  const hayLocales = informe.avances.some((a) => a.evidencias.some((e) => !e.externo));
  const avisos = [informe.estado === EstadoVersion.APROBADO ? null : AVISO_PRELIMINAR, hayLocales ? NOTA_EVIDENCIAS_LOCALES : null].filter(Boolean);
  const aprobado = informe.aprobadoEn ? ` · Validado: ${fechaCorta(informe.aprobadoEn)}` : '';
  return {
    titulo: 'Informe de Seguimiento',
    tituloDocumento: `Informe de Seguimiento · ${informe.licenciatura} · ${informe.periodo}`,
    membrete: informe,
    detalle:
      `Semestre ${informe.periodo} (${fechaCorta(informe.fechaInicio)} al ${fechaCorta(informe.fechaFin)}) · ` +
      `Corte: ${fechaCorta(informe.fechaCorte)} · Estado: ${informe.estado.replaceAll('_', ' ')}${aprobado}`,
    aviso: avisos.length ? avisos.join(' ') : undefined,
    columnas: COLUMNAS_INFORME,
    filas: informe.avances.map((a): CeldaReporte[] => [
      String(a.numero),
      `${a.categoria}\n${a.indicador}`,
      a.recomendacion,
      textoMetas(a.metas),
      porcentaje(a.esperadoAlCorte, '—'),
      porcentaje(a.porcentaje, 'Sin capturar'),
      a.observaciones?.trim() || '—',
      a.evidencias.length ? { enlaces: a.evidencias.map((e) => ({ texto: e.nombre, url: urlEvidencia(e, frontendUrl) })) } : 'Sin evidencias',
    ]),
    vacio: 'El informe no tiene recomendaciones.',
  };
};

/** Nombre de archivo sin acentos ni espacios: informe-de-seguimiento-actuaria-2026-2 */
export const nombreArchivoInforme = (informe: { licenciatura: string; periodo: string }) =>
  `informe-de-seguimiento-${informe.licenciatura}-${informe.periodo}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
