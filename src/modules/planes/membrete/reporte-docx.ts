// HU-06 / HU-09 · Reporte en tabla con membrete institucional en Word (.docx editable), armado sin dependencias.
// Lo usan el Plan de Mejora Continua y el Informe de Seguimiento. El membrete (logotipo de la FES Acatlán, licenciatura,
// organismo y vigencia) va en el encabezado de cada página; la fila de títulos de la tabla se repite al cambiar de página.
// Hoja carta horizontal. Las celdas con enlaces generan hipervínculos de Word (HU-09).
import { LOGO_FES } from './logo';
import { fechaGeneracion, lineasMembrete } from './membrete';
import type { CeldaReporte, ReporteTabla } from './reporte-pdf';
import { crearZip } from './zip';

const AZUL = '073766';
const GRIS = '5C6670';
// Carta horizontal en twips (1/1440 in): 11 × 8.5 in, márgenes de 0.5 in a los lados.
const ANCHO_PAGINA = 15840;
const ALTO_PAGINA = 12240;
const MARGEN = 720;
const ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN;
/** Anchos en twips a partir de las proporciones de cada columna (las mismas que usa el PDF). */
const anchosColumnas = (proporciones: number[]) => {
  const total = proporciones.reduce((a, b) => a + b, 0);
  const anchos = proporciones.map((p) => Math.floor((p / total) * ANCHO_UTIL));
  const sobrante = ANCHO_UTIL - anchos.reduce((a, b) => a + b, 0);
  return anchos.map((w, i) => (i === anchos.length - 1 ? w + sobrante : w));
};
// Logo de 2 in de ancho en EMU (914400 por pulgada).
const LOGO_ANCHO_EMU = 2 * 914400;
const LOGO_ALTO_EMU = Math.round((LOGO_ANCHO_EMU * LOGO_FES.alto) / LOGO_FES.ancho);

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const escapar = (texto: string) =>
  texto
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type Formato = { negrita?: boolean; tamano?: number; color?: string; subrayado?: boolean };

const run = (texto: string, f: Formato = {}) => {
  const props = [
    f.negrita ? '<w:b/>' : '',
    f.color ? `<w:color w:val="${f.color}"/>` : '',
    f.subrayado ? '<w:u w:val="single"/>' : '',
    f.tamano ? `<w:sz w:val="${f.tamano * 2}"/><w:szCs w:val="${f.tamano * 2}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapar(texto)}</w:t></w:r>`;
};

const parrafo = (contenido: string, { espacioDespues = 0, alineacion }: { espacioDespues?: number; alineacion?: 'right' | 'center' } = {}) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="${espacioDespues}"/>${alineacion ? `<w:jc w:val="${alineacion}"/>` : ''}</w:pPr>${contenido}</w:p>`;

/** Un párrafo por línea, para que acciones y metas queden en renglones separados y editables. */
const parrafosDe = (texto: string, f: Formato = {}) => texto.split(/\r?\n/).map((linea) => parrafo(run(linea || ' ', f))).join('');

const celda = (ancho: number, contenido: string, { fondo, columnas }: { fondo?: string; columnas?: number } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${columnas ? `<w:gridSpan w:val="${columnas}"/>` : ''}` +
  `${fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fondo}"/>` : ''}</w:tcPr>${contenido}</w:tc>`;

const BORDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFCBD5"/>`).join('');

/** Hipervínculos del documento: cada uno necesita su relación externa en document.xml.rels. */
type Enlaces = { id: string; url: string }[];

const contenidoCelda = (celda: CeldaReporte, enlaces: Enlaces) => {
  const { texto, enlaces: lista = [] } = typeof celda === 'string' ? { texto: celda } : celda;
  const partes = texto || !lista.length ? [parrafosDe(texto ?? '')] : [];
  for (const e of lista) {
    const id = `rIdEnlace${enlaces.length + 1}`;
    enlaces.push({ id, url: e.url });
    partes.push(parrafo(`<w:hyperlink r:id="${id}" w:history="1">${run(e.texto, { color: '0B57D0', subrayado: true })}</w:hyperlink>`));
  }
  return partes.join('');
};

