import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Rol } from './enums';

/** Contenido del JWT. Los ids son BIGINT del esquema, enviados como texto. */
export type UsuarioToken = {
  sub: string;
  correo: string;
  rol: Rol;
  coordinacionId: string | null;
  licenciaturaId: string | null;
};

type RequestConUsuario = Request & { usuario?: UsuarioToken };

const PUBLICO = 'ssm:publico';
const ROLES = 'ssm:roles';

/** Marca una ruta como accesible sin sesión (login, recuperación). */
export const Publico = () => SetMetadata(PUBLICO, true);

/** Restringe una ruta a ciertos roles. Sin este decorador, cualquier usuario autenticado puede entrar. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

/** Inyecta el usuario del token en el controlador. */
export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioToken => {
  const request = ctx.switchToHttp().getRequest<RequestConUsuario>();
  if (!request.usuario) throw new UnauthorizedException();
  return request.usuario;
});

/** Guard global: valida el JWT y los roles requeridos. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, targets)) return true;

    const request = context.switchToHttp().getRequest<RequestConUsuario>();
    const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Inicia sesión para continuar.');

    try {
      request.usuario = await this.jwt.verifyAsync<UsuarioToken>(token);
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(request.usuario.rol)) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta acción.');
    }
    return true;
  }
}

/** Captura y Auxiliar solo ven su coordinación; el Administrador ve todas. */
export const verificarCoordinacion = (usuario: UsuarioToken, coordinacionId: string) => {
  if (usuario.rol !== Rol.ADMINISTRADOR && usuario.coordinacionId !== coordinacionId) {
    throw new ForbiddenException('Solo puedes consultar la información de tu coordinación.');
  }
};
