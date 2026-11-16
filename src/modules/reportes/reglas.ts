// HU-15 · Reglas puras del resumen por estatus de cumplimiento.

export type EstatusAtencion = 'ATENDIDA' | 'EN_PROCESO' | 'NO_ATENDIDA';

/** Los 3 estatus estrictos de la HU-15: 100% atendida, 1–99% en proceso, 0% no atendida. */
export const clasificarAtencion = (porcentaje: number): EstatusAtencion => {
  if (porcentaje >= 100) return 'ATENDIDA';
  if (porcentaje > 0) return 'EN_PROCESO';
  return 'NO_ATENDIDA';
};

export type ConteoAtencion = { atendidas: number; enProceso: number; sinAtender: number };

/**
 * Cuenta recomendaciones por estatus. Una recomendación sin ningún avance registrado (null) cuenta como no atendida.
 * TODO(HU-15): ¿qué pasa con avances decimales entre 0 y 1 (p. ej. 0.5%)? Hoy cuentan como "en proceso".
 */
export const contarPorEstatus = (porcentajes: (number | null)[]): ConteoAtencion =>
  porcentajes.reduce<ConteoAtencion>(
    (conteo, porcentaje) => {
      const estatus = clasificarAtencion(porcentaje ?? 0);
      if (estatus === 'ATENDIDA') conteo.atendidas += 1;
      else if (estatus === 'EN_PROCESO') conteo.enProceso += 1;
      else conteo.sinAtender += 1;
      return conteo;
    },
    { atendidas: 0, enProceso: 0, sinAtender: 0 },
  );
