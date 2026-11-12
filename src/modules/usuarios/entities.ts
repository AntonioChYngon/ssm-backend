import { Column, Entity, ManyToOne, JoinColumn } from 'typeorm';
import { Base } from '../../common/base.entity';
import { CanalNotificacion, Rol } from '../../common/enums';

@Entity('licenciaturas')
export class Licenciatura extends Base {
  @Column({ length: 120, unique: true })
  nombre: string;

  /** Organismo acreditador (IEVA): CONAC, CONAED, CACEI… */
  @Column({ length: 40 })
  organismo: string;
}

@Entity('usuarios')
export class Usuario extends Base {
  @Column({ length: 160 })
  nombre: string;

  @Column({ length: 160, unique: true })
  correo: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: Rol })
  rol: Rol;

  @ManyToOne(() => Licenciatura, { nullable: true, eager: true })
  @JoinColumn({ name: 'licenciatura_id' })
  licenciatura: Licenciatura | null;

  @Column({ name: 'licenciatura_id', nullable: true })
  licenciaturaId: string | null;

  @Column({ default: true })
  activo: boolean;

  /** Obliga a cambiar la contraseña temporal en el primer acceso. */
  @Column({ name: 'debe_cambiar_password', default: true })
  debeCambiarPassword: boolean;

  @Column({ name: 'canal_notificacion', type: 'enum', enum: CanalNotificacion, default: CanalNotificacion.AMBOS })
  canalNotificacion: CanalNotificacion;

  @Column({ name: 'ultimo_acceso', type: 'datetime', nullable: true })
  ultimoAcceso: Date | null;

  @Column({ name: 'token_recuperacion', type: 'varchar', length: 128, nullable: true, select: false })
  tokenRecuperacion: string | null;

  @Column({ name: 'token_recuperacion_expira', type: 'datetime', nullable: true, select: false })
  tokenRecuperacionExpira: Date | null;
}
