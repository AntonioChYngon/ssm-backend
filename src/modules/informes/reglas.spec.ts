import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';
import {
  ArchivoNoPermitido,
  bloqueoInforme,
  esperadoAlCorte,
  faltantesAvance,
  mensajeObservacionesInforme,
  periodoDelInforme,
  rutaCarpetaEvidencias,
  SEMESTRES,
  semestreDe,
  validarArchivoEvidencia,
  validarEnvioInforme,
  validarPorcentaje,
  validarUrlEvidencia,
  verificarTransicionInforme,
} from './reglas';

const PDF = Buffer.from('%PDF-1.7\n');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

describe('Informe · semestres (calendario UNAM)', () => {
  it('nombra el semestre AAAA-1 de agosto del año anterior a enero', () => {
    expect(semestreDe('2026-08-01')).toEqual({ nombre: '2027-1', inicio: '2026-08-01', fin: '2027-01-31' });
    expect(semestreDe('2026-11-25').nombre).toBe('2027-1');
    expect(semestreDe('2027-01-31').nombre).toBe('2027-1');
  });

  it('nombra el semestre AAAA-2 de febrero a julio', () => {
    expect(semestreDe('2027-02-01')).toEqual({ nombre: '2027-2', inicio: '2027-02-01', fin: '2027-07-31' });
    expect(semestreDe('2026-07-31').nombre).toBe('2026-2');
  });

  it('SEMESTRES cubre cada día del año sin huecos ni traslapes', () => {
    const dia = new Date('2025-01-01T00:00:00Z');
    while (dia.getUTCFullYear() < 2029) {
      const fecha = dia.toISOString().slice(0, 10);
      const anio = Number(fecha.slice(0, 4));
      const coincidencias = [anio - 1, anio, anio + 1].flatMap((a) =>
        SEMESTRES.map((s) => ({ a, s })).filter(({ a: n, s }) => {
          const f = (x: { anio: number; mes: number; dia: number }) => `${n + x.anio}-${String(x.mes).padStart(2, '0')}-${String(x.dia).padStart(2, '0')}`;
          return f(s.inicio) <= fecha && fecha <= f(s.fin);
        }),
      );
      expect(coincidencias).toHaveLength(1);
      dia.setUTCDate(dia.getUTCDate() + 1);
    }
  });

  it('recorta el primer y el último semestre a la vigencia del ciclo', () => {
    expect(periodoDelInforme('2024-12-10', '2024-11-28', '2029-11-28')).toEqual({ nombre: '2025-1', inicio: '2024-11-28', fin: '2025-01-31', fechaCorte: '2025-01-31' });
    expect(periodoDelInforme('2029-10-01', '2024-11-28', '2029-11-28')).toEqual({ nombre: '2030-1', inicio: '2029-08-01', fin: '2029-11-28', fechaCorte: '2029-11-28' });
  });

  it('un semestre intermedio conserva sus fechas y corta el último día', () => {
    expect(periodoDelInforme('2026-11-25', '2024-11-28', '2029-11-28')).toEqual({ nombre: '2027-1', inicio: '2026-08-01', fin: '2027-01-31', fechaCorte: '2027-01-31' });
  });

  it('fuera de la vigencia no hay periodo', () => {
    expect(periodoDelInforme('2024-11-27', '2024-11-28', '2029-11-28')).toBeNull();
    expect(periodoDelInforme('2029-11-29', '2024-11-28', '2029-11-28')).toBeNull();
  });
});

describe('Informe · % de avance', () => {
  it('acepta enteros de 0 a 100', () => {
    [0, 1, 50, 99, 100].forEach((n) => expect(validarPorcentaje(n)).toBe(n));
  });

  it('rechaza decimales, negativos, mayores a 100 y textos', () => {
    [-1, 101, 50.5, Number.NaN, '50', null, undefined].forEach((v) => expect(() => validarPorcentaje(v)).toThrow(BadRequestException));
  });

  it('% esperado al corte: el mayor de las metas que vencen hasta el corte', () => {
    const metas = [
      { fechaCompromiso: '2026-06-30', porcentajeEsperado: 30 },
      { fechaCompromiso: '2027-01-31', porcentajeEsperado: 60 },
      { fechaCompromiso: '2027-06-30', porcentajeEsperado: 90 },
      { fechaCompromiso: null, porcentajeEsperado: null },
    ];
    expect(esperadoAlCorte(metas, '2027-01-31')).toBe(60);
    expect(esperadoAlCorte(metas, '2026-01-31')).toBeNull();
    expect(esperadoAlCorte([], '2027-01-31')).toBeNull();
  });
});

