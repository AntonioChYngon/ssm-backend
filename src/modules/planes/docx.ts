// HU-06 · Plan de Mejora Continua en Word (.docx editable), armado sin dependencias externas.
// El membrete (logotipo de la FES Acatlán, licenciatura, organismo y vigencia) va en el encabezado de cada página;
// la tabla del Anexo 1 repite su fila de títulos al cambiar de página. Hoja carta horizontal.
import { LOGO_FES } from './membrete/logo';
import { celdasRecomendacion, COLUMNAS_PLAN, DatosMembrete, fechaGeneracion, lineasMembrete, RecomendacionReporte } from './membrete/membrete';
import { crearZip } from './membrete/zip';

export type PlanWord = DatosMembrete & {
  estado: string;
  actualizado: string;
  recomendacionesDetalle: RecomendacionReporte[];
};

const AZUL = '073766';
const GRIS = '5C6670';
// Carta horizontal en twips (1/1440 in): 11 × 8.5 in, márgenes de 0.5 in a los lados.
const ANCHO_PAGINA = 15840;
const ALTO_PAGINA = 12240;
const MARGEN = 720;
const ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN;
// Mismas proporciones de columnas que el PDF.
const PROPORCIONES = [25, 72, 83, 155, 118, 118, 104, 103];
const COLUMNAS_TWIPS = (() => {
  const total = PROPORCIONES.reduce((a, b) => a + b, 0);
  const anchos = PROPORCIONES.map((p) => Math.floor((p / total) * ANCHO_UTIL));
  const sobrante = ANCHO_UTIL - anchos.reduce((a, b) => a + b, 0);
  return anchos.map((w, i) => (i === anchos.length - 1 ? w + sobrante : w));
})();
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

type Formato = { negrita?: boolean; tamano?: number; color?: string };

const run = (texto: string, f: Formato = {}) => {
  const props = [
    f.negrita ? '<w:b/>' : '',
    f.color ? `<w:color w:val="${f.color}"/>` : '',
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

const tablaPlan = (plan: PlanWord) => {
  const grid = COLUMNAS_TWIPS.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const encabezado = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${COLUMNAS_PLAN.map((t, i) => celda(COLUMNAS_TWIPS[i]!, parrafo(run(t, { negrita: true, color: 'FFFFFF' })), { fondo: AZUL })).join('')}</w:tr>`;
  const filas = plan.recomendacionesDetalle.length
    ? plan.recomendacionesDetalle.map((r) => `<w:tr>${celdasRecomendacion(r).map((t, i) => celda(COLUMNAS_TWIPS[i]!, parrafosDe(t))).join('')}</w:tr>`).join('')
    : `<w:tr>${celda(ANCHO_UTIL, parrafo(run('El plan aún no contiene recomendaciones.')), { columnas: COLUMNAS_TWIPS.length })}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${BORDES}</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${encabezado}${filas}</w:tbl>`;
};

const documento = (plan: PlanWord) =>
  `${XML}<w:document ${NS}><w:body>` +
  parrafo(run('Plan de Mejora Continua', { negrita: true, tamano: 16, color: AZUL }), { espacioDespues: 60 }) +
  parrafo(run(`Estado: ${plan.estado.replaceAll('_', ' ')} · Última actualización: ${plan.actualizado} · Generado: ${fechaGeneracion()}`, { tamano: 8, color: GRIS }), { espacioDespues: 160 }) +
  tablaPlan(plan) +
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
const encabezado = (plan: PlanWord) => {
  const anchoLogo = 3200;
  const datos = lineasMembrete(plan)
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
const relaciones = (items: [string, string, string][]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, tipo, destino]) => `<Relationship Id="${id}" Type="${tipo}" Target="${destino}"/>`).join('')}</Relationships>`;

const propiedades = (plan: PlanWord) =>
  `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:title>${escapar(`Plan de Mejora Continua · ${plan.licenciatura} · ${plan.ciclo}`)}</dc:title><dc:creator>Sistema de Seguimiento a la Mejora Continua</dc:creator></cp:coreProperties>`;

export const generarDocxPlan = (plan: PlanWord): Buffer =>
  crearZip([
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
    { nombre: 'docProps/core.xml', datos: Buffer.from(propiedades(plan), 'utf8') },
    { nombre: 'word/document.xml', datos: Buffer.from(documento(plan), 'utf8') },
    { nombre: 'word/styles.xml', datos: Buffer.from(estilos(), 'utf8') },
    { nombre: 'word/header1.xml', datos: Buffer.from(encabezado(plan), 'utf8') },
    { nombre: 'word/footer1.xml', datos: Buffer.from(pie(), 'utf8') },
    {
      nombre: 'word/_rels/document.xml.rels',
      datos: Buffer.from(
        relaciones([
          ['rIdEstilos', `${REL}/styles`, 'styles.xml'],
          ['rIdEncabezado', `${REL}/header`, 'header1.xml'],
          ['rIdPie', `${REL}/footer`, 'footer1.xml'],
        ]),
        'utf8',
      ),
    },
    { nombre: 'word/_rels/header1.xml.rels', datos: Buffer.from(relaciones([['rIdLogo', `${REL}/image`, 'media/logo-fes-acatlan.jpeg']]), 'utf8') },
    { nombre: 'word/media/logo-fes-acatlan.jpeg', datos: LOGO_FES.jpeg },
  ]);
