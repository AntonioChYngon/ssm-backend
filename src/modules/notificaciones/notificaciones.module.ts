// Avisos del sistema: se guardan para la campana de la aplicación (tabla notificacion) y se envían por correo
// institucional (HU-05, HU-08, HU-11). Si el correo falla, el aviso In-App queda igual y se marca FALLIDA.
import { Controller, ForbiddenException, Get, Global, Injectable, Logger, Module, NotFoundException, Param, Patch } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AsignacionUsuario, Notificacion } from '../../database/entities';
import { CorreoService } from '../correo/correo.module';

/** Tipos guardados en notificacion.tipo. */
export type TipoAviso =
  | 'PLAN_ENVIADO'
  | 'PLAN_VALIDADO'
  | 'PLAN_DEVUELTO'
  // Bloque Informe: HU-11 (enviado) y HU-08 (validado, devuelto, reabierto).
  | 'INFORME_ENVIADO'
  | 'INFORME_VALIDADO'
  | 'INFORME_DEVUELTO'
  | 'INFORME_REABIERTO';

export type Aviso = { tipo: TipoAviso; titulo: string; mensaje: string };
type Destinatario = { usuarioId: string; correo: string };

// ---------- Contrato (debe coincidir con Notificacion en ssm-frontend/src/lib/types.ts) ----------

export type NotificacionListado = {
  id: string;
  tipo: 'VENCIMIENTO' | 'META' | 'DEVOLUCION' | 'PLAN';
  titulo: string;
  descripcion: string;
  fecha: string;
  leida: boolean;
  enlace: string;
};

const TIPO_FRONT: Record<TipoAviso, NotificacionListado['tipo']> = {
  PLAN_ENVIADO: 'PLAN',
  PLAN_VALIDADO: 'PLAN',
  PLAN_DEVUELTO: 'DEVOLUCION',
  INFORME_ENVIADO: 'PLAN',
  INFORME_VALIDADO: 'PLAN',
  INFORME_DEVUELTO: 'DEVOLUCION',
  INFORME_REABIERTO: 'DEVOLUCION',
};
/** Enlace fijo por tipo de aviso: la pantalla donde se atiende. */
const ENLACE: Record<TipoAviso, string> = {
  PLAN_ENVIADO: '/admin/planes',
  PLAN_VALIDADO: '/licenciatura/dashboard',
  PLAN_DEVUELTO: '/licenciatura/plan',
  INFORME_ENVIADO: '/admin/informes',
  INFORME_VALIDADO: '/licenciatura/informe',
  INFORME_DEVUELTO: '/licenciatura/informe',
  INFORME_REABIERTO: '/licenciatura/informe',
};
const esTipoAviso = (tipo: string): tipo is TipoAviso => tipo in ENLACE;

/** Texto del correo: el mismo mensaje del aviso In-App más el enlace a la pantalla donde se atiende. */
export const cuerpoCorreo = (aviso: Aviso, frontendUrl: string) =>
  `${aviso.mensaje}\n\nConsúltalo en el sistema: ${frontendUrl.replace(/\/+$/, '')}${ENLACE[aviso.tipo] ?? '/'}\n\n` +
  'Este es un mensaje automático del Sistema de Seguimiento a la Mejora Continua (FES Acatlán). No respondas a este correo.';

