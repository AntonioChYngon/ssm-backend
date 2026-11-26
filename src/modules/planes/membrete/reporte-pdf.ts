// HU-06 / HU-09 · Reporte en tabla con membrete institucional, en PDF escrito a mano (sin binarios ni servicios externos).
// Lo usan el Plan de Mejora Continua y el Informe de Seguimiento. Hoja A4 horizontal (842 × 595 pt), Helvetica.
// Cada página lleva el logotipo de la FES Acatlán, el título, las líneas del membrete y la fila de títulos de la tabla.
// Las celdas pueden traer enlaces: se dibujan en azul subrayado y llevan una anotación /Link clickeable (HU-09).
import { LOGO_FES } from './logo';
import { DatosMembrete, fechaGeneracion, lineasMembrete } from './membrete';

export type EnlaceReporte = { texto: string; url: string };
/** Texto (los saltos de línea separan renglones) y, opcionalmente, enlaces debajo del texto. */
export type CeldaReporte = string | { texto?: string; enlaces?: EnlaceReporte[] };

export type ReporteTabla = {
  titulo: string;
  membrete: DatosMembrete;
  /** Línea gris bajo el membrete (estado, fechas). Se le agrega "Generado: …". */
  detalle: string;
  /** Aviso destacado en rojo bajo el detalle (p. ej., versión preliminar). */
  aviso?: string;
  columnas: { titulo: string; proporcion: number }[];
  filas: CeldaReporte[][];
  /** Texto cuando no hay filas. */
  vacio: string;
};

const ANCHO = 842;
const ALTO = 595;
const MARGEN = 32;
const ANCHO_TABLA = ANCHO - 2 * MARGEN;
const ALTO_CABECERA = 29;
const ALTO_LINEA = 9;
const FIN_PAGINA = 40;
const AZUL_ENLACE = '0.05 0.33 0.75';

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

/** Ancho aproximado de Helvetica: suficiente para partir renglones y medir enlaces. */
const anchoTexto = (texto: string, fuente: number) => texto.length * fuente * 0.53;

