import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';
import {
  esEditable,
  exigirPlanEditable,
  limpiarLista,
  siguienteOrden,
  textoObligatorio,
  validarCatalogo,
  validarCategoriaDelIndicador,
  validarFechaCumplimiento,
  validarId,
  validarMetaMedible,
} from './reglas';

describe('HU-04 · validarFechaCumplimiento', () => {
  const inicio = '2024-11-28';
  const fin = '2029-11-28';

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

describe('HU-04 · limpiarLista y textoObligatorio', () => {
  it('quita vacíos y exige al menos un elemento', () => {
    expect(limpiarLista([' Curso ', ''], 'acción')).toEqual(['Curso']);
    expect(() => limpiarLista(['  '], 'meta')).toThrow(BadRequestException);
  });

  it('recorta el texto y rechaza uno vacío', () => {
    expect(textoObligatorio('  Indicador 1 ', 'el indicador')).toBe('Indicador 1');
    expect(() => textoObligatorio('   ', 'el indicador')).toThrow(BadRequestException);
    expect(() => textoObligatorio(undefined, 'el indicador')).toThrow(BadRequestException);
  });
});

describe('HU-04 · catálogos cerrados', () => {
  const categorias = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

  it('rechaza una categoría que no esté en el catálogo de 10', () => {
    expect(() => validarCatalogo(['11'], categorias, 'la categoría')).toThrow(BadRequestException);
    expect(() => validarCatalogo([''], categorias, 'la categoría')).toThrow(BadRequestException);
    expect(validarCatalogo(['3'], categorias, 'la categoría')).toEqual(['3']);
  });

  it('quita áreas repetidas y rechaza si alguna no existe', () => {
    const areas = new Set(['1', '2']);
    expect(validarCatalogo(['2', '1', '2'], areas, 'el área')).toEqual(['2', '1']);
    expect(() => validarCatalogo(['1', '99'], areas, 'el área')).toThrow(BadRequestException);
  });

  it('un indicador existente solo acepta recomendaciones de su categoría', () => {
    expect(() => validarCategoriaDelIndicador('1', '1')).not.toThrow();
    expect(() => validarCategoriaDelIndicador('1', '2')).toThrow(BadRequestException);
  });
});

describe('HU-04 · estado del plan', () => {
  it('solo BORRADOR y DEVUELTO se pueden editar', () => {
    expect(esEditable(EstadoVersion.BORRADOR)).toBe(true);
    expect(esEditable(EstadoVersion.DEVUELTO)).toBe(true);
    expect(() => exigirPlanEditable(EstadoVersion.EN_REVISION)).toThrow(ConflictException);
    expect(() => exigirPlanEditable(EstadoVersion.APROBADO)).toThrow(ConflictException);
  });
});

describe('HU-04 · orden e identificadores', () => {
  it('permite varias recomendaciones en un mismo indicador (orden consecutivo)', () => {
    expect(siguienteOrden([])).toBe(1);
    expect(siguienteOrden([1, 2])).toBe(3);
    expect(siguienteOrden([1, 5, 3])).toBe(6);
  });

  it('solo acepta ids numéricos', () => {
    expect(validarId('42', 'ciclo')).toBe('42');
    expect(() => validarId('1 OR 1=1', 'ciclo')).toThrow(BadRequestException);
    expect(() => validarId('', 'ciclo')).toThrow(BadRequestException);
  });
});

describe('HU-04 · metas medibles (en porcentaje)', () => {
  it('acepta metas con un porcentaje entre 0 y 100', () => {
    expect(() => validarMetaMedible('Reducir la deserción al 0%')).not.toThrow();
    expect(validarMetaMedible('Capacitar al 80% de la planta docente')).toBe('Capacitar al 80% de la planta docente');
    expect(() => validarMetaMedible('Renovar el 100 % de los equipos')).not.toThrow();
    expect(() => validarMetaMedible('Pasar de 40% a 75,5% de titulación')).not.toThrow();
  });

  it('rechaza metas sin porcentaje o fuera de rango', () => {
    expect(() => validarMetaMedible('Mejorar la titulación')).toThrow(BadRequestException);
    expect(() => validarMetaMedible('Capacitar a 30 profesores')).toThrow(BadRequestException);
    expect(() => validarMetaMedible('Superar el 120% de la matrícula')).toThrow(BadRequestException);
  });
});
