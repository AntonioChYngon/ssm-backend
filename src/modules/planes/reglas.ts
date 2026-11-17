// HU-04 · Reglas de negocio puras (sin base de datos).
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';

/** AAAA-MM-DD y además una fecha real del calendario (rechaza 2026-02-30). */
export const esFechaValida = (fecha: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
};

/** Una acreditación dura como máximo 5 años (requerimiento del cliente). */
export const VIGENCIA_MAXIMA_ANIOS = 5;

const sumarAnios = (fecha: string, anios: number) => `${Number(fecha.slice(0, 4)) + anios}${fecha.slice(4)}`;

/**
 * Vigencia capturada a mano por la Administradora (sin valores por defecto):
 * fechas reales, fin posterior al inicio, máximo 5 años y emisión de la constancia antes del fin.
 */
export const validarVigencia = (fechas: { fechaEmision: string; vigenciaInicio: string; vigenciaFin: string }) => {
  const { fechaEmision, vigenciaInicio, vigenciaFin } = fechas;
  if (![fechaEmision, vigenciaInicio, vigenciaFin].every(esFechaValida)) {
    throw new BadRequestException('Escribe fechas válidas (AAAA-MM-DD) para la emisión y la vigencia.');
  }
  if (vigenciaFin <= vigenciaInicio) throw new BadRequestException('La vigencia debe terminar después de la fecha de inicio.');
  if (vigenciaFin > sumarAnios(vigenciaInicio, VIGENCIA_MAXIMA_ANIOS)) {
    throw new BadRequestException(`La vigencia no puede durar más de ${VIGENCIA_MAXIMA_ANIOS} años.`);
  }
  if (fechaEmision > vigenciaFin) throw new BadRequestException('La fecha de emisión debe ser anterior al fin de la vigencia.');
};

/** La fecha de cumplimiento debe quedar dentro de la vigencia de 5 años de la acreditación. Fechas YYYY-MM-DD. */
export const validarFechaCumplimiento = (fecha: string, vigenciaInicio: string, vigenciaFin: string) => {
  if (!esFechaValida(fecha)) throw new BadRequestException('Usa una fecha válida (AAAA-MM-DD).');
  if (fecha < vigenciaInicio || fecha > vigenciaFin) {
    throw new BadRequestException(`La fecha de cumplimiento debe estar entre ${vigenciaInicio} y ${vigenciaFin}.`);
  }
};

/** Acciones y metas: al menos una, sin textos vacíos. */
export const limpiarLista = (valores: string[], campo: string) => {
  const limpios = valores.map((v) => v.trim()).filter(Boolean);
  if (limpios.length === 0) throw new BadRequestException(`Agrega al menos una ${campo}.`);
  return limpios;
};

/** Texto obligatorio: sin espacios sobrantes y no vacío. */
export const textoObligatorio = (valor: string | undefined, campo: string) => {
  const limpio = (valor ?? '').trim();
  if (!limpio) throw new BadRequestException(`Escribe ${campo}.`);
  return limpio;
};

/** Ids numéricos del esquema (BIGINT como texto). Evita consultas con basura en la URL. */
export const validarId = (id: string, campo: string) => {
  if (!/^\d{1,19}$/.test(id)) throw new BadRequestException(`El identificador de ${campo} no es válido.`);
  return id;
};

/** Solo se captura sobre un plan en BORRADOR o DEVUELTO. */
export const ESTADOS_EDITABLES: readonly EstadoVersion[] = [EstadoVersion.BORRADOR, EstadoVersion.DEVUELTO];

export const esEditable = (estado: EstadoVersion) => ESTADOS_EDITABLES.includes(estado);

export const exigirPlanEditable = (estado: EstadoVersion) => {
  if (esEditable(estado)) return;
  const motivo = estado === EstadoVersion.APROBADO ? 'ya fue aprobado' : 'está en revisión';
  throw new ConflictException(`El plan ${motivo} y no se puede modificar.`);
};

/**
 * Catálogos cerrados (categorías y áreas): todos los ids enviados deben existir y estar activos.
 * Regresa los ids sin duplicados, en el orden en que llegaron.
 */
export const validarCatalogo = (ids: string[], disponibles: ReadonlySet<string>, campo: string) => {
  const unicos = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unicos.length === 0) throw new BadRequestException(`Selecciona al menos una opción de ${campo}.`);
  const invalidos = unicos.filter((id) => !disponibles.has(id));
  if (invalidos.length > 0) throw new BadRequestException(`Selecciona ${campo} del catálogo.`);
  return unicos;
};

/** Un indicador existente solo admite recomendaciones de su misma categoría. */
export const validarCategoriaDelIndicador = (categoriaIndicador: string, categoriaSolicitada: string) => {
  if (categoriaIndicador !== categoriaSolicitada) {
    throw new BadRequestException('El indicador elegido pertenece a otra categoría.');
  }
};

/** Siguiente número de orden (1 si no hay ninguno). */
export const siguienteOrden = (ordenes: number[]) => (ordenes.length === 0 ? 1 : Math.max(...ordenes) + 1);

/** Porcentajes escritos como "80%", "80 %", "12.5%" o "12,5%". */
const PORCENTAJE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/**
 * Metas medibles (decisión del 16/11/2026): cada meta expresa su objetivo en porcentaje, de 0% a 100%
 * (0% sirve para metas de reducción, p. ej. "bajar la deserción al 0%").
 * El plazo de ese porcentaje es la fecha de cumplimiento de la recomendación, que ya se valida dentro de la vigencia;
 * así el objetivo queda comprometido antes de la fecha compromiso. Los hitos (HU-12) marcan los porcentajes intermedios.
 */
export const validarMetaMedible = (meta: string) => {
  const porcentajes = [...meta.matchAll(PORCENTAJE)].map((m) => Number(m[1].replace(',', '.')));
  if (porcentajes.length === 0) {
    throw new BadRequestException(`La meta "${meta.slice(0, 60)}" debe indicar su objetivo en porcentaje (por ejemplo, "Capacitar al 80% de la planta docente").`);
  }
  if (porcentajes.some((p) => p > 100)) {
    throw new BadRequestException(`El porcentaje de la meta "${meta.slice(0, 60)}" debe estar entre 0% y 100%.`);
  }
  return meta;
};
