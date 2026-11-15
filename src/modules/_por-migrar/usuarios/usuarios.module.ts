import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { esCorreoInstitucional, leerDominios } from '../auth/dominio';
import { BitacoraService } from '../bitacora/bitacora.module';
import { ActualizarUsuarioDto, CrearLicenciaturaDto, CrearUsuarioDto, PreferenciasDto } from './dto';
import { Licenciatura, Usuario } from './entities';

const contrasenaTemporal = () => `Ssm-${randomBytes(6).toString('base64url')}1`;

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Licenciatura) private readonly licenciaturas: Repository<Licenciatura>,
    private readonly bitacora: BitacoraService,
    private readonly config: ConfigService,
  ) {}

  listar() {
    return this.usuarios.find({ order: { nombre: 'ASC' } });
  }

  async crear(dto: CrearUsuarioDto, autor: UsuarioToken) {
    const correo = dto.correo.trim().toLowerCase();
    if (!esCorreoInstitucional(correo, leerDominios(this.config.get('DOMINIOS_PERMITIDOS')))) {
      throw new BadRequestException('Usa un correo @acatlan.unam.mx o @unam.mx. No se aceptan correos personales.');
    }
    if (dto.rol !== Rol.ADMINISTRADOR && !dto.licenciaturaId) {
      throw new BadRequestException('Asigna una licenciatura al Capturista o Auxiliar.');
    }
    if (await this.usuarios.exists({ where: { correo } })) {
      throw new BadRequestException('Ya existe un usuario con ese correo.');
    }
    const temporal = contrasenaTemporal();
    const usuario = await this.usuarios.save(
      this.usuarios.create({
        nombre: dto.nombre.trim(),
        correo,
        rol: dto.rol,
        licenciaturaId: dto.rol === Rol.ADMINISTRADOR ? null : dto.licenciaturaId,
        passwordHash: await bcrypt.hash(temporal, 12),
        debeCambiarPassword: true,
      }),
    );
    await this.bitacora.registrar(autor, 'USUARIO_CREADO', 'Usuario', usuario.id, `Alta de ${correo} como ${dto.rol}`);
    // TODO(HU-02): enviar `temporal` por correo institucional (servicio SMTP de la FES). Nunca devolverla en la respuesta.
    return usuario;
  }

  async actualizar(id: string, dto: ActualizarUsuarioDto, autor: UsuarioToken) {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    Object.assign(usuario, dto);
    await this.usuarios.save(usuario);
    await this.bitacora.registrar(autor, 'USUARIO_ACTUALIZADO', 'Usuario', id, `Cambios: ${Object.keys(dto).join(', ')}`);
    return usuario;
  }

  async restablecer(id: string, autor: UsuarioToken) {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    const temporal = contrasenaTemporal();
    await this.usuarios.update(id, { passwordHash: await bcrypt.hash(temporal, 12), debeCambiarPassword: true });
    await this.bitacora.registrar(autor, 'PASSWORD_RESTABLECIDA', 'Usuario', id, `Se envió contraseña temporal a ${usuario.correo}`);
    // TODO(HU-02): enviar `temporal` por correo.
    return { mensaje: 'Se envió una contraseña temporal al correo del usuario.' };
  }

  async preferencias(usuarioId: string, dto: PreferenciasDto) {
    await this.usuarios.update(usuarioId, { canalNotificacion: dto.canalNotificacion });
    return { canalNotificacion: dto.canalNotificacion };
  }

  listarLicenciaturas() {
    return this.licenciaturas.find({ order: { nombre: 'ASC' } });
  }

  crearLicenciatura(dto: CrearLicenciaturaDto) {
    return this.licenciaturas.save(this.licenciaturas.create(dto));
  }
}

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly servicio: UsuariosService) {}

  @Get()
  @Roles(Rol.ADMINISTRADOR)
  listar() {
    return this.servicio.listar();
  }

  @Post()
  @Roles(Rol.ADMINISTRADOR)
  crear(@Body() dto: CrearUsuarioDto, @UsuarioActual() autor: UsuarioToken) {
    return this.servicio.crear(dto, autor);
  }

  @Patch(':id')
  @Roles(Rol.ADMINISTRADOR)
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActualizarUsuarioDto, @UsuarioActual() autor: UsuarioToken) {
    return this.servicio.actualizar(id, dto, autor);
  }

  @Post(':id/restablecer')
  @Roles(Rol.ADMINISTRADOR)
  restablecer(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() autor: UsuarioToken) {
    return this.servicio.restablecer(id, autor);
  }

  /** Preferencias de notificación del usuario actual (Correo / In-App / Ambos). */
  @Patch('yo/preferencias')
  preferencias(@Body() dto: PreferenciasDto, @UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.preferencias(usuario.sub, dto);
  }
}

@ApiTags('Licenciaturas')
@ApiBearerAuth()
@Controller('licenciaturas')
export class LicenciaturasController {
  constructor(private readonly servicio: UsuariosService) {}

  @Get()
  listar() {
    return this.servicio.listarLicenciaturas();
  }

  @Post()
  @Roles(Rol.ADMINISTRADOR)
  crear(@Body() dto: CrearLicenciaturaDto) {
    return this.servicio.crearLicenciatura(dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, Licenciatura])],
  controllers: [UsuariosController, LicenciaturasController],
  providers: [UsuariosService],
  exports: [UsuariosService, TypeOrmModule],
})
export class UsuariosModule {}