const fechaCorta = (fecha: Date | null) =>
  fecha ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(fecha) : '';

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @InjectRepository(Notificacion) private readonly repo: Repository<Notificacion>,
    @InjectRepository(AsignacionUsuario) private readonly asignaciones: Repository<AsignacionUsuario>,
    private readonly correo: CorreoService,
    private readonly config: ConfigService,
  ) {}

  /** A todos los Administradores con cuenta activa. */
  async notificarAdministradores(aviso: Aviso) {
    const destinatarios = await this.asignaciones
      .createQueryBuilder('a')
      .innerJoin('a.usuario', 'u')
      .where('a.activa = TRUE AND u.activo = TRUE AND a.rolCodigo = :rol', { rol: Rol.ADMINISTRADOR })
      .select('a.usuarioId', 'usuarioId')
      .addSelect('u.correo', 'correo')
      .getRawMany<Destinatario>();
    await this.crear(destinatarios, aviso);
  }

  /** A Captura y Auxiliar activos de la coordinación de una licenciatura. */
  async notificarLicenciatura(licenciaturaId: string, aviso: Aviso) {
    const destinatarios = await this.asignaciones
      .createQueryBuilder('a')
      .innerJoin('a.usuario', 'u')
      .innerJoin('a.coordinacion', 'c')
      .where('a.activa = TRUE AND u.activo = TRUE AND c.licenciaturaId = :licenciaturaId', { licenciaturaId })
      .andWhere('a.rolCodigo IN (:...roles)', { roles: [Rol.CAPTURA, Rol.AUXILIAR] })
      .select('a.usuarioId', 'usuarioId')
      .addSelect('u.correo', 'correo')
      .getRawMany<Destinatario>();
    await this.crear(destinatarios, aviso);
  }

  /** Envía el correo a cada destinatario y guarda el aviso In-App con el resultado del envío. */
  private async crear(destinatarios: Destinatario[], aviso: Aviso) {
    if (!destinatarios.length) return;
    const texto = cuerpoCorreo(aviso, this.config.get('FRONTEND_URL', 'http://localhost:3000'));
    const envios = await Promise.allSettled(
      destinatarios.map((d) => this.correo.enviar({ para: d.correo, asunto: `SSM · ${aviso.titulo}`, texto })),
    );
    envios.forEach((envio, i) => {
      if (envio.status === 'rejected') this.logger.error(`No se pudo enviar el correo ${aviso.tipo} a ${destinatarios[i].correo}`, envio.reason as Error);
    });
    try {
      await this.repo.insert(
        destinatarios.map((d, i) => ({
          usuarioId: String(d.usuarioId),
          ...aviso,
          estado: envios[i].status === 'fulfilled' ? ('ENVIADA' as const) : ('FALLIDA' as const),
          enviadaEn: new Date(),
        })),
      );
    } catch (error) {
      // Un aviso fallido no debe revertir el cambio de estado del plan.
      this.logger.error(`No se pudo registrar el aviso ${aviso.tipo}`, error as Error);
    }
  }

  async listar(usuario: UsuarioToken): Promise<NotificacionListado[]> {
    const avisos = await this.repo.find({ where: { usuarioId: usuario.sub }, order: { id: 'DESC' }, take: 30 });
    return avisos.map((n) => ({
      id: n.id,
      tipo: esTipoAviso(n.tipo) ? TIPO_FRONT[n.tipo] : 'PLAN',
      titulo: n.titulo,
      descripcion: n.mensaje,
      fecha: fechaCorta(n.enviadaEn),
      leida: n.leidaEn !== null,
      enlace: esTipoAviso(n.tipo) ? ENLACE[n.tipo] : '/',
    }));
  }

  async marcarLeida(usuario: UsuarioToken, id: string) {
    const aviso = await this.repo.findOneBy({ id });
    if (!aviso) throw new NotFoundException('Notificación no encontrada.');
    if (aviso.usuarioId !== usuario.sub) throw new ForbiddenException('Esta notificación no es tuya.');
    if (!aviso.leidaEn) await this.repo.update(id, { leidaEn: new Date() });
    return { id, leida: true };
  }

  async marcarTodasLeidas(usuario: UsuarioToken) {
    const resultado = await this.repo.update(
      { usuarioId: usuario.sub, leidaEn: IsNull() },
      { leidaEn: new Date() },
    );
    return { actualizadas: resultado.affected ?? 0 };
  }
}

@ApiTags('Notificaciones')
@ApiBearerAuth()
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly servicio: NotificacionesService) {}

  @Get()
  listar(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.listar(usuario);
  }

  @Patch('leidas')
  marcarTodasLeidas(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.marcarTodasLeidas(usuario);
  }

  @Patch(':id/leida')
  marcarLeida(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.servicio.marcarLeida(usuario, id);
  }
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notificacion, AsignacionUsuario])],
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
