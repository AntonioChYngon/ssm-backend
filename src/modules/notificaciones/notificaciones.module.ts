// Avisos dentro de la aplicación (tabla notificacion). Los usa el flujo de validación del Plan de Mejora.
import { Controller, ForbiddenException, Get, Global, Injectable, Logger, Module, NotFoundException, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AsignacionUsuario, Notificacion } from '../../database/entities';

/** Tipos guardados en notificacion.tipo. */
export type TipoAviso = 'PLAN_ENVIADO' | 'PLAN_VALIDADO' | 'PLAN_DEVUELTO';

type Aviso = { tipo: TipoAviso; titulo: string; mensaje: string };

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

const TIPO_FRONT: Record<string, NotificacionListado['tipo']> = { PLAN_ENVIADO: 'PLAN', PLAN_VALIDADO: 'PLAN', PLAN_DEVUELTO: 'DEVOLUCION' };
const ENLACE: Record<string, string> = { PLAN_ENVIADO: '/admin/planes', PLAN_VALIDADO: '/licenciatura/dashboard', PLAN_DEVUELTO: '/licenciatura/plan' };

const fechaCorta = (fecha: Date | null) =>
  fecha ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(fecha) : '';

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @InjectRepository(Notificacion) private readonly repo: Repository<Notificacion>,
    @InjectRepository(AsignacionUsuario) private readonly asignaciones: Repository<AsignacionUsuario>,
  ) {}

  /** A todos los Administradores con cuenta activa. */
  async notificarAdministradores(aviso: Aviso) {
    const destinatarios = await this.asignaciones
      .createQueryBuilder('a')
      .innerJoin('a.usuario', 'u')
      .where('a.activa = TRUE AND u.activo = TRUE AND a.rolCodigo = :rol', { rol: Rol.ADMINISTRADOR })
      .select('a.usuarioId', 'usuarioId')
      .getRawMany<{ usuarioId: string }>();
    await this.crear(destinatarios.map((d) => String(d.usuarioId)), aviso);
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
      .getRawMany<{ usuarioId: string }>();
    await this.crear(destinatarios.map((d) => String(d.usuarioId)), aviso);
  }

  private async crear(usuarios: string[], aviso: Aviso) {
    if (!usuarios.length) return;
    try {
      await this.repo.insert(usuarios.map((usuarioId) => ({ usuarioId, ...aviso, estado: 'ENVIADA' as const, enviadaEn: new Date() })));
    } catch (error) {
      // Un aviso fallido no debe revertir el cambio de estado del plan.
      this.logger.error(`No se pudo registrar el aviso ${aviso.tipo}`, error as Error);
    }
  }

  async listar(usuario: UsuarioToken): Promise<NotificacionListado[]> {
    const avisos = await this.repo.find({ where: { usuarioId: usuario.sub }, order: { id: 'DESC' }, take: 30 });
    return avisos.map((n) => ({
      id: n.id,
      tipo: TIPO_FRONT[n.tipo] ?? 'PLAN',
      titulo: n.titulo,
      descripcion: n.mensaje,
      fecha: fechaCorta(n.enviadaEn),
      leida: n.leidaEn !== null,
      enlace: ENLACE[n.tipo] ?? '/',
    }));
  }

  async marcarLeida(usuario: UsuarioToken, id: string) {
    const aviso = await this.repo.findOneBy({ id });
    if (!aviso) throw new NotFoundException('Notificación no encontrada.');
    if (aviso.usuarioId !== usuario.sub) throw new ForbiddenException('Esta notificación no es tuya.');
    if (!aviso.leidaEn) await this.repo.update(id, { leidaEn: new Date() });
    return { id, leida: true };
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
