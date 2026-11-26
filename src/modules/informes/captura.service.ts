// HU-07 · Captura del informe por la coordinación (Captura y Auxiliar): iniciar el semestre, % y observaciones,
// evidencias como enlace (Plan B), quitar evidencias y enviar a revisión (que avisa al Administrador, HU-11).
// La subida de archivos está en evidencias.service.ts. Todo se bloquea con el informe en revisión o aprobado, o con el ciclo cerrado (HU-18).
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { UsuarioToken } from '../../common/auth';
import { EstadoVersion } from '../../common/enums';
import { AvanceRecomendacion, CicloAcreditacion, Evidencia, Informe, VersionInforme, VersionPlan } from '../../database/plan.entities';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { hoyEnMexico, validarId, verificarCicloAbierto } from '../planes/reglas';
import { ConsultaInformesService } from './consulta.service';
import type { AvanceDto, EnlaceDto, InformeDetalle } from './contrato';
import { periodoDelInforme, validarEnvioInforme, validarPorcentaje, validarUrlEvidencia, verificarTransicionInforme } from './reglas';
import { esConflictoDeBloqueo, MENSAJE_INFORME_CAMBIO, RevisionInformesService } from './revision.service';

/** Contexto de una edición: la versión (con informe y ciclo) y el número de la recomendación en el informe. */
export type ContextoEdicion = { version: VersionInforme; recomendacionId: string; numero: number };

const esDuplicado = (error: unknown) => error instanceof QueryFailedError && /Duplicate entry|ER_DUP_ENTRY/i.test(String((error as { message?: string }).message));

