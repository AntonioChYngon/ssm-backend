import { BadRequestException } from '@nestjs/common';
import { limpiarLista, validarFechaCumplimiento } from './reglas';

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

describe('HU-04 · limpiarLista', () => {
  it('quita vacíos y exige al menos un elemento', () => {
    expect(limpiarLista([' Curso ', ''], 'acción')).toEqual(['Curso']);
    expect(() => limpiarLista(['  '], 'meta')).toThrow(BadRequestException);
  });

  it.todo('rechaza una categoría que no esté en el catálogo de 10');
  it.todo('permite varias recomendaciones en un mismo indicador');
});
