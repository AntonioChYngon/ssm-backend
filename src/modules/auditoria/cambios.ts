// HU-03 · Registro por campo: compara la versión anterior y la nueva de un registro y devuelve una fila
// por cada campo que cambió (lo que la bitácora guarda como campo, valor anterior y valor nuevo).

export type ValorAuditable = string | number | boolean | null | undefined | ReadonlyArray<string>;
export type Instantanea = Record<string, ValorAuditable>;
export type CambioCampo = { campo: string; anterior: string | null; nuevo: string | null };

/** Largo máximo que se guarda de cada valor (TEXT admite más, pero la bitácora es para leerse). */
export const LARGO_MAXIMO_VALOR = 2000;

/** Texto comparable y legible: listas unidas con " | ", espacios normalizados, vacío = null. */
export const textoAuditable = (valor: ValorAuditable): string | null => {
  if (valor === null || valor === undefined) return null;
  const texto = Array.isArray(valor)
    ? valor.map((v) => String(v).trim()).filter(Boolean).join(' | ')
    : String(valor).trim().replace(/\s+/g, ' ');
  if (!texto) return null;
  return texto.length > LARGO_MAXIMO_VALOR ? `${texto.slice(0, LARGO_MAXIMO_VALOR - 1)}…` : texto;
};

/**
 * Campos que cambiaron entre `antes` y `despues`, en el orden de `despues`. Un campo ausente en `despues`
 * no se compara (no se tocó). `sufijo` distingue el contexto: "porcentaje · Informe 2027-1".
 */
export const diferencias = (antes: Instantanea, despues: Instantanea, sufijo?: string): CambioCampo[] =>
  Object.keys(despues)
    .map((campo) => ({ campo, anterior: textoAuditable(antes[campo]), nuevo: textoAuditable(despues[campo]) }))
    .filter((c) => c.anterior !== c.nuevo)
    .map((c) => ({ ...c, campo: (sufijo ? `${c.campo} · ${sufijo}` : c.campo).slice(0, 120) }));

/** Meta del plan como texto de bitácora: "Capacitar al 80% (2026-06-30, 50%)". */
export const textoMeta = (m: { descripcion: string; fechaCompromiso?: string | null; porcentajeEsperado?: number | null }) => {
  const detalle = [m.fechaCompromiso, m.porcentajeEsperado != null ? `${m.porcentajeEsperado}%` : null].filter(Boolean).join(', ');
  return detalle ? `${m.descripcion.trim()} (${detalle})` : m.descripcion.trim();
};
