// HU-04/HU-06 · Plan de Mejora Continua en PDF con membrete institucional (logotipo de la FES Acatlán, licenciatura,
// organismo o IEVA y vigencia). El dibujo del reporte vive en membrete/reporte-pdf.ts, compartido con el informe (HU-09).
import { celdasRecomendacion, COLUMNAS_PLAN, DatosMembrete, RecomendacionReporte } from './membrete/membrete';
import { generarPdfReporte } from './membrete/reporte-pdf';

type PlanPdf = DatosMembrete & {
  estado: string;
  actualizado: string;
  recomendacionesDetalle: RecomendacionReporte[];
};

/** Proporciones de las columnas del Anexo 1 (iguales en el Word). */
export const PROPORCIONES_PLAN = [25, 72, 83, 155, 118, 118, 104, 103];

export const generarPdfPlan = (plan: PlanPdf): Buffer =>
  generarPdfReporte({
    // HU-04: el reporte en tabla se titula "Plan de Mejora Continua" (Anexo 1).
    titulo: 'Plan de Mejora Continua',
    membrete: plan,
    detalle: `Estado: ${plan.estado.replaceAll('_', ' ')} · Última actualización: ${plan.actualizado}`,
    columnas: COLUMNAS_PLAN.map((titulo, i) => ({ titulo, proporcion: PROPORCIONES_PLAN[i]! })),
    filas: plan.recomendacionesDetalle.map(celdasRecomendacion),
    vacio: 'El plan aún no contiene recomendaciones.',
  });
