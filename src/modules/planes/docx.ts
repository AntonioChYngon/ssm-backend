// HU-06 · Plan de Mejora Continua en Word (.docx editable). El armado del documento vive en membrete/reporte-docx.ts,
// compartido con el Informe de Seguimiento (HU-09).
import { celdasRecomendacion, COLUMNAS_PLAN, DatosMembrete, RecomendacionReporte } from './membrete/membrete';
import { generarDocxReporte } from './membrete/reporte-docx';
import { PROPORCIONES_PLAN } from './pdf';

export type PlanWord = DatosMembrete & {
  estado: string;
  actualizado: string;
  recomendacionesDetalle: RecomendacionReporte[];
};

export const generarDocxPlan = (plan: PlanWord): Buffer =>
  generarDocxReporte({
    titulo: 'Plan de Mejora Continua',
    tituloDocumento: `Plan de Mejora Continua · ${plan.licenciatura} · ${plan.ciclo}`,
    membrete: plan,
    detalle: `Estado: ${plan.estado.replaceAll('_', ' ')} · Última actualización: ${plan.actualizado}`,
    columnas: COLUMNAS_PLAN.map((titulo, i) => ({ titulo, proporcion: PROPORCIONES_PLAN[i]! })),
    filas: plan.recomendacionesDetalle.map(celdasRecomendacion),
    vacio: 'El plan aún no contiene recomendaciones.',
  });
