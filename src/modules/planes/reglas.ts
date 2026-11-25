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
  /** HU-04 · metas medibles: cuántas metas no expresan ninguna cifra o porcentaje. */
  metasSinCifra: number;
  areaResponsable: string | null;
  fechaCumplimiento: string | null;
};

/** Lista lo que le falta a una recomendación para poder enviarse a validación. */
export const faltantes = (r: RecomendacionEnvio, vigenciaInicio: string, vigenciaFin: string): string[] => {
  const falta: string[] = [];
  if (r.acciones === 0) falta.push('acciones para atender la recomendación');
  if (r.metas === 0) falta.push('metas');
  else if (r.metasConfiguradas === 0) falta.push('al menos una meta con fecha y % esperado');
  if (r.metasSinCifra > 0) falta.push('una cifra o porcentaje en cada meta (las metas deben ser medibles)');
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

/**
 * HU-04 · "Metas medibles": una meta es cuantitativa si expresa al menos una cifra
 * ("80% de la planta docente", "3 optativas nuevas"). Se exige al enviar, no al guardar el borrador.
 */
export const esMetaCuantitativa = (texto: string) => /\d/.test(texto);

/** Meta capturada en la pantalla del plan: fecha y % son opcionales en el borrador, pero van juntos. */
export type MetaBorrador = { descripcion: string; fechaCompromiso?: string | null; porcentajeEsperado?: number | null };

/**
 * Valida las metas que llegan con la recomendación (captura directa en la pantalla del plan).
 * Fecha compromiso y % esperado se pueden dejar vacíos en el borrador, pero si se escribe uno se exige el otro,
 * y las metas configuradas siguen las mismas reglas que la pestaña Metas (HU-12).
 */
export const validarMetasBorrador = (metas: MetaBorrador[], desde: string, hasta: string) => {
  let anterior: { n: number; fecha: string } | null = null;
  metas.forEach((m, i) => {
    const n = i + 1;
    const conFecha = Boolean(m.fechaCompromiso);
    const conPorcentaje = m.porcentajeEsperado !== null && m.porcentajeEsperado !== undefined;
    if (conFecha !== conPorcentaje) throw new BadRequestException(`Completa la fecha compromiso y el % esperado de la meta ${n}, o deja ambos vacíos.`);
    if (!conFecha) return;
    const fecha = m.fechaCompromiso as string;
    if (!FECHA.test(fecha)) throw new BadRequestException(`Elige una fecha válida para la meta ${n}.`);
    if (fecha <= desde || fecha >= hasta) throw new BadRequestException(`La fecha de la meta ${n} debe ser posterior al ${desde} y anterior al ${hasta}.`);
    const porcentaje = m.porcentajeEsperado as number;
    if (!Number.isInteger(porcentaje) || porcentaje < 1 || porcentaje > 99) {
      throw new BadRequestException(`El % esperado de la meta ${n} debe ser un número entero entre 1 y 99.`);
    }
    if (anterior && fecha <= anterior.fecha) throw new BadRequestException(`La fecha de la meta ${n} debe ser posterior a la de la meta ${anterior.n}.`);
    anterior = { n, fecha };
  });
};

/**
 * HU-05: texto del aviso de devolución con el motivo general y cada observación ligada a su recomendación,
 * en el orden del plan. Las observaciones de recomendaciones desconocidas se ignoran.
 */
export const mensajeDevolucion = (
  motivo: string,
  observaciones: ReadonlyArray<{ recomendacionId: string; comentario: string }>,
  recomendaciones: ReadonlyArray<{ id: string; numero: number }>,
) => {
  const numeroDe = new Map(recomendaciones.map((r) => [r.id, r.numero]));
  const lineas = observaciones
    .filter((o) => numeroDe.has(o.recomendacionId))
    .sort((a, b) => (numeroDe.get(a.recomendacionId) ?? 0) - (numeroDe.get(b.recomendacionId) ?? 0))
    .map((o) => `• Recomendación ${numeroDe.get(o.recomendacionId)}: ${o.comentario.trim()}`);
  const encabezado = `La Administración devolvió tu plan de mejora. Motivo: ${motivo.trim()}`;
  return lineas.length ? `${encabezado}\n\nObservaciones:\n${lineas.join('\n')}` : encabezado;
};

// ---------- HU-18 · Ciclos de acreditación ----------

export const VIGENCIA_MAXIMA_ANIOS = 5;
export const MENSAJE_CICLO_FINALIZADO = 'El ciclo de acreditación ha finalizado. Contacte a la Unidad de Planeación para iniciar un nuevo ciclo.';

const esFechaReal = (fecha: string) => FECHA.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) && new Date(`${fecha}T00:00:00Z`).toISOString().startsWith(fecha);
const sumarAnios = (fecha: string, anios: number) => `${Number(fecha.slice(0, 4)) + anios}${fecha.slice(4)}`;

