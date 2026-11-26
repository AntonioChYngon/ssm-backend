import { inflateRawSync } from 'node:zlib';
import { EstadoVersion } from '../../common/enums';
import { generarDocxReporte } from '../planes/membrete/reporte-docx';
import { generarPdfReporte } from '../planes/membrete/reporte-pdf';
import type { EvidenciaInforme, InformeDetalle } from './contrato';
import { AVISO_PRELIMINAR, NOTA_EVIDENCIAS_LOCALES, nombreArchivoInforme, reporteInforme, urlEvidencia } from './reporte';

const evidencia = (cambios: Partial<EvidenciaInforme>): EvidenciaInforme => ({
  id: '7',
  origen: 'ARCHIVO',
  nombre: 'Acta del comité.pdf',
  tamano: 1000,
  enlace: '/evidencias/7/archivo',
  externo: false,
  cargadaPor: 'Coordinación',
  cargadaEn: '2026-11-20T10:00:00.000Z',
  ...cambios,
});

const informe = (cambios: Partial<InformeDetalle> = {}) =>
  ({
    id: '3',
    informeId: '3',
    cicloId: '1',
    licenciaturaId: '1',
    licenciatura: 'Actuaría',
    ciclo: '2024-2029',
    periodo: '2026-2',
    fechaInicio: '2026-02-01',
    fechaFin: '2026-07-31',
    fechaCorte: '2026-07-31',
    estado: EstadoVersion.APROBADO,
    enviadoEn: '2026-07-20T10:00:00.000Z',
    aprobadoEn: '2026-07-25T10:00:00.000Z',
    recomendaciones: 1,
    conAvance: 1,
    evidencias: 2,
    organismo: 'CIEES',
    vigenciaInicio: '2024-11-28',
    vigenciaFin: '2029-11-28',
    editable: false,
    bloqueo: null,
    ultimaRevision: null,
    revisiones: [],
    avances: [
      {
        recomendacionId: '10',
        numero: 1,
        categoria: 'Personal Académico',
        indicador: 'Formación docente',
        recomendacion: 'Fortalecer la actualización docente',
        fechaCumplimiento: '2028-06-30',
        metas: [{ descripcion: 'Capacitar al 80%', fechaCompromiso: '2026-06-30', porcentajeEsperado: 50 }],
        esperadoAlCorte: 50,
        porcentaje: 60,
        observaciones: 'Se impartieron 3 cursos',
        evidenciaObligatoria: false,
        observacionRevision: null,
        evidencias: [
          evidencia({}),
          evidencia({ id: '8', origen: 'URL', nombre: 'https://drive.google.com/file/d/abc', enlace: 'https://drive.google.com/file/d/abc', externo: true, tamano: null }),
        ],
      },
    ],
    ...cambios,
  }) as InformeDetalle;

const leerZip = (zip: Buffer) => {
  const archivos = new Map<string, string>();
  let i = 0;
  while (zip.readUInt32LE(i) === 0x04034b50) {
    const comprimido = zip.readUInt32LE(i + 18);
    const largo = zip.readUInt16LE(i + 26);
    const nombre = zip.subarray(i + 30, i + 30 + largo).toString('utf8');
    const inicio = i + 30 + largo;
    archivos.set(nombre, inflateRawSync(zip.subarray(inicio, inicio + comprimido)).toString('utf8'));
    i = inicio + comprimido;
  }
  return archivos;
};

describe('HU-09 · reporte del Informe de Seguimiento', () => {
  it('los enlaces externos se exportan tal cual y los archivos locales apuntan a la página del sistema', () => {
    expect(urlEvidencia(evidencia({ externo: true, enlace: 'https://drive.google.com/x' }), 'https://ssm.mx/')).toBe('https://drive.google.com/x');
    expect(urlEvidencia(evidencia({}), 'https://ssm.mx/')).toBe('https://ssm.mx/evidencias/7');
  });

  it('marca como preliminar un informe no validado y avisa si hay evidencias que piden sesión', () => {
    expect(reporteInforme(informe(), 'http://localhost:3000').aviso).toBe(NOTA_EVIDENCIAS_LOCALES);
    expect(reporteInforme(informe({ estado: EstadoVersion.EN_REVISION, aprobadoEn: null }), 'http://localhost:3000').aviso).toContain(AVISO_PRELIMINAR);
  });

  it('arma una fila por recomendación con % esperado, % de avance y evidencias como enlaces', () => {
    const [fila] = reporteInforme(informe(), 'http://localhost:3000').filas;
    expect(fila!.slice(0, 7)).toEqual([
      '1',
      'Personal Académico\nFormación docente',
      'Fortalecer la actualización docente',
      '1. Capacitar al 80% · 30/06/2026 · 50%',
      '50%',
      '60%',
      'Se impartieron 3 cursos',
    ]);
    expect(fila![7]).toEqual({
      enlaces: [
        { texto: 'Acta del comité.pdf', url: 'http://localhost:3000/evidencias/7' },
        { texto: 'https://drive.google.com/file/d/abc', url: 'https://drive.google.com/file/d/abc' },
      ],
    });
  });

  it('el PDF lleva anotaciones /Link clickeables (una por renglón de cada enlace)', () => {
    const pdf = generarPdfReporte(reporteInforme(informe(), 'http://localhost:3000')).toString('latin1');
    expect(pdf).toContain('/Subtype /Link');
    expect(pdf).toContain('/URI (http://localhost:3000/evidencias/7)');
    expect(pdf).toContain('/URI (https://drive.google.com/file/d/abc)');
    expect(pdf).toMatch(/\/Annots \[(\d+ 0 R ?){2,}\]/);
  });

  it('el Word lleva hipervínculos con relación externa', () => {
    const archivos = leerZip(generarDocxReporte(reporteInforme(informe(), 'http://localhost:3000')));
    const documento = archivos.get('word/document.xml')!;
    const relaciones = archivos.get('word/_rels/document.xml.rels')!;
    expect(documento).toContain('Informe de Seguimiento');
    expect(documento).toContain('<w:hyperlink r:id="rIdEnlace1"');
    expect(relaciones).toContain('Target="http://localhost:3000/evidencias/7" TargetMode="External"');
    expect(relaciones).toContain('Target="https://drive.google.com/file/d/abc" TargetMode="External"');
  });

  it('nombra el archivo con la licenciatura y el semestre, sin acentos', () => {
    expect(nombreArchivoInforme({ licenciatura: 'Actuaría', periodo: '2026-2' })).toBe('informe-de-seguimiento-actuaria-2026-2');
  });
});
