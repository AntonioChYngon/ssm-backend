import { Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Between, Column, Entity, In, Index, LessThan, Repository } from 'typeorm';
import { UsuarioActual, UsuarioToken } from '../../common/auth';
import { Base } from '../../common/base.entity';
import { CanalNotificacion, Rol, TipoNotificacion } from '../../common/enums';
import { Hito } from '../planes/entities';
import { Usuario } from '../usuarios/entities';

@Entity('notificaciones')
export class Notificacion extends Base {
  @Index()
  @Column({ name: 'usuario_id' })
  usuarioId: string;

  @Column({ type: 'enum', enum: TipoNotificacion })
  tipo: TipoNotificacion;

  @Column({ length: 120 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  /** Ruta del frontend a la que lleva "Ver documento". */
  @Column({ length: 200 })
  enlace: string;

  @Column({ default: false })
  leida: boolean;

  /** Clave para no duplicar avisos automáticos (ej. "hito:<id>:proximo"). */
  @Column({ name: 'clave_unica', length: 120, nullable: true, unique: true })
  claveUnica: string | null;
}

type NuevaNotificacion = Pick<Notificacion, 'tipo' | 'titulo' | 'descripcion' | 'enlace'> & { claveUnica?: string };

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @InjectRepository(Notificacion) private readonly repo: Repository<Notificacion>,
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Hito) private readonly hitos: Repository<Hito>,
    private readonly config: ConfigService,
  ) {}

  listar(usuarioId: string) {
    return this.repo.find({ where: { usuarioId }, order: { creadoEn: 'DESC' }, take: 50 });
  }

  async marcar(usuarioId: string, id: string, leida: boolean) {
    await this.repo.update({ id, usuarioId }, { leida });
    return { id, leida };
  }

  async marcarTodas(usuarioId: string) {
    await this.repo.update({ usuarioId, leida: false }, { leida: true });
    return { ok: true };
  }

  /** Avisa a los usuarios de una licenciatura respetando su canal preferido (HU-10/HU-11). */
  async notificarLicenciatura(licenciaturaId: string, datos: NuevaNotificacion) {
    const destinatarios = await this.usuarios.find({ where: { licenciaturaId, activo: true, rol: In([Rol.CAPTURISTA, Rol.AUXILIAR]) } });
    await this.enviar(destinatarios, datos);
  }

  async notificarAdministradores(datos: NuevaNotificacion) {
    const admins = await this.usuarios.find({ where: { rol: Rol.ADMINISTRADOR, activo: true } });
    await this.enviar(admins, datos);
  }

  private async enviar(destinatarios: Usuario[], datos: NuevaNotificacion) {
    for (const usuario of destinatarios) {
      const claveUnica = datos.claveUnica ? `${datos.claveUnica}:${usuario.id}` : null;
      if (claveUnica && (await this.repo.exists({ where: { claveUnica } }))) continue;
      if (usuario.canalNotificacion !== CanalNotificacion.CORREO) {
        await this.repo.insert({ ...datos, claveUnica, usuarioId: usuario.id });
      }
      if (usuario.canalNotificacion !== CanalNotificacion.IN_APP) {
        // TODO(HU-10): enviar correo con el servidor SMTP institucional.
        this.logger.log(`Correo pendiente para ${usuario.correo}: ${datos.titulo}`);
      }
    }
  }

  /** Todos los días a las 7:00: hitos próximos a vencer y hitos vencidos con rezago. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: 'America/Mexico_City' })
  async revisarHitos() {
    const dias = Number(this.config.get('DIAS_AVISO_HITO') ?? 7);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const hoy = iso(new Date());
    const limite = iso(new Date(Date.now() + dias * 86_400_000));

    const proximos = await this.hitos.find({ where: { fechaCompromiso: Between(hoy, limite) }, relations: { recomendacion: { plan: true } } });
    for (const h of proximos) {
      if (h.porcentajeReal >= h.porcentajeEsperado) continue;
      await this.notificarLicenciatura(h.recomendacion.plan.licenciaturaId, {
        tipo: TipoNotificacion.HITO,
        titulo: 'Hito próximo',
        descripcion: `“${h.descripcion}” vence el ${h.fechaCompromiso.split('-').reverse().join('/')} (${h.porcentajeEsperado}% esperado).`,
        enlace: '/licenciatura/hitos',
        claveUnica: `hito:${h.id}:proximo`,
      });
    }

    const vencidos = await this.hitos.find({ where: { fechaCompromiso: LessThan(hoy) }, relations: { recomendacion: { plan: true } } });
    for (const h of vencidos.filter((x) => x.porcentajeReal < x.porcentajeEsperado)) {
      await this.notificarLicenciatura(h.recomendacion.plan.licenciaturaId, {
        tipo: TipoNotificacion.VENCIMIENTO,
        titulo: 'Hito vencido',
        descripcion: `“${h.descripcion}” venció con ${h.porcentajeReal}% de avance (se esperaba ${h.porcentajeEsperado}%).`,
        enlace: '/licenciatura/hitos',
        claveUnica: `hito:${h.id}:vencido`,
      });
    }
  }
}

@ApiTags('Notificaciones')
@ApiBearerAuth()
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly servicio: NotificacionesService) {}

  @Get()
  listar(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.listar(usuario.sub);
  }

  @Patch('leer-todas')
  @HttpCode(200)
  leerTodas(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.marcarTodas(usuario.sub);
  }

  @Patch(':id/leida')
  leida(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.marcar(usuario.sub, id, true);
  }

  @Patch(':id/no-leida')
  noLeida(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.marcar(usuario.sub, id, false);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Notificacion, Usuario, Hito])],
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