export const envolver = (texto: string, ancho: number, fuente = 7) => {
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

const linea = (x1: number, y1: number, x2: number, y2: number, color = '0.78 0.82 0.86') =>
  `q ${color} RG 0.45 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`;

/** URL dentro de un string literal de PDF: se escapan \ ( ) y se descartan caracteres fuera de ASCII imprimible. */
const uriPdf = (url: string) => url.replace(/[^\x20-\x7e]/g, encodeURIComponent).replace(/[\\()]/g, (c) => `\\${c}`);

// Logo de 150 pt de ancho en la esquina superior izquierda; el texto del membrete va a su derecha.
const LOGO_ANCHO = 150;
const LOGO_ALTO = (LOGO_ANCHO * LOGO_FES.alto) / LOGO_FES.ancho;
const X_MEMBRETE = MARGEN + LOGO_ANCHO + 18;

type Renglon = { texto: string; url?: string };
type Anotacion = { rect: [number, number, number, number]; url: string };

/** Renglones de una celda ya partidos al ancho de la columna; los de enlace guardan su URL. */
const renglonesDe = (celda: CeldaReporte, ancho: number, fuente: number): Renglon[] => {
  const { texto: contenido, enlaces = [] } = typeof celda === 'string' ? { texto: celda } : celda;
  const renglones: Renglon[] = contenido || !enlaces.length ? envolver(contenido ?? '', ancho, fuente).map((t) => ({ texto: t })) : [];
  for (const e of enlaces) envolver(e.texto, ancho, fuente).forEach((t) => renglones.push({ texto: t, url: e.url }));
  return renglones;
};

export const generarPdfReporte = (reporte: ReporteTabla): Buffer => {
  const total = reporte.columnas.reduce((a, c) => a + c.proporcion, 0);
  const anchos = reporte.columnas.map((c) => (c.proporcion / total) * ANCHO_TABLA);
  const paginas: { comandos: string[]; anotaciones: Anotacion[] }[] = [];
  let pagina = { comandos: [] as string[], anotaciones: [] as Anotacion[] };
  let y = 0;
  const generado = fechaGeneracion();

  const abrirPagina = () => {
    pagina = { comandos: [], anotaciones: [] };
    paginas.push(pagina);
    const c = pagina.comandos;
    // Membrete institucional en cada página: logotipo de la FES Acatlán, título y datos del ciclo.
    c.push(`q ${LOGO_ANCHO} 0 0 ${LOGO_ALTO.toFixed(2)} ${MARGEN} ${(ALTO - 22 - LOGO_ALTO).toFixed(2)} cm /Logo Do Q`);
    c.push(texto(X_MEMBRETE, 556, reporte.titulo, 15, '0.02 0.20 0.38'));
    let yMembrete = 541;
    for (const { etiqueta, valor } of lineasMembrete(reporte.membrete)) {
      envolver(`${etiqueta}: ${valor}`, ANCHO - MARGEN - X_MEMBRETE, 8.5).slice(0, 2).forEach((t) => {
        c.push(texto(X_MEMBRETE, yMembrete, t, 8.5));
        yMembrete -= 11;
      });
    }
    c.push(texto(MARGEN, 503, `${reporte.detalle} · Generado: ${generado}`, 7, '0.36 0.40 0.44'));
    let top = 494;
    if (reporte.aviso) {
      c.push(texto(MARGEN, 492, reporte.aviso, 7.5, '0.70 0.10 0.10'));
      top = 484;
    }
    c.push(caja(MARGEN, top - ALTO_CABECERA, ANCHO_TABLA, ALTO_CABECERA, '0.02 0.20 0.38'));
    let x = MARGEN;
    reporte.columnas.forEach((columna, i) => {
      envolver(columna.titulo, anchos[i]! - 8, 6.5).slice(0, 2).forEach((t, n) => c.push(texto(x + 4, top - 11 - n * 8, t, 6.5, '1 1 1')));
      if (i > 0) c.push(linea(x, top, x, top - ALTO_CABECERA));
      x += anchos[i]!;
    });
    c.push(linea(MARGEN, top, MARGEN + ANCHO_TABLA, top));
    y = top - ALTO_CABECERA;
  };

  abrirPagina();
  if (reporte.filas.length === 0) {
    pagina.comandos.push(caja(MARGEN, y - 28, ANCHO_TABLA, 28));
    pagina.comandos.push(texto(MARGEN + 8, y - 18, reporte.vacio, 8));
    y -= 28;
  }

  for (const fila of reporte.filas) {
    const celdas = fila.map((valor, i) => renglonesDe(valor, anchos[i]! - 8, i === 0 ? 6.7 : 7));
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
      pagina.comandos.push(caja(MARGEN, base - alto, ANCHO_TABLA, alto));
      let x = MARGEN;
      celdas.forEach((renglones, i) => {
        const fuente = i === 0 ? 6.7 : 7;
        renglones.slice(desplazamiento, desplazamiento + cantidad).forEach((r, j) => {
          const yTexto = base - 12 - j * ALTO_LINEA;
          if (!r.url) {
            pagina.comandos.push(texto(x + 4, yTexto, r.texto, fuente));
            return;
          }
          // HU-09: enlace visible (azul, subrayado) y clickeable.
          const ancho = Math.min(anchoTexto(r.texto, fuente), anchos[i]! - 8);
          pagina.comandos.push(texto(x + 4, yTexto, r.texto, fuente, AZUL_ENLACE));
          pagina.comandos.push(linea(x + 4, yTexto - 1.2, x + 4 + ancho, yTexto - 1.2, AZUL_ENLACE));
          pagina.anotaciones.push({ rect: [x + 3, yTexto - 2.5, x + 5 + ancho, yTexto + fuente], url: r.url });
        });
        x += anchos[i]!;
        if (i < celdas.length - 1) pagina.comandos.push(linea(x, base, x, base - alto));
      });
      y -= alto;
      desplazamiento += cantidad;
    }
  }

  paginas.forEach((p, i) =>
    p.comandos.push(texto(MARGEN, 20, `Sistema de Seguimiento a la Mejora Continua · FES Acatlán · Página ${i + 1} de ${paginas.length}`, 7, '0.42 0.46 0.50')),
  );

  // Objetos: 1 catálogo, 2 páginas, 3 fuente, 4 logo, luego página/contenido por página y al final las anotaciones.
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
  let siguienteId = 5 + paginas.length * 2;
  paginas.forEach((p, i) => {
    const idPagina = idsPagina[i]!;
    const idContenido = idPagina + 1;
    const stream = p.comandos.join('\n');
    const idsAnotacion = p.anotaciones.map(({ rect, url }) => {
      const id = siguienteId++;
      objeto(id, `<< /Type /Annot /Subtype /Link /Rect [${rect.map((n) => n.toFixed(2)).join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${uriPdf(url)}) >> >>`);
      return id;
    });
    const anotaciones = idsAnotacion.length ? ` /Annots [${idsAnotacion.map((id) => `${id} 0 R`).join(' ')}]` : '';
    objeto(
      idPagina,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R >> /XObject << /Logo 4 0 R >> >>${anotaciones} /Contents ${idContenido} 0 R >>`,
    );
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
