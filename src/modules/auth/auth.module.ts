import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString, Length } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import { MoreThan, Repository } from 'typeorm';
import { Publico, UsuarioActual, UsuarioToken } from '../../common/auth';
import { BitacoraService } from '../bitacora/bitacora.module';
import { Usuario } from '../usuarios/entities';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from './dominio';

class LoginDto {
  @IsEmail({}, { message: 'Escribe un correo válido.' })
  correo: string;

  @IsString()
  @Length(1, 128)
  contrasena: string;
}

class RecuperarDto {
  @IsEmail()
  correo: string;
}

class RestablecerDto {
  @IsString()
  token: string;

  @IsString()
  @Length(8, 128)
  nueva: string;
}

class CambiarContrasenaDto {
  @IsString()
  actual: string;

  @IsString()
  @Length(8, 128)
  nueva: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly bitacora: BitacoraService,
  ) {}

  private dominios() {
    return leerDominios(this.config.get('DOMINIOS_PERMITIDOS'));
  }

  async login({ correo, contrasena }: LoginDto) {
    const limpio = correo.trim().toLowerCase();
    if (!esCorreoInstitucional(limpio, this.dominios())) {
      throw new BadRequestException('Usa tu correo institucional @acatlan.unam.mx o @unam.mx.');
    }
    const usuario = await this.usuarios
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.licenciatura', 'l')
      .where('u.correo = :correo', { correo: limpio })
      .getOne();
    // Mismo mensaje para usuario inexistente o contraseña incorrecta (no revela qué cuentas existen).
    if (!usuario || !usuario.activo || !(await bcrypt.compare(contrasena, usuario.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    await this.usuarios.update(usuario.id, { ultimoAcceso: new Date() });
    const payload: UsuarioToken = { sub: usuario.id, correo: usuario.correo, rol: usuario.rol, licenciaturaId: usuario.licenciaturaId };
    await this.bitacora.registrar(payload, 'INICIO_SESION', 'Usuario', usuario.id, 'Inicio de sesión');
    const { passwordHash: _omit, ...publico } = usuario;
    return { token: await this.jwt.signAsync(payload), usuario: publico };
  }

  async recuperar({ correo }: RecuperarDto) {
    const limpio = correo.trim().toLowerCase();
    if (!esCorreoInstitucional(limpio, this.dominios())) throw new BadRequestException('Ese correo no pertenece al dominio institucional.');
    const usuario = await this.usuarios.findOneBy({ correo: limpio, activo: true });
    if (usuario) {
      const token = randomBytes(32).toString('base64url');
      await this.usuarios.update(usuario.id, { tokenRecuperacion: hashToken(token), tokenRecuperacionExpira: new Date(Date.now() + 30 * 60_000) });
      // TODO(HU-02): enviar por correo el enlace `${FRONTEND_URL}/recuperar?token=${token}`.
    }
    // Respuesta idéntica exista o no la cuenta.
    return { mensaje: 'Si el correo está registrado, recibirás un enlace válido por 30 minutos.' };
  }

  async restablecer({ token, nueva }: RestablecerDto) {
    if (!esContrasenaSegura(nueva)) throw new BadRequestException('La contraseña debe tener 8 caracteres, una mayúscula y un número.');
    const usuario = await this.usuarios.findOne({ where: { tokenRecuperacion: hashToken(token), tokenRecuperacionExpira: MoreThan(new Date()) } });
    if (!usuario) throw new BadRequestException('El enlace no es válido o ya venció. Solicita uno nuevo.');
    await this.usuarios.update(usuario.id, { passwordHash: await bcrypt.hash(nueva, 12), tokenRecuperacion: null, tokenRecuperacionExpira: null, debeCambiarPassword: false });
    return { mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  async cambiar(usuarioToken: UsuarioToken, { actual, nueva }: CambiarContrasenaDto) {
    if (!esContrasenaSegura(nueva)) throw new BadRequestException('La contraseña debe tener 8 caracteres, una mayúscula y un número.');
    const usuario = await this.usuarios.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: usuarioToken.sub }).getOne();
    if (!usuario || !(await bcrypt.compare(actual, usuario.passwordHash))) throw new BadRequestException('La contraseña actual no es correcta.');
    await this.usuarios.update(usuario.id, { passwordHash: await bcrypt.hash(nueva, 12), debeCambiarPassword: false });
    await this.bitacora.registrar(usuarioToken, 'PASSWORD_CAMBIADA', 'Usuario', usuario.id, 'Cambio de contraseña');
    return { mensaje: 'Contraseña actualizada.' };
  }

  me(usuario: UsuarioToken) {
    return this.usuarios.findOneByOrFail({ id: usuario.sub });
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
  imports: [UsuariosModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
