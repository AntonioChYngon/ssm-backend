// HU-04/HU-06 · Plan de Mejora Continua en PDF, escrito a mano (sin binarios del sistema ni servicios externos).
// Membrete en cada página: logotipo de la FES Acatlán, licenciatura, organismo o IEVA y vigencia de la acreditación.
import { LOGO_FES } from './membrete/logo';
import { celdasRecomendacion, COLUMNAS_PLAN, DatosMembrete, fechaGeneracion, lineasMembrete, RecomendacionReporte } from './membrete/membrete';

type PlanPdf = DatosMembrete & {
  estado: string;
  actualizado: string;
  recomendacionesDetalle: RecomendacionReporte[];
};

const ANCHO = 842;
const ALTO = 595;
const MARGEN = 32;
const ANCHOS = [25, 72, 83, 155, 118, 118, 104, 103];
const ALTO_CABECERA = 29;
const ALTO_LINEA = 9;
const FIN_PAGINA = 40;

const cp1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96,
  '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

const pdfHex = (texto: string) => [...texto.normalize('NFC')].map((caracter) => {
  const codigo = cp1252[caracter] ?? caracter.codePointAt(0) ?? 0x3f;
  return (codigo >= 32 && codigo <= 255 ? codigo : 0x3f).toString(16).padStart(2, '0');
}).join('').toUpperCase();

const envolver = (texto: string, ancho: number, fuente = 7) => {
  const maxCaracteres = Math.max(1, Math.floor(ancho / (fuente * 0.53)));
  const lineas: string[] = [];
  for (const parrafo of String(texto || '—').split(/\r?\n/)) {
    const palabras = parrafo.trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) {
      lineas.push('');
      continue;
    }
    let linea = '';
    for (const palabra of palabras) {
      if (palabra.length > maxCaracteres) {
        if (linea) lineas.push(linea);
        linea = '';
        for (let i = 0; i < palabra.length; i += maxCaracteres) {
          const parte = palabra.slice(i, i + maxCaracteres);
          if (i + maxCaracteres < palabra.length) lineas.push(parte);
          else linea = parte;
        }
        continue;
      }
      const siguiente = linea ? `${linea} ${palabra}` : palabra;
      if (siguiente.length > maxCaracteres) {
        lineas.push(linea);
        linea = palabra;
      } else linea = siguiente;
    }
    if (linea) lineas.push(linea);
  }
  return lineas.length ? lineas : ['—'];
};

const texto = (x: number, y: number, valor: string, fuente = 7, color = '0.12 0.18 0.24') =>
  `BT /F1 ${fuente} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${pdfHex(valor)}> Tj ET`;

const caja = (x: number, y: number, ancho: number, alto: number, relleno?: string) =>
  relleno
    ? `q ${relleno} rg ${x} ${y} ${ancho} ${alto} re f Q`
    : `q 0.78 0.82 0.86 RG 0.45 w ${x} ${y} ${ancho} ${alto} re S Q`;

const linea = (x1: number, y1: number, x2: number, y2: number) =>
  `q 0.78 0.82 0.86 RG 0.45 w ${x1} ${y1} m ${x2} ${y2} l S Q`;

// Logo de 150 pt de ancho en la esquina superior izquierda; el texto del membrete va a su derecha.
const LOGO_ANCHO = 150;
const LOGO_ALTO = (LOGO_ANCHO * LOGO_FES.alto) / LOGO_FES.ancho;
const X_MEMBRETE = MARGEN + LOGO_ANCHO + 18;

