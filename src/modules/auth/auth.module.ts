import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString, Length } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { Publico, UsuarioActual, UsuarioToken } from '../../common/auth';
import { AsignacionUsuario, TokenRestauracion, Usuario } from '../../database/entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from './dominio';

class LoginDto {
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  correo: string;

  @IsString()
  @Length(1, 128)
  contrasena: string;
}

class RecuperarDto {
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  correo: string;
}

class RestablecerDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @Length(8, 128)
  nueva: string;
}

class CambiarContrasenaDto {
  @IsString()
  @Length(1, 128)
  actual: string;

  @IsString()
  @Length(8, 128)
  nueva: string;
}

/** Datos del usuario que recibe el frontend (nunca incluye el hash). */
export type PerfilUsuario = {
  id: string;
  nombre: string;
  correo: string;
  rol: AsignacionUsuario['rolCodigo'];
  coordinacion: string | null;
  licenciatura: string | null;
  activo: boolean;
};

const COSTO_BCRYPT = 12;
const MINUTOS_TOKEN = 30;
const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos.';
const MENSAJE_CONTRASENA = 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.';
// Hash de relleno: si el correo no existe se compara igual, para que el tiempo de respuesta no revele qué cuentas existen.
const HASH_RELLENO = bcrypt.hashSync('relleno-no-es-una-contrasena', COSTO_BCRYPT);

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(AsignacionUsuario) private readonly asignaciones: Repository<AsignacionUsuario>,
    @InjectRepository(TokenRestauracion) private readonly tokens: Repository<TokenRestauracion>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private validarDominio(correo: string) {
    const limpio = correo.trim().toLowerCase();
    if (!esCorreoInstitucional(limpio, leerDominios(this.config.get('DOMINIOS_PERMITIDOS')))) {
      throw new BadRequestException('Usa tu correo institucional @acatlan.unam.mx o @pcpuma.acatlan.unam.mx.');
    }
    return limpio;
  }

  private buscarConHash(where: { correo: string } | { id: string }) {
    const [campo, valor] = 'correo' in where ? ['correo', where.correo] : ['id', where.id];
    return this.usuarios.createQueryBuilder('u').addSelect('u.hashContrasena').where(`u.${campo} = :valor`, { valor }).getOne();
  }

  private asignacionActiva(usuarioId: string) {
    return this.asignaciones.findOne({ where: { usuarioId, activa: true }, relations: { coordinacion: { licenciatura: true } } });
  }

  private perfil(usuario: Usuario, asignacion: AsignacionUsuario): PerfilUsuario {
    return {
      id: usuario.id,
      nombre: `${usuario.nombre} ${usuario.apellido}`.trim(),
      correo: usuario.correo,
      rol: asignacion.rolCodigo,
      coordinacion: asignacion.coordinacion?.nombre ?? null,
      licenciatura: asignacion.coordinacion?.licenciatura?.nombre ?? null,
      activo: usuario.activo,
    };
  }

  async login({ correo, contrasena }: LoginDto) {
    const limpio = this.validarDominio(correo);
    const usuario = await this.buscarConHash({ correo: limpio });
    const contrasenaValida = await bcrypt.compare(contrasena, usuario?.hashContrasena ?? HASH_RELLENO);
    const asignacion = usuario ? await this.asignacionActiva(usuario.id) : null;

    if (!usuario || !contrasenaValida || !usuario.activo) {
      if (usuario) {
        await this.auditoria.registrar(
          { sub: usuario.id, rol: asignacion?.rolCodigo ?? 'SIN_ROL' },
          { entidad: 'usuario', entidadId: usuario.id, campo: 'sesion', nuevo: 'INTENTO_FALLIDO' },
        );
      }
      throw new UnauthorizedException(MENSAJE_CREDENCIALES);
    }
    if (!asignacion) {
      throw new UnauthorizedException('Tu cuenta no tiene un rol asignado. Contacta al Administrador del sistema.');
    }

    const payload: UsuarioToken = {
      sub: usuario.id,
      correo: usuario.correo,
      rol: asignacion.rolCodigo,
      coordinacionId: asignacion.coordinacionId,
      licenciaturaId: asignacion.coordinacion?.licenciaturaId ?? null,
    };
    await this.auditoria.registrar(payload, { entidad: 'usuario', entidadId: usuario.id, campo: 'sesion', nuevo: 'INICIO_SESION' });
    return { token: await this.jwt.signAsync(payload), usuario: this.perfil(usuario, asignacion) };
  }

  async me(token: UsuarioToken): Promise<PerfilUsuario> {
    const usuario = await this.usuarios.findOneBy({ id: token.sub });
    const asignacion = await this.asignacionActiva(token.sub);
    if (!usuario || !usuario.activo || !asignacion) throw new UnauthorizedException('Tu sesión ya no es válida. Vuelve a iniciar sesión.');
    return this.perfil(usuario, asignacion);
  }

  async recuperar({ correo }: RecuperarDto) {
    const limpio = this.validarDominio(correo);
    const usuario = await this.usuarios.findOneBy({ correo: limpio, activo: true });
    if (usuario) {
      // Un solo enlace vigente por usuario: los anteriores se marcan como usados.
      await this.tokens.update({ usuarioId: usuario.id, usadoEn: IsNull() }, { usadoEn: new Date() });
      const token = randomBytes(32).toString('base64url');
      await this.tokens.insert({ usuarioId: usuario.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + MINUTOS_TOKEN * 60_000) });
      // TODO(HU-02): enviar por correo el enlace `${FRONTEND_URL}/recuperar?token=${token}` con el SMTP institucional.
    }
    // Misma respuesta exista o no la cuenta.
    return { mensaje: `Si el correo está registrado, recibirás un enlace válido por ${MINUTOS_TOKEN} minutos.` };
  }

  async restablecer({ token, nueva }: RestablecerDto) {
    if (!esContrasenaSegura(nueva)) throw new BadRequestException(MENSAJE_CONTRASENA);
    const registro = await this.tokens.findOneBy({ tokenHash: sha256(token), usadoEn: IsNull(), expiraEn: MoreThan(new Date()) });
    if (!registro) throw new BadRequestException('El enlace no es válido o ya venció. Solicita uno nuevo.');
    await this.usuarios.update(registro.usuarioId, { hashContrasena: await bcrypt.hash(nueva, COSTO_BCRYPT) });
    await this.tokens.update(registro.id, { usadoEn: new Date() });
    const asignacion = await this.asignacionActiva(registro.usuarioId);
    if (asignacion) {
      await this.auditoria.registrar({ sub: registro.usuarioId, rol: asignacion.rolCodigo }, { entidad: 'usuario', entidadId: registro.usuarioId, campo: 'hash_contrasena', nuevo: 'RESTABLECIDA' });
    }
    return { mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  async cambiar(token: UsuarioToken, { actual, nueva }: CambiarContrasenaDto) {
    if (!esContrasenaSegura(nueva)) throw new BadRequestException(MENSAJE_CONTRASENA);
    const usuario = await this.buscarConHash({ id: token.sub });
    if (!usuario || !(await bcrypt.compare(actual, usuario.hashContrasena))) throw new BadRequestException('La contraseña actual no es correcta.');
    await this.usuarios.update(usuario.id, { hashContrasena: await bcrypt.hash(nueva, COSTO_BCRYPT) });
    await this.auditoria.registrar(token, { entidad: 'usuario', entidadId: usuario.id, campo: 'hash_contrasena', nuevo: 'CAMBIADA' });
    return { mensaje: 'Contraseña actualizada.' };
  }
}

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Publico()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('recuperar')
  @HttpCode(200)
  recuperar(@Body() dto: RecuperarDto) {
    return this.auth.recuperar(dto);
  }

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('restablecer')
  @HttpCode(200)
  restablecer(@Body() dto: RestablecerDto) {
    return this.auth.restablecer(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@UsuarioActual() usuario: UsuarioToken) {
    return this.auth.me(usuario);
  }

  @ApiBearerAuth()
  @Post('cambiar-contrasena')
  @HttpCode(200)
  cambiar(@UsuarioActual() usuario: UsuarioToken, @Body() dto: CambiarContrasenaDto) {
    return this.auth.cambiar(usuario, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, AsignacionUsuario, TokenRestauracion])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
