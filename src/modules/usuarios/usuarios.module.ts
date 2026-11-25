// HU-02 · Administración de cuentas, auxiliares y gestión de contraseñas.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AsignacionUsuario, Coordinacion, Usuario } from '../../database/entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { CorreoService } from '../correo/correo.module';
import { esCorreoInstitucional, leerDominios } from '../auth/dominio';
import { validarAsignacion, validarDisponibilidadRol } from './reglas';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

export class CrearUsuarioDto {
  @IsString() @Length(2, 120) @Matches(/\S/, { message: 'Escribe el nombre.' }) nombre: string;
  @IsString() @Length(2, 120) @Matches(/\S/, { message: 'Escribe el apellido.' }) apellido: string;
  @IsEmail({}, { message: 'Escribe un correo válido.' }) correo: string;
  @IsIn([Rol.CAPTURA, Rol.AUXILIAR]) rol: Rol;
  @IsString() @Matches(/^\d+$/, { message: 'Selecciona una coordinación válida.' }) coordinacionId: string;
}

export class CambiarAsignacionDto {
  @IsIn([Rol.CAPTURA, Rol.AUXILIAR]) rol: Rol;
  @IsString() @Matches(/^\d+$/, { message: 'Selecciona una coordinación válida.' }) coordinacionId: string;
}

export class CambiarEstadoDto {
  @IsBoolean() activo: boolean;
  @IsOptional() @IsString() @Length(0, 250) motivo?: string;
}

export type UsuarioListado = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol | null;
  licenciatura: string | null;
  coordinacion: string | null;
  activo: boolean;
};

export type CoordinacionListado = { id: string; nombre: string; licenciaturaId: string; licenciatura: string };

const COSTO_BCRYPT = 12;
const generarContrasenaTemporal = () => `Ssm-${randomBytes(18).toString('base64url')}A7`;

