// HU-08 · Revisión del informe por el Administrador (validar, devolver, reabrir) y HU-11 · aviso de entrega.
// Ninguna acción del Administrador depende del ciclo (decisión del 25/11/2026): la coordinación sí queda bloqueada por HU-18.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UsuarioToken } from '../../common/auth';
import { EstadoVersion } from '../../common/enums';
import { ObservacionInforme, RevisionInforme, VersionInforme } from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { NotificacionesService } from '../notificaciones/notificaciones.module';
import { ConsultaInformesService } from './consulta.service';
import type { DevolverInformeDto, InformeDetalle, ObservacionInformeDto, ReabrirInformeDto, ValidarInformeDto } from './contrato';
import { mensajeObservacionesInforme, verificarTransicionInforme } from './reglas';

export const MENSAJE_INFORME_CAMBIO = 'El informe cambió de estado mientras tanto. Recarga la página.';

@Injectable()
export class RevisionInformesService {
  constructor(
    private readonly consulta: ConsultaInformesService,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /** Validar: el informe queda APROBADO y la coordinación ya no puede modificarlo. */
  async validar(admin: UsuarioToken, id: string, dto: ValidarInformeDto): Promise<InformeDetalle> {
    const version = await this.consulta.versionVisible(admin, id);
    verificarTransicionInforme(version.estado, 'validar');
    const comentario = dto.comentario?.trim() || null;
    await this.dataSource.transaction(async (tx) => {
      await tx.insert(RevisionInforme, { versionInformeId: version.id, revisorId: admin.sub, decision: 'APROBADO', comentarioGeneral: comentario });
      await this.cambiarEstado(tx, version, EstadoVersion.APROBADO, { aprobadoEn: new Date() });
    });
    await this.auditoria.registrar(admin, { entidad: 'version_informe', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.APROBADO });
    await this.notificaciones.notificarLicenciatura(version.informe.ciclo.licenciaturaId, {
      tipo: 'INFORME_VALIDADO',
      titulo: 'Informe de seguimiento validado',
      mensaje: `La Administración validó tu informe de seguimiento ${version.informe.nombrePeriodo}.${comentario ? ` Comentario: ${comentario}` : ''}`,
    });
    return this.consulta.obtener(admin, id);
  }

  /** Devolver: motivo general y observaciones por recomendación; la coordinación corrige sobre la misma versión. */
  async devolver(admin: UsuarioToken, id: string, dto: DevolverInformeDto): Promise<InformeDetalle> {
    const version = await this.consulta.versionVisible(admin, id);
    verificarTransicionInforme(version.estado, 'devolver');
    const { observaciones, recomendaciones } = await this.observacionesDelInforme(version, dto.observaciones);
    await this.dataSource.transaction(async (tx) => {
      await this.guardarRevision(tx, admin, version, dto.motivo.trim(), observaciones);
      await this.cambiarEstado(tx, version, EstadoVersion.DEVUELTO, {});
    });
    await this.auditoria.registrar(admin, { entidad: 'version_informe', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.DEVUELTO });
    await this.notificaciones.notificarLicenciatura(version.informe.ciclo.licenciaturaId, {
      tipo: 'INFORME_DEVUELTO',
      titulo: 'Informe de seguimiento devuelto',
      mensaje: mensajeObservacionesInforme(
        `La Administración devolvió tu informe de seguimiento ${version.informe.nombrePeriodo}. Motivo: ${dto.motivo.trim()}`,
        observaciones,
        recomendaciones,
      ),
    });
    return this.consulta.obtener(admin, id);
  }

  /** Reabrir un informe aprobado (devolución formal, HU-08): motivo obligatorio; se borra la fecha de aprobación. */
  async reabrir(admin: UsuarioToken, id: string, dto: ReabrirInformeDto): Promise<InformeDetalle> {
    const version = await this.consulta.versionVisible(admin, id);
    verificarTransicionInforme(version.estado, 'reabrir');
    const { observaciones, recomendaciones } = await this.observacionesDelInforme(version, dto.observaciones);
    const motivo = dto.motivo.trim();
    await this.dataSource.transaction(async (tx) => {
      // La reapertura se guarda como DEVUELTO (el CHECK solo admite APROBADO/DEVUELTO); el prefijo la distingue en el historial.
      await this.guardarRevision(tx, admin, version, `Reapertura: ${motivo}`, observaciones);
      await this.cambiarEstado(tx, version, EstadoVersion.DEVUELTO, { aprobadoEn: null });
    });
    await this.auditoria.registrar(admin, { entidad: 'version_informe', entidadId: version.id, campo: 'reabierto', anterior: EstadoVersion.APROBADO, nuevo: EstadoVersion.DEVUELTO });
    await this.notificaciones.notificarLicenciatura(version.informe.ciclo.licenciaturaId, {
      tipo: 'INFORME_REABIERTO',
      titulo: 'Informe de seguimiento reabierto',
      mensaje: mensajeObservacionesInforme(
        `La Administración reabrió tu informe de seguimiento ${version.informe.nombrePeriodo}, que estaba aprobado. Motivo: ${motivo}`,
        observaciones,
        recomendaciones,
      ),
    });
    return this.consulta.obtener(admin, id);
  }

  /** HU-11 · Aviso a todos los Administradores activos cuando la coordinación envía el informe (correo + campana). */
  async avisarEnvio(version: VersionInforme) {
    await this.notificaciones.notificarAdministradores({
      tipo: 'INFORME_ENVIADO',
      titulo: 'Informe de seguimiento por revisar',
      mensaje: `${version.informe.ciclo.licenciatura.nombre} envió su informe de seguimiento ${version.informe.nombrePeriodo} a revisión.`,
    });
  }

  // ----- Ayudantes -----

  /** Cambia el estado solo si nadie lo cambió antes (dos Administradores, o la coordinación editando). */
  private async cambiarEstado(tx: EntityManager, version: VersionInforme, estado: EstadoVersion, extra: Partial<VersionInforme>) {
    const r = await tx.getRepository(VersionInforme).update({ id: version.id, estado: version.estado }, { estado, ...extra });
    if (!r.affected) throw new ConflictException(MENSAJE_INFORME_CAMBIO);
  }

  private async guardarRevision(tx: EntityManager, admin: UsuarioToken, version: VersionInforme, comentario: string, observaciones: ObservacionInformeDto[]) {
    const revision = await tx.save(tx.create(RevisionInforme, { versionInformeId: version.id, revisorId: admin.sub, decision: 'DEVUELTO', comentarioGeneral: comentario }));
    if (observaciones.length) {
      await tx.insert(
        ObservacionInforme,
        observaciones.map((o) => ({ revisionInformeId: revision.id, recomendacionId: o.recomendacionId, comentario: o.comentario.trim() })),
      );
    }
  }

  /** Observaciones no vacías y de recomendaciones de este informe (404 si alguna es de otro). */
  private async observacionesDelInforme(version: VersionInforme, dto: ObservacionInformeDto[] | undefined) {
    const observaciones = (dto ?? []).filter((o) => o.comentario.trim());
    const recomendaciones = (await this.consulta.detalle(version)).avances.map((a) => ({ recomendacionId: a.recomendacionId, numero: a.numero }));
    const propias = new Set(recomendaciones.map((r) => r.recomendacionId));
    if (observaciones.some((o) => !propias.has(o.recomendacionId))) {
      throw new NotFoundException('Una observación apunta a una recomendación que no es de este informe.');
    }
    return { observaciones, recomendaciones };
  }
}