const tabla = (reporte: ReporteTabla, enlaces: Enlaces) => {
  const columnas = anchosColumnas(reporte.columnas.map((c) => c.proporcion));
  const grid = columnas.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const encabezado = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${reporte.columnas.map((c, i) => celda(columnas[i]!, parrafo(run(c.titulo, { negrita: true, color: 'FFFFFF' })), { fondo: AZUL })).join('')}</w:tr>`;
  const filas = reporte.filas.length
    ? reporte.filas.map((fila) => `<w:tr>${fila.map((c, i) => celda(columnas[i]!, contenidoCelda(c, enlaces))).join('')}</w:tr>`).join('')
    : `<w:tr>${celda(ANCHO_UTIL, parrafo(run(reporte.vacio)), { columnas: columnas.length })}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${BORDES}</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${encabezado}${filas}</w:tbl>`;
};

const documento = (reporte: ReporteTabla, enlaces: Enlaces) =>
  `${XML}<w:document ${NS}><w:body>` +
  parrafo(run(reporte.titulo, { negrita: true, tamano: 16, color: AZUL }), { espacioDespues: 60 }) +
  parrafo(run(`${reporte.detalle} · Generado: ${fechaGeneracion()}`, { tamano: 8, color: GRIS }), { espacioDespues: reporte.aviso ? 40 : 160 }) +
  (reporte.aviso ? parrafo(run(reporte.aviso, { negrita: true, tamano: 8, color: 'B3261E' }), { espacioDespues: 160 }) : '') +
  tabla(reporte, enlaces) +
  parrafo('') +
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdEncabezado"/><w:footerReference w:type="default" r:id="rIdPie"/>` +
  `<w:pgSz w:w="${ANCHO_PAGINA}" w:h="${ALTO_PAGINA}" w:orient="landscape"/>` +
  `<w:pgMar w:top="1980" w:right="${MARGEN}" w:bottom="900" w:left="${MARGEN}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>` +
  `</w:body></w:document>`;

const logoInline = () =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${LOGO_ANCHO_EMU}" cy="${LOGO_ALTO_EMU}"/>` +
  `<wp:docPr id="1" name="Logotipo FES Acatlán"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo-fes-acatlan.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_ANCHO_EMU}" cy="${LOGO_ALTO_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
  `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** Encabezado de cada página: logo a la izquierda y los datos de HU-06 a la derecha, sin bordes. */
const encabezado = (reporte: ReporteTabla) => {
  const anchoLogo = 3200;
  const datos = lineasMembrete(reporte.membrete)
    .map(({ etiqueta, valor }) => parrafo(run(`${etiqueta}: `, { negrita: true, tamano: 9, color: AZUL }) + run(valor, { tamano: 9 }), { espacioDespues: 20 }))
    .join('');
  const sinBordes = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="nil"/>`).join('');
  return (
    `${XML}<w:hdr ${NS}><w:tbl><w:tblPr><w:tblW w:w="${ANCHO_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${sinBordes}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${anchoLogo}"/><w:gridCol w:w="${ANCHO_UTIL - anchoLogo}"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${anchoLogo}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${parrafo(logoInline())}</w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${ANCHO_UTIL - anchoLogo}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${datos}</w:tc>` +
    `</w:tr></w:tbl>${parrafo('')}</w:hdr>`
  );
};

const campo = (instruccion: string) =>
  `<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:instrText xml:space="preserve"> ${instruccion} </w:instrText></w:r>` +
  `<w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="14"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;

const pie = () =>
  `${XML}<w:ftr ${NS}>` +
  parrafo(run('Sistema de Seguimiento a la Mejora Continua · FES Acatlán · Página ', { tamano: 7, color: GRIS }) + campo('PAGE') + run(' de ', { tamano: 7, color: GRIS }) + campo('NUMPAGES')) +
  `</w:ftr>`;

const estilos = () =>
  `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="es-MX"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

const TIPOS =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` +
  `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
type Relacion = [id: string, tipo: string, destino: string, externo?: boolean];
const relaciones = (items: Relacion[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, tipo, destino, externo]) => `<Relationship Id="${id}" Type="${tipo}" Target="${escapar(destino)}"${externo ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const propiedades = (tituloDocumento: string) =>
  `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:title>${escapar(tituloDocumento)}</dc:title><dc:creator>Sistema de Seguimiento a la Mejora Continua</dc:creator></cp:coreProperties>`;

/** Arma el .docx del reporte. `tituloDocumento` va en las propiedades del archivo (Archivo → Información). */
export const generarDocxReporte = (reporte: ReporteTabla & { tituloDocumento: string }): Buffer => {
  const enlaces: Enlaces = [];
  const cuerpo = documento(reporte, enlaces);
  return crearZip([
    { nombre: '[Content_Types].xml', datos: Buffer.from(TIPOS, 'utf8') },
    {
      nombre: '_rels/.rels',
      datos: Buffer.from(
        relaciones([
          ['rId1', `${REL}/officeDocument`, 'word/document.xml'],
          ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
        ]),
        'utf8',
      ),
    },
    { nombre: 'docProps/core.xml', datos: Buffer.from(propiedades(reporte.tituloDocumento), 'utf8') },
    { nombre: 'word/document.xml', datos: Buffer.from(cuerpo, 'utf8') },
    { nombre: 'word/styles.xml', datos: Buffer.from(estilos(), 'utf8') },
    { nombre: 'word/header1.xml', datos: Buffer.from(encabezado(reporte), 'utf8') },
    { nombre: 'word/footer1.xml', datos: Buffer.from(pie(), 'utf8') },
    {
      nombre: 'word/_rels/document.xml.rels',
      datos: Buffer.from(
        relaciones([
          ['rIdEstilos', `${REL}/styles`, 'styles.xml'],
          ['rIdEncabezado', `${REL}/header`, 'header1.xml'],
          ['rIdPie', `${REL}/footer`, 'footer1.xml'],
          ...enlaces.map(({ id, url }): Relacion => [id, `${REL}/hyperlink`, url, true]),
        ]),
        'utf8',
      ),
    },
    { nombre: 'word/_rels/header1.xml.rels', datos: Buffer.from(relaciones([['rIdLogo', `${REL}/image`, 'media/logo-fes-acatlan.jpeg']]), 'utf8') },
    { nombre: 'word/media/logo-fes-acatlan.jpeg', datos: LOGO_FES.jpeg },
  ]);
};