// ---------- Servicio ----------

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(AsignacionUsuario) private readonly asignaciones: Repository<AsignacionUsuario>,
    @InjectRepository(Coordinacion) private readonly coordinaciones: Repository<Coordinacion>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Devuelve los datos de cuenta y su asignación vigente, nunca el hash ni la contraseña. */
  async listar(): Promise<UsuarioListado[]> {
    const usuarios = await this.usuarios.find({ order: { apellido: 'ASC' } });
    const activas = await this.asignaciones.find({ where: { activa: true }, relations: { coordinacion: { licenciatura: true } } });
    const porUsuario = new Map<string, AsignacionUsuario>(activas.map((a) => [a.usuarioId, a]));
    return usuarios.map((u) => this.comoListado(u, porUsuario.get(u.id) ?? null));
  }

  async listarCoordinaciones(): Promise<CoordinacionListado[]> {
    const coordinaciones = await this.coordinaciones.find({
      where: { activa: true },
      relations: { licenciatura: true },
      order: { nombre: 'ASC' },
    });
    return coordinaciones.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      licenciaturaId: c.licenciaturaId,
      licenciatura: c.licenciatura.nombre,
    }));
  }

  async crear(admin: UsuarioToken, dto: CrearUsuarioDto): Promise<UsuarioListado> {
    validarAsignacion(dto.rol, dto.coordinacionId);
    const correo = dto.correo.trim().toLowerCase();
    if (!esCorreoInstitucional(correo, leerDominios(this.config.get('DOMINIOS_PERMITIDOS')))) {
      throw new BadRequestException('Usa un correo institucional permitido.');
    }
    const coordinacion = await this.coordinaciones.findOneBy({ id: dto.coordinacionId, activa: true });
    if (!coordinacion) throw new NotFoundException('La coordinación no existe o está inactiva.');
    if (await this.usuarios.existsBy({ correo })) throw new ConflictException('Ya existe una cuenta con ese correo institucional.');
    await this.validarCupo(dto.rol, coordinacion.id);

    const temporal = generarContrasenaTemporal();
    let usuario: Usuario;
    try {
      usuario = await this.dataSource.transaction(async (tx) => {
        const usuarios = tx.getRepository(Usuario);
        const asignaciones = tx.getRepository(AsignacionUsuario);
        const nuevo = await usuarios.save(usuarios.create({
          nombre: dto.nombre.trim(),
          apellido: dto.apellido.trim(),
          correo,
          hashContrasena: await bcrypt.hash(temporal, COSTO_BCRYPT),
          debeCambiarContrasena: true,
          activo: true,
        }));
        await asignaciones.save(asignaciones.create({
          usuarioId: nuevo.id,
          rolCodigo: dto.rol,
          coordinacionId: coordinacion.id,
          activa: true,
          desactivadaEn: null,
        }));
        // Si falla Mailpit/SMTP, revierte también la cuenta para no dejarla sin credenciales.
        await this.enviarContrasenaTemporal(nuevo, temporal, 'Tu cuenta del Sistema de Seguimiento de Mejora');
        return nuevo;
      });
    } catch (error) {
      this.lanzarSiDuplicado(error, correo);
      throw error;
    }
    await this.auditoria.registrar(admin, {
      entidad: 'usuario',
      entidadId: usuario.id,
      campo: 'alta',
      nuevo: JSON.stringify({ correo, rol: dto.rol, coordinacionId: coordinacion.id }),
    });
    return this.obtenerListado(usuario.id);
  }

  async cambiarAsignacion(admin: UsuarioToken, id: string, dto: CambiarAsignacionDto): Promise<UsuarioListado> {
    validarAsignacion(dto.rol, dto.coordinacionId);
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('No se encontró la cuenta.');
    const coordinacion = await this.coordinaciones.findOneBy({ id: dto.coordinacionId, activa: true });
    if (!coordinacion) throw new NotFoundException('La coordinación no existe o está inactiva.');
    const actual = await this.asignaciones.findOneBy({ usuarioId: id, activa: true });
    if (actual?.rolCodigo === dto.rol && actual.coordinacionId === coordinacion.id) return this.obtenerListado(id);

    await this.validarCupo(dto.rol, coordinacion.id, id);
    try {
      await this.dataSource.transaction(async (tx) => {
        const repo = tx.getRepository(AsignacionUsuario);
        const vigente = await repo.findOne({ where: { usuarioId: id, activa: true }, lock: { mode: 'pessimistic_write' } });
        if (vigente) {
          await repo.update(vigente.id, { activa: false, desactivadaEn: new Date() });
        }
        await repo.insert({ usuarioId: id, rolCodigo: dto.rol, coordinacionId: coordinacion.id, activa: true, desactivadaEn: null });
      });
    } catch (error) {
      this.lanzarSiDuplicado(error, usuario.correo, dto.rol);
      throw error;
    }

    await this.auditoria.registrar(admin, {
      entidad: 'usuario',
      entidadId: id,
      campo: 'asignacion',
      anterior: JSON.stringify(actual ? { rol: actual.rolCodigo, coordinacionId: actual.coordinacionId } : null),
      nuevo: JSON.stringify({ rol: dto.rol, coordinacionId: coordinacion.id }),
    });
    return this.obtenerListado(id);
  }

  async restablecer(admin: UsuarioToken, id: string): Promise<{ mensaje: string }> {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('No se encontró la cuenta.');
    const temporal = generarContrasenaTemporal();
    await this.dataSource.transaction(async (tx) => {
      await tx.getRepository(Usuario).update(id, { hashContrasena: await bcrypt.hash(temporal, COSTO_BCRYPT), debeCambiarContrasena: true });
      // Si no se puede entregar el correo, conserva la contraseña anterior.
      await this.enviarContrasenaTemporal(usuario, temporal, 'Restablecimiento de contraseña del SSM');
    });
    await this.auditoria.registrar(admin, {
      entidad: 'usuario',
      entidadId: id,
      campo: 'hash_contrasena',
      nuevo: 'RESTABLECIDA_POR_ADMINISTRADOR',
    });
    return { mensaje: `Se envió una contraseña temporal a ${usuario.correo}.` };
  }

  async cambiarEstado(admin: UsuarioToken, id: string, dto: CambiarEstadoDto): Promise<UsuarioListado> {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('No se encontró la cuenta.');
    if (usuario.activo === dto.activo) return this.obtenerListado(id);

    if (!dto.activo) {
      const esAdministrador = await this.asignaciones.existsBy({ usuarioId: id, rolCodigo: Rol.ADMINISTRADOR, activa: true });
      if (esAdministrador) {
        const administradoresActivos = await this.asignaciones.createQueryBuilder('a')
          .innerJoin('a.usuario', 'u')
          .where('a.rolCodigo = :rol', { rol: Rol.ADMINISTRADOR })
          .andWhere('a.activa = true')
          .andWhere('u.activo = true')
          .getCount();
        if (administradoresActivos <= 1) {
          throw new ConflictException('No se puede desactivar la única cuenta Administrador activa.');
        }
      }
    }

    await this.usuarios.update(id, { activo: dto.activo });
    await this.auditoria.registrar(admin, {
      entidad: 'usuario',
      entidadId: id,
      campo: 'estado',
      anterior: usuario.activo ? 'ACTIVO' : 'INACTIVO',
      nuevo: JSON.stringify({ estado: dto.activo ? 'ACTIVO' : 'INACTIVO', motivo: dto.motivo?.trim() || null }),
    });
    return this.obtenerListado(id);
  }

  private async validarCupo(rol: Rol, coordinacionId: string, excluirUsuarioId?: string) {
    const consulta = this.asignaciones.createQueryBuilder('a')
      .where('a.rolCodigo = :rol', { rol })
      .andWhere('a.coordinacionId = :coordinacionId', { coordinacionId })
      .andWhere('a.activa = :activa', { activa: true });
    if (excluirUsuarioId) consulta.andWhere('a.usuarioId <> :excluirUsuarioId', { excluirUsuarioId });
    validarDisponibilidadRol(rol, Boolean(await consulta.getOne()));
  }

  private async obtenerListado(id: string): Promise<UsuarioListado> {
    const usuario = await this.usuarios.findOneBy({ id });
    if (!usuario) throw new NotFoundException('No se encontró la cuenta.');
    const asignacion = await this.asignaciones.findOne({
      where: { usuarioId: id, activa: true },
      relations: { coordinacion: { licenciatura: true } },
    });
    return this.comoListado(usuario, asignacion);
  }

  private comoListado(usuario: Usuario, asignacion: AsignacionUsuario | null): UsuarioListado {
    return {
      id: usuario.id,
      nombre: `${usuario.nombre} ${usuario.apellido}`.trim(),
      correo: usuario.correo,
      rol: asignacion?.rolCodigo ?? null,
      licenciatura: asignacion?.coordinacion?.licenciatura?.nombre ?? null,
      coordinacion: asignacion?.coordinacion?.nombre ?? null,
      activo: usuario.activo,
    };
  }

  private async enviarContrasenaTemporal(usuario: Usuario, temporal: string, asunto: string) {
    await this.correo.enviar({
      para: usuario.correo,
      asunto,
      texto: `Hola ${usuario.nombre}:\n\nTu contraseña temporal para ingresar al Sistema de Seguimiento de Mejora es:\n${temporal}\n\nInicia sesión con tu correo institucional: el sistema te pedirá crear una contraseña nueva antes de continuar.`,
    });
  }

  private lanzarSiDuplicado(error: unknown, correo: string, rol?: Rol): never | void {
    if (!(error instanceof QueryFailedError)) return;
    const driver = error.driverError as { code?: string; sqlMessage?: string; message?: string };
    if (driver.code !== 'ER_DUP_ENTRY') return;
    const detalle = driver.sqlMessage ?? driver.message ?? '';
    if (detalle.includes('uq_asignacion_captura_activa')) {
      throw new ConflictException('La coordinación ya tiene una cuenta de Captura activa.');
    }
    if (detalle.includes('uq_asignacion_auxiliar_activa')) {
      throw new ConflictException('La coordinación ya tiene una cuenta de Auxiliar activa.');
    }
    if (detalle.includes('uq_asignacion_usuario_activa')) {
      throw new ConflictException('La cuenta ya tiene una asignación activa.');
    }
    if (rol) throw new ConflictException(`La coordinación ya tiene una cuenta de ${rol === Rol.CAPTURA ? 'Captura' : 'Auxiliar'} activa.`);
    throw new ConflictException(`Ya existe una cuenta con el correo ${correo}.`);
  }
}

// ---------- Controlador ----------

@ApiTags('HU-02 · Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
@Roles(Rol.ADMINISTRADOR)
export class UsuariosController {
  constructor(private readonly servicio: UsuariosService) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Get('coordinaciones')
  listarCoordinaciones() {
    return this.servicio.listarCoordinaciones();
  }

  @Post()
  crear(@UsuarioActual() admin: UsuarioToken, @Body() dto: CrearUsuarioDto) {
    return this.servicio.crear(admin, dto);
  }

  @Patch(':id/asignacion')
  cambiarAsignacion(@UsuarioActual() admin: UsuarioToken, @Param('id') id: string, @Body() dto: CambiarAsignacionDto) {
    return this.servicio.cambiarAsignacion(admin, id, dto);
  }

  @Post(':id/restablecer')
  restablecer(@UsuarioActual() admin: UsuarioToken, @Param('id') id: string) {
    return this.servicio.restablecer(admin, id);
  }

  @Patch(':id/estado')
  cambiarEstado(@UsuarioActual() admin: UsuarioToken, @Param('id') id: string, @Body() dto: CambiarEstadoDto) {
    return this.servicio.cambiarEstado(admin, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, AsignacionUsuario, Coordinacion])],
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
