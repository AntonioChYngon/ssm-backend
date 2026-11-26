import { BadRequestException } from '@nestjs/common';
import { leerLicenciaturaIds } from './licenciaturas';

describe('HU-13 · licenciaturaIds', () => {
  it('sin valor significa todas', () => {
    expect(leerLicenciaturaIds(undefined)).toBeUndefined();
    expect(leerLicenciaturaIds('  ')).toBeUndefined();
  });

  it('lee una o varias, sin repetidos', () => {
    expect(leerLicenciaturaIds('3')).toEqual(['3']);
    expect(leerLicenciaturaIds('3,4,3')).toEqual(['3', '4']);
  });

  it('rechaza formatos inválidos', () => {
    ['a', '1,,2', '1;2', '1, 2', '-1'].forEach((v) => expect(() => leerLicenciaturaIds(v)).toThrow(BadRequestException));
  });
});