/** Fecha de hoy (AAAA-MM-DD) en la hora de la FES Acatlán, no en la del servidor. */
export const hoyEnMexico = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(ahora);

/** Identificadores BIGINT que llegan como texto en la URL o el cuerpo. */
export const validarId = (id: string, campo: string) => {
  if (!/^\d{1,19}$/.test(id)) throw new BadRequestException(`El identificador de ${campo} no es válido.`);
  return id;
};

/** Vigencia capturada por la Administradora: fechas reales, fin después del inicio, máximo 5 años y emisión antes del fin. */
export const validarVigencia = ({ fechaEmision, vigenciaInicio, vigenciaFin }: { fechaEmision: string; vigenciaInicio: string; vigenciaFin: string }) => {
  if (![fechaEmision, vigenciaInicio, vigenciaFin].every(esFechaReal)) {
    throw new BadRequestException('Escribe fechas válidas (AAAA-MM-DD) para la emisión y la vigencia.');
  }
  if (vigenciaFin <= vigenciaInicio) throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio.');
  if (vigenciaFin > sumarAnios(vigenciaInicio, VIGENCIA_MAXIMA_ANIOS)) {
    throw new BadRequestException(`El ciclo no puede durar más de ${VIGENCIA_MAXIMA_ANIOS} años.`);
  }
  if (fechaEmision > vigenciaFin) throw new BadRequestException('La fecha de emisión de la constancia debe ser anterior al fin de la vigencia.');
};

/** Nombre del ciclo: el que escriba la Administradora o, si lo deja vacío, "AAAA-AAAA" con los años de la vigencia. */
export const nombreCiclo = (nombre: string | undefined, vigenciaInicio: string, vigenciaFin: string) => {
  const limpio = nombre?.trim().replace(/\s+/g, ' ');
  if (!limpio) return `${vigenciaInicio.slice(0, 4)}-${vigenciaFin.slice(0, 4)}`;
  if (limpio.length > 40) throw new BadRequestException('El nombre del ciclo admite hasta 40 caracteres.');
  if (/[\\/:*?"<>|]/.test(limpio)) throw new BadRequestException('El nombre del ciclo no puede llevar \\ / : * ? " < > |, porque se usa como nombre de carpeta.');
  return limpio;
};

/** Un ciclo VIGENTE sigue activo hasta su fecha de fin, inclusive. */
export const cicloActivo = (ciclo: { estado: string; vigenciaFin: string }, hoy: string) => ciclo.estado === 'VIGENTE' && hoy <= ciclo.vigenciaFin;

/** Bloqueo automático al terminar la vigencia (HU-18): sin captura de plan, avances ni evidencias. */
export const verificarCicloAbierto = (ciclo: { estado: string; vigenciaFin: string }, hoy: string) => {
  if (!cicloActivo(ciclo, hoy)) throw new ConflictException(MENSAJE_CICLO_FINALIZADO);
};

/** Segmento de carpeta seguro: sin separadores ni caracteres que Windows o Drive rechazan. */
const segmento = (texto: string) => texto.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '') || 'sin-nombre';

/** Estructura de HU-18: /Evidencias/[Licenciatura]/[20XX-20XX]/ */
export const rutaCarpetaCiclo = (licenciatura: string, nombre: string) => ['Evidencias', segmento(licenciatura), segmento(nombre)];