describe('Informe · envío', () => {
  it('la evidencia solo es obligatoria al 100 %', () => {
    expect(faltantesAvance({ numero: 1, porcentaje: 60, evidencias: 0 })).toEqual([]);
    expect(faltantesAvance({ numero: 1, porcentaje: 100, evidencias: 1 })).toEqual([]);
    expect(faltantesAvance({ numero: 1, porcentaje: 100, evidencias: 0 })).toEqual(['al menos una evidencia (está al 100 %)']);
    expect(faltantesAvance({ numero: 1, porcentaje: null, evidencias: 0 })).toEqual(['el % de avance']);
  });

  it('lista cada recomendación incompleta con su número', () => {
    expect(() =>
      validarEnvioInforme([
        { numero: 1, porcentaje: 40, evidencias: 0 },
        { numero: 2, porcentaje: null, evidencias: 0 },
        { numero: 3, porcentaje: 100, evidencias: 0 },
      ]),
    ).toThrow('Recomendación 2: falta el % de avance; Recomendación 3: falta al menos una evidencia (está al 100 %)');
  });

  it('permite enviar cuando todo está completo y rechaza un plan sin recomendaciones', () => {
    expect(() => validarEnvioInforme([{ numero: 1, porcentaje: 0, evidencias: 0 }, { numero: 2, porcentaje: 100, evidencias: 2 }])).not.toThrow();
    expect(() => validarEnvioInforme([])).toThrow(BadRequestException);
  });
});

describe('Informe · estados', () => {
  it('reabrir solo desde Aprobado; validar y devolver solo desde En revisión', () => {
    expect(() => verificarTransicionInforme(EstadoVersion.APROBADO, 'reabrir')).not.toThrow();
    expect(() => verificarTransicionInforme(EstadoVersion.EN_REVISION, 'reabrir')).toThrow(ConflictException);
    expect(() => verificarTransicionInforme(EstadoVersion.EN_REVISION, 'validar')).not.toThrow();
    expect(() => verificarTransicionInforme(EstadoVersion.BORRADOR, 'devolver')).toThrow(ConflictException);
    expect(() => verificarTransicionInforme(EstadoVersion.DEVUELTO, 'editar')).not.toThrow();
    expect(() => verificarTransicionInforme(EstadoVersion.APROBADO, 'editar')).toThrow(ConflictException);
  });

  it('el estado manda sobre el ciclo al calcular el bloqueo', () => {
    expect(bloqueoInforme(EstadoVersion.BORRADOR, true)).toBeNull();
    expect(bloqueoInforme(EstadoVersion.DEVUELTO, false)).toBe('CICLO_CERRADO');
    expect(bloqueoInforme(EstadoVersion.EN_REVISION, false)).toBe('EN_REVISION');
    expect(bloqueoInforme(EstadoVersion.APROBADO, false)).toBe('APROBADO');
  });
});

describe('Informe · evidencias', () => {
  it('acepta los cuatro tipos con su firma y devuelve la extensión', () => {
    expect(validarArchivoEvidencia({ nombre: 'Acta.PDF', tamano: 10, inicio: PDF })).toBe('.pdf');
    expect(validarArchivoEvidencia({ nombre: 'lista.xlsx', tamano: 10, inicio: ZIP })).toBe('.xlsx');
  });

  it('rechaza extensiones no permitidas, archivos disfrazados, vacíos y pesados', () => {
    const motivo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof ArchivoNoPermitido ? e.motivo : 'OTRO';
      }
      return 'NINGUNO';
    };
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'virus.exe', tamano: 10, inicio: ZIP }))).toBe('TIPO');
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'viejo.doc', tamano: 10, inicio: ZIP }))).toBe('TIPO');
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'falso.pdf', tamano: 10, inicio: ZIP }))).toBe('TIPO');
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'vacio.pdf', tamano: 0, inicio: PDF }))).toBe('TIPO');
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'grande.pdf', tamano: 15 * 1024 * 1024 + 1, inicio: PDF }))).toBe('PESO');
    expect(motivo(() => validarArchivoEvidencia({ nombre: 'justo.pdf', tamano: 15 * 1024 * 1024, inicio: PDF }))).toBe('NINGUNO');
  });

  it('solo acepta enlaces http(s)', () => {
    expect(validarUrlEvidencia('  https://drive.google.com/file/d/abc/view ')).toBe('https://drive.google.com/file/d/abc/view');
    ['ftp://servidor/archivo.pdf', 'javascript:alert(1)', 'drive.google.com/x', ''].forEach((u) => expect(() => validarUrlEvidencia(u)).toThrow(BadRequestException));
  });

  it('arma la carpeta de cada recomendación dentro de la del ciclo', () => {
    expect(rutaCarpetaEvidencias('Derecho', '2024-2029', '2027-1', 3)).toEqual(['Evidencias', 'Derecho', '2024-2029', 'Informe-2027-1', 'Rec-03']);
  });
});

describe('Informe · avisos', () => {
  it('lista las observaciones en el orden del informe con su número', () => {
    const texto = mensajeObservacionesInforme(
      'La Administración devolvió tu informe 2027-1. Motivo: faltan soportes.',
      [
        { recomendacionId: '9', comentario: 'Agrega la lista de asistencia.' },
        { recomendacionId: '7', comentario: ' Falta el acta firmada. ' },
        { recomendacionId: '99', comentario: 'No es de este informe.' },
      ],
      [{ recomendacionId: '7', numero: 1 }, { recomendacionId: '9', numero: 2 }],
    );
    expect(texto).toBe(
      'La Administración devolvió tu informe 2027-1. Motivo: faltan soportes.\n\nObservaciones:\n• Recomendación 1: Falta el acta firmada.\n• Recomendación 2: Agrega la lista de asistencia.',
    );
  });
});