/** Crea el PDF paginado del Plan de Mejora Continua con el membrete institucional de HU-06. */
export const generarPdfPlan = (plan: PlanPdf): Buffer => {
  const paginas: string[][] = [];
  let comandos: string[] = [];
  let y = 0;

  const abrirPagina = () => {
    comandos = [];
    paginas.push(comandos);
    // HU-06: membrete con el logotipo de la FES Acatlán en cada página.
    comandos.push(`q ${LOGO_ANCHO} 0 0 ${LOGO_ALTO.toFixed(2)} ${MARGEN} ${(ALTO - 22 - LOGO_ALTO).toFixed(2)} cm /Logo Do Q`);
    // HU-04: el reporte en tabla se titula "Plan de Mejora Continua" (Anexo 1).
    comandos.push(texto(X_MEMBRETE, 556, 'Plan de Mejora Continua', 15, '0.02 0.20 0.38'));
    let yMembrete = 541;
    for (const { etiqueta, valor } of lineasMembrete(plan)) {
      const lineas = envolver(`${etiqueta}: ${valor}`, ANCHO - MARGEN - X_MEMBRETE, 8.5);
      lineas.slice(0, 2).forEach((t) => {
        comandos.push(texto(X_MEMBRETE, yMembrete, t, 8.5));
        yMembrete -= 11;
      });
    }
    comandos.push(texto(MARGEN, 503, `Estado: ${plan.estado.replaceAll('_', ' ')} · Última actualización: ${plan.actualizado} · Generado: ${fechaGeneracion()}`, 7, '0.36 0.40 0.44'));
    const top = 494;
    comandos.push(caja(MARGEN, top - ALTO_CABECERA, ANCHOS.reduce((a, b) => a + b, 0), ALTO_CABECERA, '0.02 0.20 0.38'));
    let x = MARGEN;
    COLUMNAS_PLAN.forEach((encabezado, i) => {
      const lineas = envolver(encabezado, ANCHOS[i] - 8, 6.5);
      lineas.slice(0, 2).forEach((t, n) => comandos.push(texto(x + 4, top - 11 - n * 8, t, 6.5, '1 1 1')));
      if (i > 0) comandos.push(linea(x, top, x, top - ALTO_CABECERA));
      x += ANCHOS[i];
    });
    comandos.push(linea(MARGEN, top, MARGEN + ANCHOS.reduce((a, b) => a + b, 0), top));
    y = top - ALTO_CABECERA;
  };

  const filas = plan.recomendacionesDetalle.map(celdasRecomendacion);

  abrirPagina();
  if (filas.length === 0) {
    comandos.push(caja(MARGEN, y - 28, ANCHOS.reduce((a, b) => a + b, 0), 28));
    comandos.push(texto(MARGEN + 8, y - 18, 'El plan aún no contiene recomendaciones.', 8));
    y -= 28;
  }

  for (const fila of filas) {
    const celdas = fila.map((valor, i) => envolver(valor, ANCHOS[i] - 8));
    const maxLineas = Math.max(...celdas.map((c) => c.length));
    let desplazamiento = 0;
    while (desplazamiento < maxLineas) {
      let disponibles = Math.floor((y - FIN_PAGINA - 8) / ALTO_LINEA);
      if (disponibles < 1) {
        abrirPagina();
        disponibles = Math.floor((y - FIN_PAGINA - 8) / ALTO_LINEA);
      }
      const cantidad = Math.min(disponibles, maxLineas - desplazamiento);
      const alto = cantidad * ALTO_LINEA + 8;
      const base = y;
      const totalAncho = ANCHOS.reduce((a, b) => a + b, 0);
      comandos.push(caja(MARGEN, base - alto, totalAncho, alto));
      let x = MARGEN;
      celdas.forEach((lineas, i) => {
        lineas.slice(desplazamiento, desplazamiento + cantidad).forEach((t, j) => {
          comandos.push(texto(x + 4, base - 12 - j * ALTO_LINEA, t, i === 0 ? 6.7 : 7));
        });
        x += ANCHOS[i];
        if (i < celdas.length - 1) comandos.push(linea(x, base, x, base - alto));
      });
      y -= alto;
      desplazamiento += cantidad;
    }
  }

  paginas.forEach((contenido, i) => contenido.push(texto(MARGEN, 20, `Sistema de Seguimiento a la Mejora Continua · FES Acatlán · Página ${i + 1} de ${paginas.length}`, 7, '0.42 0.46 0.50')));

  // Objetos del PDF: texto (diccionarios y contenido de páginas) o binario (el JPEG del logo).
  const objetos: Buffer[] = [];
  const objeto = (id: number, cuerpo: string) => (objetos[id] = Buffer.from(cuerpo, 'latin1'));
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const idsPagina = paginas.map((_, i) => 5 + i * 2);
  objeto(2, `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`);
  objeto(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objetos[4] = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${LOGO_FES.ancho} /Height ${LOGO_FES.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO_FES.jpeg.length} >>\nstream\n`,
      'latin1',
    ),
    LOGO_FES.jpeg,
    Buffer.from('\nendstream', 'latin1'),
  ]);
  paginas.forEach((contenido, i) => {
    const idPagina = idsPagina[i]!;
    const idContenido = idPagina + 1;
    const stream = contenido.join('\n');
    objeto(idPagina, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R >> /XObject << /Logo 4 0 R >> >> /Contents ${idContenido} 0 R >>`);
    objeto(idContenido, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let longitud = partes[0]!.length;
  const offsets = [0];
  for (let id = 1; id < objetos.length; id++) {
    offsets[id] = longitud;
    const parte = Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'latin1'), objetos[id]!, Buffer.from('\nendobj\n', 'latin1')]);
    partes.push(parte);
    longitud += parte.length;
  }
  let cola = `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) cola += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  cola += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${longitud}\n%%EOF`;
  partes.push(Buffer.from(cola, 'latin1'));
  return Buffer.concat(partes);
};
