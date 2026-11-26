// Bloque Informe de Seguimiento (HU-07, HU-08, HU-11) · Reglas de negocio puras (sin base de datos).
// Decisiones en docs/decisiones.md (D9). El Plan de Mejora tiene sus propias reglas en planes/reglas.ts y no se toca.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';
import { rutaCarpetaCiclo } from '../planes/reglas';

// ---------- Periodo del informe: un informe por semestre ----------

type FechaDelAnio = {
  /** Años que se suman al año del nombre: -1 = el año anterior (p. ej. 2027-1 empieza en agosto de 2026). */
  anio: number;
  mes: number;
  dia: number;
};
export type DefinicionSemestre = { sufijo: number; inicio: FechaDelAnio; fin: FechaDelAnio };

/**
 * Calendario de semestres del informe (decisión del 25/11/2026: calendario UNAM).
 *   AAAA-1 = 1 de agosto del año anterior al 31 de enero  ·  AAAA-2 = 1 de febrero al 31 de julio.
 *
 * Es el ÚNICO lugar donde se definen las fechas. Para cambiar de calendario, reemplaza esta constante;
 * nombres, cortes, recortes a la vigencia y las pruebas de reglas.spec.ts se ajustan solos.
 * Ejemplo con semestres de calendario (enero–junio / julio–diciembre):
 *   { sufijo: 1, inicio: { anio: 0, mes: 1, dia: 1 }, fin: { anio: 0, mes: 6, dia: 30 } },
 *   { sufijo: 2, inicio: { anio: 0, mes: 7, dia: 1 }, fin: { anio: 0, mes: 12, dia: 31 } },
 * Si se cambia con datos reales cargados, los informes ya creados conservan sus fechas: solo los nuevos usan el calendario nuevo.
 * Los semestres deben cubrir todo el año, sin huecos ni traslapes (lo revisa reglas.spec.ts).
 */
export const SEMESTRES: ReadonlyArray<DefinicionSemestre> = [
  { sufijo: 1, inicio: { anio: -1, mes: 8, dia: 1 }, fin: { anio: 0, mes: 1, dia: 31 } },
  { sufijo: 2, inicio: { anio: 0, mes: 2, dia: 1 }, fin: { anio: 0, mes: 7, dia: 31 } },
];

export type Semestre = { nombre: string; inicio: string; fin: string };
export type PeriodoInforme = Semestre & { fechaCorte: string };

const dosDigitos = (n: number) => String(n).padStart(2, '0');
const fechaDe = (anioNombre: number, f: FechaDelAnio) => `${anioNombre + f.anio}-${dosDigitos(f.mes)}-${dosDigitos(f.dia)}`;

/** Semestre (según SEMESTRES) al que pertenece una fecha AAAA-MM-DD. */
export const semestreDe = (fecha: string, calendario: ReadonlyArray<DefinicionSemestre> = SEMESTRES): Semestre => {
  const anio = Number(fecha.slice(0, 4));
  for (const anioNombre of [anio - 1, anio, anio + 1]) {
    for (const s of calendario) {
      const inicio = fechaDe(anioNombre, s.inicio);
      const fin = fechaDe(anioNombre, s.fin);
      if (inicio <= fecha && fecha <= fin) return { nombre: `${anioNombre}-${s.sufijo}`, inicio, fin };
    }
  }
  throw new Error(`SEMESTRES no cubre la fecha ${fecha}. Revisa la constante en informes/reglas.ts.`);
};

/**
 * Periodo del informe que corresponde a `fecha` dentro de la vigencia del ciclo: el semestre recortado a la vigencia
 * (el primero y el último pueden ser más cortos). El corte es el último día del periodo. null si la fecha está fuera del ciclo.
 */
export const periodoDelInforme = (fecha: string, vigenciaInicio: string, vigenciaFin: string): PeriodoInforme | null => {
  if (fecha < vigenciaInicio || fecha > vigenciaFin) return null;
  const s = semestreDe(fecha);
  const inicio = s.inicio < vigenciaInicio ? vigenciaInicio : s.inicio;
  const fin = s.fin > vigenciaFin ? vigenciaFin : s.fin;
  return { nombre: s.nombre, inicio, fin, fechaCorte: fin };
};

// ---------- % de avance ----------

