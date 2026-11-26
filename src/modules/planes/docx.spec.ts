import { inflateRawSync } from 'node:zlib';
import { generarDocxPlan } from './docx';
import { fechaLarga, lineasMembrete } from './membrete/membrete';
import { crc32 } from './membrete/zip';

/** Lee las entradas de un ZIP generado por crearZip (sin data descriptors). */
const leerZip = (zip: Buffer) => {
  const archivos = new Map<string, Buffer>();
  let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const comprimido = zip.readUInt32LE(i + 18);
    const largoNombre = zip.readUInt16LE(i + 26);
    const nombre = zip.subarray(i + 30, i + 30 + largoNombre).toString('utf8');
    const inicio = i + 30 + largoNombre;
    const datos = inflateRawSync(zip.subarray(inicio, inicio + comprimido));
    expect(crc32(datos)).toBe(zip.readUInt32LE(i + 14));
    archivos.set(nombre, datos);
    i = inicio + comprimido;
  }
  return archivos;
};

const plan = {
  licenciatura: 'Actuaría',
  organismo: 'Comités Interinstitucionales para la Evaluación de la Educación Superior A.C. (CIEES)',
  ciclo: '2024-2029',
  vigenciaInicio: '2024-11-28',
  vigenciaFin: '2029-11-28',
  estado: 'EN_REVISION',
  actualizado: '25/11/2026',
  recomendacionesDetalle: [
    {
      numero: 1,
      categoria: 'Personal Académico',
      indicador: 'Formación docente',
      descripcion: 'Fortalecer la actualización <docente> & "disciplinar".',
      acciones: ['Organizar cursos', 'Evaluar resultados'],
      metas: [{ descripcion: 'Capacitar al 80% de la planta', fechaCompromiso: '2027-06-30', porcentajeEsperado: 50 }],
      areaResponsable: 'Unidad de Planeación',
      fechaCumplimiento: '2028-06-30',
    },
  ],
};

describe('HU-06 · membrete institucional', () => {
  it('escribe la vigencia como en la historia: "28 de noviembre de 2024 al 28 de noviembre de 2029"', () => {
    expect(fechaLarga('2024-11-28')).toBe('28 de noviembre de 2024');
    expect(fechaLarga('2029-01-05')).toBe('5 de enero de 2029');
    expect(fechaLarga(null)).toBe('—');
    expect(lineasMembrete(plan)[2]!.valor).toBe('28 de noviembre de 2024 al 28 de noviembre de 2029 (ciclo 2024-2029)');
  });
});

describe('HU-06 · Plan de Mejora Continua en Word', () => {
  const archivos = leerZip(generarDocxPlan(plan));

  it('arma un .docx con todas sus partes y el logotipo de la FES', () => {
    expect([...archivos.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
      'word/styles.xml',
      'word/header1.xml',
      'word/footer1.xml',
      'word/_rels/document.xml.rels',
      'word/_rels/header1.xml.rels',
      'word/media/logo-fes-acatlan.jpeg',
    ]);
    const logo = archivos.get('word/media/logo-fes-acatlan.jpeg')!;
    expect(logo.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('pone licenciatura, organismo y vigencia en el encabezado de cada página', () => {
    const encabezado = archivos.get('word/header1.xml')!.toString('utf8');
    expect(encabezado).toContain('r:embed="rIdLogo"');
    expect(encabezado).toContain('Actuaría');
    expect(encabezado).toContain('(CIEES)');
    expect(encabezado).toContain('28 de noviembre de 2024 al 28 de noviembre de 2029');
  });

  it('incluye el título, la tabla del Anexo 1 con encabezado repetido y escapa el texto', () => {
    const documento = archivos.get('word/document.xml')!.toString('utf8');
    expect(documento).toContain('Plan de Mejora Continua');
    expect(documento).toContain('<w:tblHeader/>');
    expect(documento).toContain('Fecha de cumplimiento');
    expect(documento).toContain('Fortalecer la actualización &lt;docente&gt; &amp; &quot;disciplinar&quot;.');
    expect(documento).toContain('1. Capacitar al 80% de la planta · 30/06/2027 · 50%');
    expect(documento).toContain('w:orient="landscape"');
  });
});
