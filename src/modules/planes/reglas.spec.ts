import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';
import {
  claveTexto,
  esEditable,
  faltantes,
  inicioHitos,
  limpiarLista,
  limpiarListaOpcional,
  validarEnvio,
  validarFechaCumplimiento,
  validarMetas,
  verificarTransicion,
} from './reglas';

const inicio = '2024-11-28';
const fin = '2029-11-28';

describe('HU-04 · validarFechaCumplimiento', () => {
  it('acepta fechas dentro de la vigencia, incluidos los extremos', () => {
    expect(() => validarFechaCumplimiento('2026-06-30', inicio, fin)).not.toThrow();
    expect(() => validarFechaCumplimiento(inicio, inicio, fin)).not.toThrow();
    expect(() => validarFechaCumplimiento(fin, inicio, fin)).not.toThrow();
  });

  it('rechaza fechas fuera de la vigencia o mal escritas', () => {
    expect(() => validarFechaCumplimiento('2030-01-01', inicio, fin)).toThrow(BadRequestException);
    expect(() => validarFechaCumplimiento('2024-11-27', inicio, fin)).toThrow(BadRequestException);
    expect(() => validarFechaCumplimiento('30/06/2026', inicio, fin)).toThrow(BadRequestException);
  });
});

describe('HU-04 · listas e indicador', () => {
  it('quita vacíos y exige al menos un elemento', () => {
    expect(limpiarLista([' Curso ', ''], 'acción')).toEqual(['Curso']);
    expect(() => limpiarLista(['  '], 'meta')).toThrow(BadRequestException);
  });

  it('en borrador permite listas vacías', () => {
    expect(limpiarListaOpcional(undefined)).toEqual([]);
    expect(limpiarListaOpcional(['  ', ' Meta 1 '])).toEqual(['Meta 1']);
  });

  it('reutiliza el indicador aunque cambien mayúsculas o espacios', () => {
    expect(claveTexto('  Perfil   del Profesorado ')).toBe(claveTexto('perfil del profesorado'));
  });
});

describe('HU-04 / HU-05 · flujo de estados', () => {
  it('solo se edita y envía en Borrador o Devuelto', () => {
    expect(esEditable(EstadoVersion.BORRADOR)).toBe(true);
    expect(esEditable(EstadoVersion.DEVUELTO)).toBe(true);
    expect(esEditable(EstadoVersion.EN_REVISION)).toBe(false);
    expect(() => verificarTransicion(EstadoVersion.APROBADO, 'enviar')).toThrow(ConflictException);
  });

  it('solo se valida o devuelve un plan en validación', () => {
    expect(() => verificarTransicion(EstadoVersion.EN_REVISION, 'validar')).not.toThrow();
    expect(() => verificarTransicion(EstadoVersion.BORRADOR, 'validar')).toThrow(ConflictException);
    expect(() => verificarTransicion(EstadoVersion.DEVUELTO, 'devolver')).toThrow(ConflictException);
  });
});

describe('HU-04 · validarEnvio', () => {
  const completa = { numero: 1, acciones: 1, metas: 2, metasConfiguradas: 2, areaResponsable: 'Coordinación', fechaCumplimiento: '2027-06-30' };

  it('acepta un plan con recomendaciones completas', () => {
    expect(() => validarEnvio([completa], inicio, fin)).not.toThrow();
  });

  it('rechaza un plan vacío', () => {
    expect(() => validarEnvio([], inicio, fin)).toThrow(BadRequestException);
  });

  it('indica qué le falta a cada recomendación', () => {
    expect(faltantes({ ...completa, metas: 0, areaResponsable: ' ', fechaCumplimiento: null }, inicio, fin)).toEqual([
      'metas',
      'área responsable',
      'fecha de cumplimiento',
    ]);
    expect(() => validarEnvio([completa, { ...completa, numero: 2, fechaCumplimiento: '2031-01-01' }], inicio, fin)).toThrow(
      /recomendación 2: falta fecha de cumplimiento dentro del ciclo/,
    );
  });

  it('HU-12: exige al menos una meta con fecha y % esperado', () => {
    expect(faltantes({ ...completa, metasConfiguradas: 0 }, inicio, fin)).toEqual(['al menos una meta con fecha y % esperado']);
    expect(() => validarEnvio([{ ...completa, metasConfiguradas: 0 }], inicio, fin)).toThrow(BadRequestException);
  });
});

describe('HU-12 · validarMetas', () => {
  const meta = (fechaCompromiso: string, porcentajeEsperado: number) => ({ descripcion: 'Meta', fechaCompromiso, porcentajeEsperado });

  it('acepta metas en orden con % entre 1 y 99', () => {
    expect(() => validarMetas([meta('2025-06-30', 25), meta('2026-06-30', 60)], inicio, '2027-06-30')).not.toThrow();
  });

  it('rechaza %, fechas desordenadas o fuera de la fecha de cumplimiento', () => {
    expect(() => validarMetas([meta('2025-06-30', 100)], inicio, fin)).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2026-06-30', 20), meta('2025-06-30', 40)], inicio, fin)).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2028-01-01', 20)], inicio, '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([], inicio, fin)).toThrow(BadRequestException);
  });

  it('la fecha debe ser posterior a la creación del plan y anterior a la fecha de cumplimiento', () => {
    expect(() => validarMetas([meta('2026-11-17', 30)], '2026-11-17', '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2027-06-30', 30)], '2026-11-17', '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2026-11-18', 30)], '2026-11-17', '2027-06-30')).not.toThrow();
  });
});

describe('HU-12 · inicioHitos', () => {
  it('usa la creación del plan, o el inicio de la vigencia si es posterior', () => {
    expect(inicioHitos(new Date('2026-11-17T20:00:00Z'), inicio)).toBe('2026-11-17');
    expect(inicioHitos(new Date('2024-01-10T12:00:00Z'), inicio)).toBe(inicio);
  });
});
