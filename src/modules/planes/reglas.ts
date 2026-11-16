// HU-04 · Reglas de negocio puras (sin base de datos).
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';

/** La fecha de cumplimiento debe quedar dentro de la vigencia de 5 años de la acreditación. Fechas YYYY-MM-DD. */
export const validarFechaCumplimiento = (fecha: string, vigenciaInicio: string, vigenciaFin: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new BadRequestException('Usa una fecha válida (AAAA-MM-DD).');
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

// TODO(HU-04): "Metas medibles": decidir con el equipo cómo validar que una meta sea cuantitativa
// (por ejemplo, exigir un número o un porcentaje en el texto).
