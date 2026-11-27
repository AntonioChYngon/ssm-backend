// HU-16 · Reglas puras del archivo histórico.
import type { CicloAcreditacion } from '../../database/plan.entities';
import { fechaLarga } from '../planes/membrete/membrete';
import { cicloActivo } from '../planes/reglas';

/** Contrato con el frontend (CicloHistorico en ssm-frontend/src/lib/types.ts). */
export type CicloHistorico = {
  id: string;
  nombre: string;
  licenciatura: { id: string; nombre: string };
  organismo: string;
  fechaEmision: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  /** VIGENTE, HISTORICO o CERRADO, como está en la base. */
  estado: string;
  /** Vigente y dentro de su vigencia hoy; si es false, es histórico y nadie de la coordinación lo puede modificar. */
  activo: boolean;
  /** "28 de noviembre de 2019 al 28 de noviembre de 2024 · CONAED" */
  etiqueta: string;
  carpeta: string | null;
};

const siglas = (o: { siglas: string | null; nombre: string }) => o.siglas ?? o.nombre;

export const aCicloHistorico = (c: CicloAcreditacion, hoy: string): CicloHistorico => ({
  id: c.id,
  nombre: c.nombre,
  licenciatura: { id: c.licenciaturaId, nombre: c.licenciatura.nombre },
  organismo: siglas(c.organismo),
  fechaEmision: c.fechaEmision,
  vigenciaInicio: c.vigenciaInicio,
  vigenciaFin: c.vigenciaFin,
  estado: c.estado,
  activo: cicloActivo(c, hoy),
  etiqueta: `${fechaLarga(c.vigenciaInicio)} al ${fechaLarga(c.vigenciaFin)} · ${siglas(c.organismo)}`,
  carpeta: c.carpetaUrl ?? c.carpetaRuta,
});

/** ¿La fecha cae en la vigencia o es la de emisión? (filtro por fecha de la constancia). */
export const coincideFecha = (c: { fechaEmision: string; vigenciaInicio: string; vigenciaFin: string }, fecha: string) =>
  c.fechaEmision === fecha || (c.vigenciaInicio <= fecha && fecha <= c.vigenciaFin);