export const MENSAJE_PORCENTAJE = 'El avance debe ser un número entero de 0 a 100.';

/** El % se escribe con teclado: solo enteros de 0 a 100 (decisión del 25/11/2026; HU-07 decía "catálogo"). */
export const validarPorcentaje = (valor: unknown): number => {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > 100) throw new BadRequestException(MENSAJE_PORCENTAJE);
  return valor;
};

/** Con 100 % la recomendación necesita al menos una evidencia para enviar el informe. */
export const evidenciaObligatoria = (porcentaje: number | null) => porcentaje === 100;

/**
 * % que el plan comprometía a la fecha de corte: el mayor % esperado de las metas con fecha compromiso
 * hasta el corte (incluido). null si ninguna meta vence antes del corte. Solo informativo (HU-08); HU-10 lo usará para alertas.
 */
export const esperadoAlCorte = (
  metas: ReadonlyArray<{ fechaCompromiso: string | null; porcentajeEsperado: number | null }>,
  fechaCorte: string,
): number | null => {
  const vencidas = metas.filter((m) => m.fechaCompromiso && m.fechaCompromiso <= fechaCorte && m.porcentajeEsperado != null);
  return vencidas.length ? Math.max(...vencidas.map((m) => m.porcentajeEsperado as number)) : null;
};

// ---------- Envío (HU-07 → HU-11) ----------

export type AvanceEnvio = { numero: number; porcentaje: number | null; evidencias: number };

/** Lo que le falta a una recomendación para poder enviar el informe. */
export const faltantesAvance = (a: AvanceEnvio): string[] => {
  if (a.porcentaje === null) return ['el % de avance'];
  if (evidenciaObligatoria(a.porcentaje) && a.evidencias === 0) return ['al menos una evidencia (está al 100 %)'];
  return [];
};

/** El informe se envía con todas las recomendaciones del plan aprobado con su % y evidencia en las que están al 100 %. */
export const validarEnvioInforme = (avances: AvanceEnvio[]) => {
  if (avances.length === 0) throw new BadRequestException('El plan aprobado no tiene recomendaciones que reportar.');
  const errores = avances
    .map((a) => ({ numero: a.numero, falta: faltantesAvance(a) }))
    .filter((a) => a.falta.length > 0)
    .map((a) => `Recomendación ${a.numero}: falta ${a.falta.join(', ')}`);
  if (errores.length) throw new BadRequestException(`Completa el informe antes de enviarlo. ${errores.join('; ')}.`);
};

// ---------- Estados del informe ----------

export type AccionInforme = 'editar' | 'enviar' | 'validar' | 'devolver' | 'reabrir';

const PERMITIDOS: Record<AccionInforme, EstadoVersion[]> = {
  editar: [EstadoVersion.BORRADOR, EstadoVersion.DEVUELTO],
  enviar: [EstadoVersion.BORRADOR, EstadoVersion.DEVUELTO],
  validar: [EstadoVersion.EN_REVISION],
  devolver: [EstadoVersion.EN_REVISION],
  reabrir: [EstadoVersion.APROBADO],
};

const MENSAJES: Record<AccionInforme, string> = {
  editar: 'El informe está en revisión o ya fue aprobado; no se puede editar.',
  enviar: 'Solo se puede enviar un informe en Borrador o Devuelto.',
  validar: 'Solo se pueden validar informes que están en revisión.',
  devolver: 'Solo se pueden devolver informes que están en revisión.',
  reabrir: 'Solo se pueden reabrir informes aprobados.',
};

export const verificarTransicionInforme = (estado: EstadoVersion, accion: AccionInforme) => {
  if (!PERMITIDOS[accion].includes(estado)) throw new ConflictException(MENSAJES[accion]);
};

export type BloqueoInforme = 'CICLO_CERRADO' | 'EN_REVISION' | 'APROBADO';

/**
 * Por qué la coordinación no puede editar (null = sí puede). El estado manda sobre el ciclo: un informe aprobado
 * de un ciclo cerrado se muestra como APROBADO. Las acciones del Administrador no dependen del ciclo (decisión del 25/11/2026).
 */
