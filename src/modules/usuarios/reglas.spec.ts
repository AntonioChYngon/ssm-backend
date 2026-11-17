import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Rol } from '../../common/enums';
import { validarAsignacion, validarDisponibilidadRol } from './reglas';

// Ejemplo de prueba unitaria: no necesita base de datos. Ejecuta `npm test`.
describe('HU-02 · validarAsignacion', () => {
  it('permite Captura y Auxiliar con coordinación', () => {
    expect(() => validarAsignacion(Rol.CAPTURA, '1')).not.toThrow();
    expect(() => validarAsignacion(Rol.AUXILIAR, '1')).not.toThrow();
  });

  it('impide promover a Administrador', () => {
    expect(() => validarAsignacion(Rol.ADMINISTRADOR, null)).toThrow(ForbiddenException);
  });

  it('exige coordinación', () => {
    expect(() => validarAsignacion(Rol.CAPTURA, null)).toThrow(BadRequestException);
  });

  it('permite ocupar un cupo libre de Captura o Auxiliar', () => {
    expect(() => validarDisponibilidadRol(Rol.CAPTURA, false)).not.toThrow();
    expect(() => validarDisponibilidadRol(Rol.AUXILIAR, false)).not.toThrow();
  });

  it('rechaza si la coordinación ya tiene una asignación activa del mismo rol', () => {
    expect(() => validarDisponibilidadRol(Rol.CAPTURA, true)).toThrow(ConflictException);
    expect(() => validarDisponibilidadRol(Rol.AUXILIAR, true)).toThrow(ConflictException);
  });
});
