// "% actual" de una recomendación, compartido por las consultas y avisos (HU-10, HU-14, HU-15, HU-17).
// Es el % del informe más reciente que la registró (su última versión), en cualquier estado: el último capturado (D13).
// Si se decide usar solo informes aprobados, se cambia aquí y todas las pantallas siguen dando el mismo número.
import type { DataSource, EntityManager } from 'typeorm';

/** recomendacionId → % del último informe capturado. Las que nunca se capturaron no vienen (cuentan como 0 %). */
export const ultimosAvances = async (ds: DataSource | EntityManager, recomendacionIds: readonly string[]) => {
  const avances = new Map<string, number>();
  if (!recomendacionIds.length) return avances;
  const filas: { recomendacion: string | number; porcentaje: string | number }[] = await ds.query(
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
};

/** Promedio entero de varios %; null sin datos. */
export const avanceConsolidado = (porcentajes: readonly number[]) =>
  porcentajes.length ? Math.round(porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length) : null;
