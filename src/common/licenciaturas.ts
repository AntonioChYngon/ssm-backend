// HU-13 · Filtro de varias licenciaturas para el Administrador: ?licenciaturaIds=1,2,3 (sin el parámetro, todas).
// Captura y Auxiliar siguen limitados a su propia licenciatura en cada consulta; este filtro no lo amplía.
import { BadRequestException } from '@nestjs/common';

export const PATRON_LICENCIATURAS = /^\d{1,19}(,\d{1,19})*$/;

/** "1,2,3" → ['1', '2', '3'] sin repetidos; undefined o vacío → undefined (todas). 400 si el formato no es válido. */
export const leerLicenciaturaIds = (texto: string | undefined): string[] | undefined => {
  const limpio = texto?.trim();
  if (!limpio) return undefined;
  if (!PATRON_LICENCIATURAS.test(limpio)) throw new BadRequestException('licenciaturaIds debe ser una lista de ids separados por coma (p. ej. 1,2,3).');
  return [...new Set(limpio.split(','))];
};
