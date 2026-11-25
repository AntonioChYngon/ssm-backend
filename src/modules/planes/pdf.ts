type MetaPdf = {
  descripcion: string;
  fechaCompromiso: string | null;
  porcentajeEsperado: number | null;
};

type RecomendacionPdf = {
  numero: number;
  categoria: string;
  indicador: string;
  descripcion: string;
  acciones: string[];
  metas: MetaPdf[];
  areaResponsable: string | null;
  fechaCumplimiento: string | null;
};

type PlanPdf = {
  licenciatura: string;
  organismo: string;
  ciclo: string;
  estado: string;
  actualizado: string;
  recomendacionesDetalle: RecomendacionPdf[];
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

const fecha = (iso: string | null) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';

/** Crea un PDF sencillo y paginado sin depender de binarios del sistema o servicios externos. */
export const generarPdfPlan = (plan: PlanPdf): Buffer => {
  const paginas: string[][] = [];
  let comandos: string[] = [];
  let y = 0;

  const abrirPagina = () => {
    comandos = [];
    paginas.push(comandos);
    // HU-04: el reporte en tabla se titula "Plan de Mejora Continua" (Anexo 1).
    comandos.push(texto(MARGEN, 558, 'Plan de Mejora Continua', 15, '0.02 0.20 0.38'));
    comandos.push(texto(MARGEN, 540, `${plan.licenciatura} · Ciclo ${plan.ciclo} · ${plan.organismo}`, 9));
    comandos.push(texto(MARGEN, 525, `Estado: ${plan.estado.replaceAll('_', ' ')} · Última actualización: ${plan.actualizado}`, 8));
    comandos.push(texto(MARGEN, 511, `Generado: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' }).format(new Date())}`, 7, '0.36 0.40 0.44'));
    const top = 496;
    comandos.push(caja(MARGEN, top - ALTO_CABECERA, ANCHOS.reduce((a, b) => a + b, 0), ALTO_CABECERA, '0.02 0.20 0.38'));
    const encabezados = ['N.º', 'Categoría', 'Indicador', 'Recomendación', 'Acciones', 'Metas', 'Área responsable', 'Fecha límite'];
    let x = MARGEN;
    encabezados.forEach((encabezado, i) => {
      const lineas = envolver(encabezado, ANCHOS[i] - 8, 6.5);
      lineas.slice(0, 2).forEach((t, n) => comandos.push(texto(x + 4, top - 11 - n * 8, t, 6.5, '1 1 1')));
      if (i > 0) comandos.push(linea(x, top, x, top - ALTO_CABECERA));
      x += ANCHOS[i];
    });
    comandos.push(linea(MARGEN, top, MARGEN + ANCHOS.reduce((a, b) => a + b, 0), top));
    y = top - ALTO_CABECERA;
  };

  const filas = plan.recomendacionesDetalle.map((r) => [
    String(r.numero),
    r.categoria,
    r.indicador,
    r.descripcion,
    r.acciones.length ? r.acciones.map((a, i) => `${i + 1}. ${a}`).join('\n') : '—',
    r.metas.length ? r.metas.map((m, i) => `${i + 1}. ${m.descripcion}${m.fechaCompromiso ? ` · ${fecha(m.fechaCompromiso)}` : ''}${m.porcentajeEsperado === null ? '' : ` · ${m.porcentajeEsperado}%`}`).join('\n') : '—',
    r.areaResponsable ?? '—',
    fecha(r.fechaCumplimiento),
  ]);

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

  paginas.forEach((contenido, i) => contenido.push(texto(MARGEN, 20, `Sistema de Seguimiento de Mejora · Página ${i + 1} de ${paginas.length}`, 7, '0.42 0.46 0.50')));

  const objetos: string[] = [];
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const idsPagina = paginas.map((_, i) => 4 + i * 2);
  objetos[2] = `<< /Type /Pages /Kids [${idsPagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  paginas.forEach((contenido, i) => {
    const idPagina = idsPagina[i];
    const idContenido = idPagina + 1;
    const stream = contenido.join('\n');
    objetos[idPagina] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${idContenido} 0 R >>`;
    objetos[idContenido] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
  });

  let documento = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objetos.length; id++) {
    offsets[id] = Buffer.byteLength(documento, 'ascii');
    documento += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
  }
  const inicioXref = Buffer.byteLength(documento, 'ascii');
  documento += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) documento += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  documento += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  return Buffer.from(documento, 'ascii');
};
