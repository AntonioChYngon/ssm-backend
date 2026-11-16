// HU-04 · Reglas de negocio puras (sin base de datos).
import { BadRequestException } from '@nestjs/common';

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

// TODO(HU-04): "Metas medibles": decidir con el equipo cómo validar que una meta sea cuantitativa
// (por ejemplo, exigir un número o un porcentaje en el texto).
