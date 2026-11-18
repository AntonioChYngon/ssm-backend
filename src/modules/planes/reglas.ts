// HU-04 · Reglas de negocio puras (sin base de datos).
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** La fecha de cumplimiento debe quedar dentro de la vigencia de 5 años de la acreditación. Fechas YYYY-MM-DD. */
export const validarFechaCumplimiento = (fecha: string, vigenciaInicio: string, vigenciaFin: string) => {
  if (!FECHA.test(fecha)) throw new BadRequestException('Usa una fecha válida (AAAA-MM-DD).');
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

/** Igual que limpiarLista, pero permite la lista vacía (borrador). */
export const limpiarListaOpcional = (valores: string[] | undefined) => (valores ?? []).map((v) => v.trim()).filter(Boolean);

/** Clave para reutilizar un indicador: mismo texto sin importar mayúsculas ni espacios extra. */
export const claveTexto = (texto: string) => texto.trim().replace(/\s+/g, ' ').toLowerCase();

// ---------- Flujo de estados del Plan de Mejora ----------

export type AccionPlan = 'editar' | 'enviar' | 'validar' | 'devolver';

const PERMITIDOS: Record<AccionPlan, EstadoVersion[]> = {
  editar: [EstadoVersion.BORRADOR, EstadoVersion.DEVUELTO],
  enviar: [EstadoVersion.BORRADOR, EstadoVersion.DEVUELTO],
  validar: [EstadoVersion.EN_REVISION],
  devolver: [EstadoVersion.EN_REVISION],
};

const MENSAJES: Record<AccionPlan, string> = {
  editar: 'El plan está en validación o ya fue validado; no se puede editar.',
  enviar: 'Solo se puede enviar a validación un plan en Borrador o Devuelto.',
  validar: 'Solo se pueden validar planes que están en validación.',
  devolver: 'Solo se pueden devolver planes que están en validación.',
};

export const esEditable = (estado: EstadoVersion) => PERMITIDOS.editar.includes(estado);

export const verificarTransicion = (estado: EstadoVersion, accion: AccionPlan) => {
  if (!PERMITIDOS[accion].includes(estado)) throw new ConflictException(MENSAJES[accion]);
};

/** Datos mínimos de una recomendación para revisar si está completa antes de enviar. */
export type RecomendacionEnvio = {
  numero: number;
  acciones: number;
  metas: number;
  /** Metas con fecha compromiso y % esperado (hitos de HU-12). */
  metasConfiguradas: number;
  areaResponsable: string | null;
  fechaCumplimiento: string | null;
};

/** Lista lo que le falta a una recomendación para poder enviarse a validación. */
export const faltantes = (r: RecomendacionEnvio, vigenciaInicio: string, vigenciaFin: string): string[] => {
  const falta: string[] = [];
  if (r.acciones === 0) falta.push('acciones para atender la recomendación');
  if (r.metas === 0) falta.push('metas');
  else if (r.metasConfiguradas === 0) falta.push('al menos una meta con fecha y % esperado');
  if (!r.areaResponsable?.trim()) falta.push('área responsable');
  if (!r.fechaCumplimiento) falta.push('fecha de cumplimiento');
  else if (r.fechaCumplimiento < vigenciaInicio || r.fechaCumplimiento > vigenciaFin) falta.push('fecha de cumplimiento dentro del ciclo');
  return falta;
};

/** Un plan se envía con al menos una recomendación y todas completas. */
export const validarEnvio = (recomendaciones: RecomendacionEnvio[], vigenciaInicio: string, vigenciaFin: string) => {
  if (recomendaciones.length === 0) throw new BadRequestException('Agrega al menos una recomendación antes de enviar el plan.');
  const errores = recomendaciones
    .map((r) => ({ numero: r.numero, falta: faltantes(r, vigenciaInicio, vigenciaFin) }))
    .filter((r) => r.falta.length > 0)
    .map((r) => `recomendación ${r.numero}: falta ${r.falta.join(', ')}`);
  if (errores.length) throw new BadRequestException(`Completa el plan antes de enviarlo. ${errores.join('; ')}.`);
};

// ---------- Configuración de Metas ----------

export type MetaConfigurada = { descripcion: string; fechaCompromiso: string; porcentajeEsperado: number };

/**
 * Fecha a partir de la cual se puede poner un hito (HU-12): el día de creación del plan,
 * o el inicio de la vigencia si este es posterior. Fechas en UTC, como toda la base.
 */
export const inicioHitos = (creadoEn: Date, vigenciaInicio: string) => {
  const creado = creadoEn.toISOString().slice(0, 10);
  return creado > vigenciaInicio ? creado : vigenciaInicio;
};

/**
 * Reglas de la Configuración de Metas (HU-12): descripción, fecha y % esperado obligatorios; % entero de 1 a 99
 * (el 100% se alcanza al cumplir la recomendación); fechas en orden ascendente, posteriores a `desde`
 * (creación del plan) y anteriores a `hasta` (fecha de cumplimiento).
 */
export const validarMetas = (metas: MetaConfigurada[], desde: string, hasta: string) => {
  if (metas.length === 0) throw new BadRequestException('Agrega al menos una meta.');
  metas.forEach((m, i) => {
    const n = i + 1;
    if (!m.descripcion.trim()) throw new BadRequestException(`Describe la meta ${n}.`);
    if (!FECHA.test(m.fechaCompromiso)) throw new BadRequestException(`Elige una fecha válida para la meta ${n}.`);
    if (m.fechaCompromiso <= desde || m.fechaCompromiso >= hasta) {
      throw new BadRequestException(`La fecha de la meta ${n} debe ser posterior al ${desde} y anterior al ${hasta}.`);
    }
    if (!Number.isInteger(m.porcentajeEsperado) || m.porcentajeEsperado < 1 || m.porcentajeEsperado > 99) {
      throw new BadRequestException(`El % esperado de la meta ${n} debe ser un número entero entre 1 y 99.`);
    }
    const anterior = metas[i - 1];
    if (anterior && m.fechaCompromiso <= anterior.fechaCompromiso) {
      throw new BadRequestException(`La fecha de la meta ${n} debe ser posterior a la de la meta ${i}.`);
    }
  });
};

// TODO(HU-04): "Metas medibles": decidir con el equipo cómo validar que una meta sea cuantitativa
// (por ejemplo, exigir un número o un porcentaje en el texto).