@Injectable()
export class CapturaInformesService {
  constructor(
    @InjectRepository(CicloAcreditacion) private readonly ciclos: Repository<CicloAcreditacion>,
    @InjectRepository(VersionPlan) private readonly planes: Repository<VersionPlan>,
    @InjectRepository(Informe) private readonly informes: Repository<Informe>,
    @InjectRepository(Evidencia) private readonly evidencias: Repository<Evidencia>,
    private readonly consulta: ConsultaInformesService,
    private readonly revision: RevisionInformesService,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** "Iniciar informe del semestre": crea el informe del semestre en curso; si ya existe, lo devuelve. */
  async iniciar(usuario: UsuarioToken, cicloId: string): Promise<InformeDetalle> {
    validarId(cicloId, 'el ciclo');
    const ciclo = await this.ciclos.findOneBy({ id: cicloId });
    if (!ciclo || ciclo.licenciaturaId !== usuario.licenciaturaId) throw new NotFoundException('Ciclo de acreditación no encontrado.');
    const hoy = hoyEnMexico();
    verificarCicloAbierto(ciclo, hoy);
    const periodo = periodoDelInforme(hoy, ciclo.vigenciaInicio, ciclo.vigenciaFin);
    if (!periodo) throw new ConflictException('Hoy está fuera de la vigencia del ciclo; no hay semestre que reportar.');
    const plan = await this.planes.findOne({ where: { cicloId, estado: EstadoVersion.APROBADO }, order: { numeroVersion: 'DESC' } });
    if (!plan) throw new ConflictException('Tu plan de mejora aún no está aprobado. El informe se inicia cuando la Administración lo valide.');

    const existente = await this.informes.findOneBy({ cicloId, fechaInicio: periodo.inicio });
    if (existente) return this.detalleDeInforme(usuario, existente.id);
    let versionId: string;
    try {
      versionId = await this.dataSource.transaction(async (tx) => {
        const informe = await tx.save(
          tx.create(Informe, { cicloId, nombrePeriodo: periodo.nombre, fechaInicio: periodo.inicio, fechaFin: periodo.fin, fechaCorte: periodo.fechaCorte }),
        );
        const version = await tx.save(
          tx.create(VersionInforme, { informeId: informe.id, versionPlanId: plan.id, numeroVersion: 1, estado: EstadoVersion.BORRADOR, creadoPor: usuario.sub, enviadoEn: null, aprobadoEn: null }),
        );
        return version.id;
      });
    } catch (error) {
      // Dos personas lo iniciaron al mismo tiempo: gana la primera y la otra recibe el mismo informe.
      const otro = esDuplicado(error) ? await this.informes.findOneBy({ cicloId, fechaInicio: periodo.inicio }) : null;
      if (otro) return this.detalleDeInforme(usuario, otro.id);
      throw error;
    }
    await this.auditoria.registrar(usuario, { entidad: 'version_informe', entidadId: versionId, campo: 'estado', anterior: null, nuevo: EstadoVersion.BORRADOR });
    return this.consulta.obtener(usuario, versionId);
  }

  /** Guarda el % (entero de 0 a 100) y las observaciones de una recomendación. */
  async guardarAvance(usuario: UsuarioToken, id: string, recomendacionId: string, dto: AvanceDto): Promise<InformeDetalle> {
    const ctx = await this.contexto(usuario, id, recomendacionId);
    const porcentaje = validarPorcentaje(dto.porcentaje);
    const observaciones = dto.observaciones?.trim() || null;
    const anterior = await this.editarConBloqueo(ctx.version, async (tx) => {
      const actual = await tx.findOneBy(AvanceRecomendacion, { versionInformeId: ctx.version.id, recomendacionId });
      if (actual) {
        // actualizado_en no es editable desde la entidad (update: false): se actualiza con la hora de la base.
        await tx.query(
          'UPDATE avance_recomendacion SET porcentaje = ?, observaciones = ?, actualizado_por = ?, actualizado_en = CURRENT_TIMESTAMP WHERE avance_id = ?',
          [porcentaje, observaciones, usuario.sub, actual.id],
        );
      } else {
        await tx.insert(AvanceRecomendacion, { versionInformeId: ctx.version.id, recomendacionId, porcentaje, observaciones, actualizadoPor: usuario.sub });
      }
      return actual;
    });
    await this.auditoria.registrarCambios(usuario, {
      entidad: 'avance_recomendacion',
      entidadId: recomendacionId,
      antes: { porcentaje: anterior?.porcentaje ?? null, observaciones: anterior?.observaciones ?? null },
      despues: { porcentaje, observaciones },
      sufijo: `Informe ${ctx.version.informe.nombrePeriodo}`,
    });
    return this.consulta.obtener(usuario, id);
  }

  /** Plan B de HU-07: evidencia como enlace http(s). */
  async agregarEnlace(usuario: UsuarioToken, id: string, recomendacionId: string, dto: EnlaceDto): Promise<InformeDetalle> {
    const ctx = await this.contexto(usuario, id, recomendacionId);
    const url = validarUrlEvidencia(dto.url);
    const nombre = (dto.nombre?.trim() || new URL(url).hostname).slice(0, 255);
    await this.editarConBloqueo(ctx.version, async (tx) => {
      const avance = await this.avanceRequerido(tx, ctx);
      await tx.insert(Evidencia, { avanceId: avance.id, origen: 'URL', nombreOriginal: nombre, nombreGuardado: null, ubicacion: url, urlVista: null, tipoMime: 'application/pdf', tamanoBytes: null, checksumSha256: null, cargadaPor: usuario.sub });
    });
    await this.registrarEvidencia(usuario, ctx, 'agregada', `${nombre} (${url})`);
    return this.consulta.obtener(usuario, id);
  }

  /** Quita una evidencia mientras el informe es editable. El archivo se conserva en la carpeta del ciclo (HU-18). */
  async quitarEvidencia(usuario: UsuarioToken, evidenciaId: string): Promise<InformeDetalle> {
    validarId(evidenciaId, 'la evidencia');
    const evidencia = await this.evidencias.findOne({ where: { id: evidenciaId }, relations: { avance: true } });
    if (!evidencia) throw new NotFoundException('Evidencia no encontrada.');
    const ctx = await this.contexto(usuario, evidencia.avance.versionInformeId, evidencia.avance.recomendacionId);
    await this.editarConBloqueo(ctx.version, (tx) => tx.delete(Evidencia, { id: evidenciaId }));
    await this.registrarEvidencia(usuario, ctx, 'quitada', evidencia.nombreOriginal);
    return this.consulta.obtener(usuario, ctx.version.id);
  }

  /** Enviar a revisión: todas las recomendaciones con % y evidencia en las que están al 100 %; avisa al Administrador (HU-11). */
  async enviar(usuario: UsuarioToken, id: string): Promise<InformeDetalle> {
    const version = await this.consulta.versionVisible(usuario, id);
    verificarTransicionInforme(version.estado, 'enviar');
    verificarCicloAbierto(version.informe.ciclo, hoyEnMexico());
    const detalle = await this.consulta.detalle(version);
    validarEnvioInforme(detalle.avances.map((a) => ({ numero: a.numero, porcentaje: a.porcentaje, evidencias: a.evidencias.length })));
    const r = await this.dataSource.getRepository(VersionInforme).update(
      { id: version.id, estado: version.estado },
      { estado: EstadoVersion.EN_REVISION, enviadoEn: new Date() },
    );
    if (!r.affected) throw new ConflictException(MENSAJE_INFORME_CAMBIO);
    await this.auditoria.registrar(usuario, { entidad: 'version_informe', entidadId: version.id, campo: 'estado', anterior: version.estado, nuevo: EstadoVersion.EN_REVISION });
    await this.revision.avisarEnvio(version);
    return this.consulta.obtener(usuario, id);
  }

  // ----- Compartido con evidencias.service.ts -----

  /** Versión visible y editable (estado y ciclo) y, si se pide, la recomendación del plan con su número. */
  async contexto(usuario: UsuarioToken, id: string, recomendacionId: string): Promise<ContextoEdicion> {
    const version = await this.consulta.versionVisible(usuario, id);
    verificarTransicionInforme(version.estado, 'editar');
    verificarCicloAbierto(version.informe.ciclo, hoyEnMexico());
    validarId(recomendacionId, 'la recomendación');
    const numero = await this.numeroDeRecomendacion(version.versionPlanId, recomendacionId);
    return { version, recomendacionId, numero };
  }

  /** Escribe dentro de una transacción que bloquea la versión y confirma que el estado no cambió mientras tanto. */
  async editarConBloqueo<T>(version: VersionInforme, escribir: (tx: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (tx) => {
        const actual = await tx.findOne(VersionInforme, { where: { id: version.id }, lock: { mode: 'pessimistic_write' } });
        if (!actual || actual.estado !== version.estado) throw new ConflictException(MENSAJE_INFORME_CAMBIO);
        return escribir(tx);
      });
    } catch (error) {
      if (esConflictoDeBloqueo(error)) throw new ConflictException(MENSAJE_INFORME_CAMBIO);
      throw error;
    }
  }

