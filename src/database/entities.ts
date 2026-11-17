// Entidades de acceso mapeadas al esquema del equipo (db/ssm_mariadb.sql).
// El esquema lo administra el script SQL: TypeORM NO crea ni modifica tablas (synchronize: false).
// Los BIGINT se leen como string para no perder precisión en JavaScript.
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Rol } from '../common/enums';

@Entity('rol')
export class RolEntity {
  @PrimaryGeneratedColumn({ name: 'rol_id', type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 30 })
  codigo: Rol;

  @Column({ length: 80 })
  nombre: string;

  @Column({ type: 'varchar', length: 250, nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean' })
  activo: boolean;
}

@Entity('licenciatura')
export class Licenciatura {
  @PrimaryGeneratedColumn({ name: 'licenciatura_id', type: 'bigint' })
  id: string;

  @Column({ length: 30 })
  clave: string;

  @Column({ length: 180 })
  nombre: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  modalidad: string | null;

  @Column({ type: 'boolean' })
  activa: boolean;
}

@Entity('coordinacion')
export class Coordinacion {
  @PrimaryGeneratedColumn({ name: 'coordinacion_id', type: 'bigint' })
  id: string;

  @Column({ name: 'licenciatura_id', type: 'bigint' })
  licenciaturaId: string;

  @ManyToOne(() => Licenciatura)
  @JoinColumn({ name: 'licenciatura_id' })
  licenciatura: Licenciatura;

  @Column({ length: 180 })
  nombre: string;

  @Column({ type: 'boolean' })
  activa: boolean;
}

@Entity('usuario')
export class Usuario {
  @PrimaryGeneratedColumn({ name: 'usuario_id', type: 'bigint' })
  id: string;

  @Column({ length: 120 })
  nombre: string;

  @Column({ length: 120 })
  apellido: string;

  @Column({ length: 254 })
  correo: string;

  /** Hash bcrypt. Nunca se envía al cliente (select: false). */
  @Column({ name: 'hash_contrasena', length: 255, select: false })
  hashContrasena: string;

  @Column({ type: 'boolean' })
  activo: boolean;

  @Column({ name: 'creado_en', type: 'datetime', insert: false, update: false })
  creadoEn: Date;

  @Column({ name: 'actualizado_en', type: 'datetime', insert: false, update: false })
  actualizadoEn: Date;

  @OneToMany(() => AsignacionUsuario, (a) => a.usuario)
  asignaciones: AsignacionUsuario[];
}

/**
 * Rol y coordinación de un usuario. Solo una asignación activa por usuario.
 * Las columnas generadas (usuario_activo, captura_activa, auxiliar_activa) no se mapean: las calcula MariaDB.
 */
@Entity('asignacion_usuario')
export class AsignacionUsuario {
  @PrimaryGeneratedColumn({ name: 'asignacion_id', type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'bigint' })
  usuarioId: string;

  @ManyToOne(() => Usuario, (u) => u.asignaciones)
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ name: 'rol_codigo', type: 'varchar', length: 30 })
  rolCodigo: Rol;

  @Column({ name: 'coordinacion_id', type: 'bigint', nullable: true })
  coordinacionId: string | null;

  @ManyToOne(() => Coordinacion, { nullable: true })
  @JoinColumn({ name: 'coordinacion_id' })
  coordinacion: Coordinacion | null;

  @Column({ type: 'boolean' })
  activa: boolean;

  @Column({ name: 'asignada_en', type: 'datetime', insert: false, update: false })
  asignadaEn: Date;

  @Column({ name: 'desactivada_en', type: 'datetime', nullable: true })
  desactivadaEn: Date | null;
}

@Entity('token_restauracion_contrasena')
export class TokenRestauracion {
  @PrimaryGeneratedColumn({ name: 'token_id', type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'bigint' })
  usuarioId: string;

  /** SHA-256 en hexadecimal (64 caracteres). El token en claro solo viaja en el enlace del correo. */
  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'expira_en', type: 'datetime' })
  expiraEn: Date;

  @Column({ name: 'usado_en', type: 'datetime', nullable: true })
  usadoEn: Date | null;

  @Column({ name: 'creado_en', type: 'datetime', insert: false, update: false })
  creadoEn: Date;
}

/** Bitácora inmutable: los triggers de la base impiden UPDATE y DELETE. */
@Entity('registro_auditoria')
export class RegistroAuditoria {
  @PrimaryGeneratedColumn({ name: 'auditoria_id', type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'bigint' })
  usuarioId: string;

  @Column({ name: 'rol_codigo', length: 30 })
  rolCodigo: string;

  @Column({ length: 80 })
  entidad: string;

  @Column({ name: 'entidad_id', type: 'bigint' })
  entidadId: string;

  @Column({ length: 120 })
  campo: string;

  @Column({ name: 'valor_anterior', type: 'text', nullable: true })
  valorAnterior: string | null;

  @Column({ name: 'valor_nuevo', type: 'text', nullable: true })
  valorNuevo: string | null;

  @Column({ name: 'ocurrido_en', type: 'datetime', insert: false, update: false })
  ocurridoEn: Date;
}

/** Avisos dentro de la aplicación (y por correo cuando haya SMTP). */
@Entity('notificacion')
export class Notificacion {
  @PrimaryGeneratedColumn({ name: 'notificacion_id', type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'bigint' })
  usuarioId: string;

  @Column({ type: 'varchar', length: 40 })
  tipo: string;

  @Column({ length: 180 })
  titulo: string;

  @Column({ type: 'text' })
  mensaje: string;

  @Column({ name: 'programada_en', type: 'datetime', nullable: true })
  programadaEn: Date | null;

  @Column({ name: 'enviada_en', type: 'datetime', nullable: true })
  enviadaEn: Date | null;

  @Column({ name: 'leida_en', type: 'datetime', nullable: true })
  leidaEn: Date | null;

  @Column({ type: 'varchar', length: 20 })
  estado: 'PENDIENTE' | 'ENVIADA' | 'FALLIDA';
}

export const ENTIDADES_ACCESO = [RolEntity, Licenciatura, Coordinacion, Usuario, AsignacionUsuario, TokenRestauracion, RegistroAuditoria, Notificacion];