export const bloqueoInforme = (estado: EstadoVersion, cicloAbierto: boolean): BloqueoInforme | null => {
  if (estado === EstadoVersion.APROBADO) return 'APROBADO';
  if (estado === EstadoVersion.EN_REVISION) return 'EN_REVISION';
  return cicloAbierto ? null : 'CICLO_CERRADO';
};

// ---------- Evidencias (HU-07) ----------

export const EXTENSIONES_EVIDENCIA = ['.pdf', '.docx', '.xlsx', '.pptx'] as const;
export type ExtensionEvidencia = (typeof EXTENSIONES_EVIDENCIA)[number];
export const MB_EVIDENCIA_POR_DEFECTO = 15;

/** Error que el servicio traduce a 413 (peso) o 415 (tipo). */
export class ArchivoNoPermitido extends Error {
  constructor(
    readonly motivo: 'PESO' | 'TIPO',
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const FIRMA_PDF = Buffer.from('%PDF-');
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // .docx/.xlsx/.pptx son ZIP

/**
 * Revisa extensión, peso y firma del contenido (no basta el nombre ni el tipo que manda el navegador).
 * Devuelve la extensión normalizada.
 */
export const validarArchivoEvidencia = (archivo: { nombre: string; tamano: number; inicio: Buffer }, maxMb = MB_EVIDENCIA_POR_DEFECTO): ExtensionEvidencia => {
  const punto = archivo.nombre.lastIndexOf('.');
  const extension = (punto >= 0 ? archivo.nombre.slice(punto) : '').toLowerCase();
  if (!(EXTENSIONES_EVIDENCIA as readonly string[]).includes(extension)) {
    throw new ArchivoNoPermitido('TIPO', 'Solo se aceptan archivos .pdf, .docx, .xlsx o .pptx.');
  }
  if (archivo.tamano <= 0) throw new ArchivoNoPermitido('TIPO', 'El archivo está vacío.');
  if (archivo.tamano > maxMb * 1024 * 1024) throw new ArchivoNoPermitido('PESO', `El archivo pesa más de ${maxMb} MB.`);
  const firma = extension === '.pdf' ? FIRMA_PDF : FIRMA_ZIP;
  if (!archivo.inicio.subarray(0, firma.length).equals(firma)) {
    throw new ArchivoNoPermitido('TIPO', `El contenido del archivo no corresponde a un ${extension}.`);
  }
  return extension as ExtensionEvidencia;
};

/** Plan B de HU-07: solo enlaces http(s) completos. */
export const validarUrlEvidencia = (texto: string): string => {
  const limpia = texto.trim();
  let url: URL;
  try {
    url = new URL(limpia);
  } catch {
    throw new BadRequestException('Escribe un enlace completo que empiece con http:// o https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('El enlace debe empezar con http:// o https://.');
  if (limpia.length > 2000) throw new BadRequestException('El enlace es demasiado largo.');
  return limpia;
};

/** Carpeta de las evidencias de una recomendación: /Evidencias/[Licenciatura]/[Ciclo]/Informe-[2026-1]/Rec-[NN]/ */
export const rutaCarpetaEvidencias = (licenciatura: string, ciclo: string, periodo: string, numeroRecomendacion: number) => [
  ...rutaCarpetaCiclo(licenciatura, ciclo),
  `Informe-${periodo}`,
  `Rec-${dosDigitos(numeroRecomendacion)}`,
];

// ---------- Avisos ----------

/** Texto del aviso de devolución o reapertura con cada observación ligada a su número de recomendación. */
export const mensajeObservacionesInforme = (
  encabezado: string,
  observaciones: ReadonlyArray<{ recomendacionId: string; comentario: string }>,
  recomendaciones: ReadonlyArray<{ recomendacionId: string; numero: number }>,
) => {
  const numeroDe = new Map(recomendaciones.map((r) => [r.recomendacionId, r.numero]));
  const lineas = observaciones
    .filter((o) => numeroDe.has(o.recomendacionId) && o.comentario.trim())
    .sort((a, b) => (numeroDe.get(a.recomendacionId) ?? 0) - (numeroDe.get(b.recomendacionId) ?? 0))
    .map((o) => `• Recomendación ${numeroDe.get(o.recomendacionId)}: ${o.comentario.trim()}`);
  return lineas.length ? `${encabezado}\n\nObservaciones:\n${lineas.join('\n')}` : encabezado;
};
