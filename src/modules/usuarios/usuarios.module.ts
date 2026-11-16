// HU-02 · Administración de cuentas, auxiliares y gestión de contraseñas.
// Responsable: Desarrollador/a 1. Ver la lista de tareas en CONTRIBUTING.md.
import { Body, Controller, Get, Injectable, Module, NotImplementedException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AsignacionUsuario, Usuario } from '../../database/entities';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

export class CrearUsuarioDto {
  @IsString() @Length(2, 120) nombre: string;
  @IsString() @Length(2, 120) apellido: string;
  @IsString() @Matches(/@(acatlan|pcpuma\.acatlan)\.unam\.mx$/i, { message: 'Usa un correo institucional.' }) correo: string;
  @IsEnum([Rol.CAPTURA, Rol.AUXILIAR]) rol: Rol;
  @IsString() coordinacionId: string;
}

export class CambiarAsignacionDto {
  @IsEnum([Rol.CAPTURA, Rol.AUXILIAR]) rol: Rol;
  @IsString() coordinacionId: string;
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

// ---------- Servicio ----------

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(AsignacionUsuario) private readonly asignaciones: Repository<AsignacionUsuario>,
  ) {}

  /** Ya funciona: sirve de ejemplo de consulta con relaciones. */
  async listar(): Promise<UsuarioListado[]> {
    const usuarios = await this.usuarios.find({ order: { apellido: 'ASC' } });
    const activas = await this.asignaciones.find({ where: { activa: true }, relations: { coordinacion: { licenciatura: true } } });
    const porUsuario = new Map<string, AsignacionUsuario>(activas.map((a) => [a.usuarioId, a]));
    return usuarios.map((u) => {
      const a = porUsuario.get(u.id);
      return {
        id: u.id,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
        correo: u.correo,
        rol: a?.rolCodigo ?? null,
        licenciatura: a?.coordinacion?.licenciatura?.nombre ?? null,
        coordinacion: a?.coordinacion?.nombre ?? null,
        activo: u.activo,
      };
    });
  }

  // TODO(HU-02) crear(): validarAsignacion(), generar contraseña temporal, guardar hash bcrypt,
  //   crear asignacion_usuario, enviar credenciales con CorreoService y registrar en AuditoriaService.
  crear(_admin: UsuarioToken, _dto: CrearUsuarioDto): Promise<UsuarioListado> {
    throw new NotImplementedException('HU-02: alta de usuario pendiente');
  }

  // TODO(HU-02) cambiarAsignacion(): desactivar la asignación actual (activa=false, desactivada_en=NOW())
  //   y crear la nueva en una transacción. El historial queda ligado a la coordinación, no al usuario.
  cambiarAsignacion(_admin: UsuarioToken, _id: string, _dto: CambiarAsignacionDto): Promise<UsuarioListado> {
    throw new NotImplementedException('HU-02: cambio de asignación pendiente');
  }

  // TODO(HU-02) restablecer(): nueva contraseña temporal + correo al usuario + auditoría.
  restablecer(_admin: UsuarioToken, _id: string): Promise<{ mensaje: string }> {
    throw new NotImplementedException('HU-02: restablecimiento pendiente');
  }

  // TODO(HU-02) cambiarEstado(): activar o desactivar la cuenta (no se borra nunca).
  cambiarEstado(_admin: UsuarioToken, _id: string, _dto: CambiarEstadoDto): Promise<UsuarioListado> {
    throw new NotImplementedException('HU-02: activar/desactivar pendiente');
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
  imports: [TypeOrmModule.forFeature([Usuario, AsignacionUsuario])],
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
