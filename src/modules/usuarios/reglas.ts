// HU-02 · Reglas de negocio puras (sin base de datos), fáciles de probar con Jest.
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Rol } from '../../common/enums';

/**
 * Valida la asignación que el Administrador hace a un usuario de coordinación.
 * - Por esta vía nunca se crea ni se promueve a un Administrador (HU-02).
 * - Captura y Auxiliar siempre pertenecen a una coordinación (CHECK de asignacion_usuario).
 */
export const validarAsignacion = (rol: Rol, coordinacionId: string | null | undefined) => {
  if (rol === Rol.ADMINISTRADOR) {
    throw new ForbiddenException('Un usuario de coordinación no puede ser promovido a Administrador.');
  }
  if (!coordinacionId) {
    throw new BadRequestException('Selecciona la coordinación a la que pertenece el usuario.');
  }
};

/** La coordinación admite como máximo una asignación activa de cada tipo. */
export const validarDisponibilidadRol = (rol: Rol, yaOcupada: boolean) => {
  if (!yaOcupada) return;
  const nombre = rol === Rol.CAPTURA ? 'Captura' : 'Auxiliar';
  throw new ConflictException(`La coordinación ya tiene una cuenta de ${nombre} activa.`);
};
