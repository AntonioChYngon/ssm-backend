import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { CanalNotificacion, Rol } from '../../common/enums';

export class CrearUsuarioDto {
  @IsString()
  @Length(3, 160)
  nombre: string;

  @IsEmail({}, { message: 'Escribe un correo válido.' })
  correo: string;

  @IsEnum(Rol)
  rol: Rol;

  /** Obligatorio para Capturista y Auxiliar. */
  @IsOptional()
  @IsUUID()
  licenciaturaId?: string;
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  nombre?: string;

  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @IsOptional()
  @IsUUID()
  licenciaturaId?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class PreferenciasDto {
  @IsEnum(CanalNotificacion)
  canalNotificacion: CanalNotificacion;
}

export class CrearLicenciaturaDto {
  @IsString()
  @Length(3, 120)
  nombre: string;

  @IsString()
  @Length(2, 40)
  organismo: string;
}