  /** La evidencia cuelga del avance: primero se captura el %. */
  async avanceRequerido(tx: EntityManager, ctx: ContextoEdicion) {
    const avance = await tx.findOneBy(AvanceRecomendacion, { versionInformeId: ctx.version.id, recomendacionId: ctx.recomendacionId });
    if (!avance) throw new BadRequestException(`Captura primero el % de avance de la recomendación ${ctx.numero} y después agrega su evidencia.`);
    return avance;
  }

  async registrarEvidencia(usuario: UsuarioToken, ctx: ContextoEdicion, accion: 'agregada' | 'quitada', descripcion: string) {
    await this.auditoria.registrar(usuario, {
      entidad: 'avance_recomendacion',
      entidadId: ctx.recomendacionId,
      campo: `evidencia ${accion} · Informe ${ctx.version.informe.nombrePeriodo}`,
      anterior: accion === 'quitada' ? descripcion.slice(0, 500) : null,
      nuevo: accion === 'agregada' ? descripcion.slice(0, 500) : null,
    });
  }

  // ----- Privados -----

  /** Número de la recomendación en el informe (orden del plan aprobado). 404 si no es de ese plan. */
  private async numeroDeRecomendacion(versionPlanId: string, recomendacionId: string) {
    const filas: Array<{ id: string | number }> = await this.dataSource.query(
      `SELECT r.recomendacion_id AS id FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id
       WHERE i.version_plan_id = ? ORDER BY i.orden, r.orden`,
      [versionPlanId],
    );
    const indice = filas.findIndex((f) => String(f.id) === recomendacionId);
    if (indice < 0) throw new NotFoundException('La recomendación no pertenece al plan de este informe.');
    return indice + 1;
  }

  private async detalleDeInforme(usuario: UsuarioToken, informeId: string) {
    const version = await this.dataSource.getRepository(VersionInforme).findOne({ where: { informeId }, order: { numeroVersion: 'DESC' } });
    if (!version) throw new NotFoundException('Informe no encontrado.');
    return this.consulta.obtener(usuario, version.id);
  }
}
