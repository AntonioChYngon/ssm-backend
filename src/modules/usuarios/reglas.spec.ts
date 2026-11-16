import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Rol } from '../../common/enums';
import { validarAsignacion } from './reglas';

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

  it.todo('rechaza una segunda cuenta de Captura activa en la misma coordinación');
  it.todo('al cambiar de titular, el historial sigue ligado a la coordinación');
});
