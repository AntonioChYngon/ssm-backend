// Bloque Informe · Lectura compartida: la usan HU-07 (captura), HU-08 (revisión) y HU-11 (avisos).
// Aquí viven los permisos de lectura y el armado del InformeDetalle; las líneas A y B solo escriben.
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UsuarioToken } from '../../common/auth';
import { EstadoVersion, Rol } from '../../common/enums';
import {
  AvanceRecomendacion,
  CicloAcreditacion,
  Evidencia,
  Indicador,
  Informe,
  OrganismoAcreditador,
  RevisionInforme,
  VersionInforme,
  VersionPlan,
} from '../../database/plan.entities';
import { ArchivoNoEncontrado, ProveedorCarpetas } from '../planes/carpetas';
import { cicloActivo, hoyEnMexico, MENSAJE_CICLO_FINALIZADO, validarId } from '../planes/reglas';
import type { AvanceDetalle, EvidenciaInforme, FiltrosInformesDto, InformeDetalle, InformeResumen, MiInforme, RevisionResumen } from './contrato';
import { bloqueoInforme, esperadoAlCorte, evidenciaObligatoria, periodoDelInforme } from './reglas';

const fechaCorta = (fecha: Date | null | undefined) =>
  fecha ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Mexico_City' }).format(fecha) : '—';

const iso = (fecha: Date | null | undefined) => (fecha ? fecha.toISOString() : null);

const nombreOrganismo = (o: OrganismoAcreditador) => o.siglas ?? o.nombre;

/** Ruta del API que entrega el PDF de una evidencia guardada en la carpeta local (pide sesión). */
export const rutaArchivoEvidencia = (id: string) => `/evidencias/${id}/archivo`;

@Injectable()
export class ConsultaInformesService {
  constructor(
    @InjectRepository(VersionInforme) private readonly versiones: Repository<VersionInforme>,
    @InjectRepository(Informe) private readonly informes: Repository<Informe>,
    @InjectRepository(CicloAcreditacion) private readonly ciclos: Repository<CicloAcreditacion>,
    @InjectRepository(VersionPlan) private readonly planes: Repository<VersionPlan>,
    @InjectRepository(Evidencia) private readonly evidencias: Repository<Evidencia>,
    private readonly dataSource: DataSource,
    private readonly carpetas: ProveedorCarpetas,
  ) {}

  // ----- Consultas públicas -----

  /** Administrador: todos los informes. Captura y Auxiliar: solo los de su licenciatura. */
  async listar(usuario: UsuarioToken, filtros: FiltrosInformesDto = {}): Promise<InformeResumen[]> {
    const q = this.consultaBase().where(
      'v.numeroVersion = (SELECT MAX(v2.numero_version) FROM version_informe v2 WHERE v2.informe_id = v.informe_id)',
    );
    if (usuario.rol !== Rol.ADMINISTRADOR) q.andWhere('c.licenciaturaId = :propia', { propia: usuario.licenciaturaId ?? '0' });
    if (filtros.licenciaturaId) q.andWhere('c.licenciaturaId = :lic', { lic: filtros.licenciaturaId });
    if (filtros.cicloId) q.andWhere('i.cicloId = :ciclo', { ciclo: filtros.cicloId });
    if (filtros.estado) q.andWhere('v.estado = :estado', { estado: filtros.estado });
    if (filtros.periodo) q.andWhere('i.nombrePeriodo = :periodo', { periodo: filtros.periodo });
    const versiones = await q.getMany();
    const totales = await this.totales(versiones.map((v) => v.id));
    return versiones
      .map((v) => this.resumen(v, totales.get(v.id)))
      .sort((a, b) => a.licenciatura.localeCompare(b.licenciatura, 'es') || b.periodo.localeCompare(a.periodo));
  }

  async obtener(usuario: UsuarioToken, id: string): Promise<InformeDetalle> {
    return this.detalle(await this.versionVisible(usuario, id));
  }

  /** Pantalla de la coordinación: ciclo vigente, semestre en curso, su informe (si ya se inició) y los anteriores. */
  async mio(usuario: UsuarioToken): Promise<MiInforme> {
    if (!usuario.licenciaturaId) throw new NotFoundException('Tu cuenta no tiene una licenciatura asignada.');
    const ciclo = await this.ciclos.findOne({
      where: { licenciaturaId: usuario.licenciaturaId, estado: 'VIGENTE' },
      relations: { licenciatura: true, organismo: true },
      order: { vigenciaInicio: 'DESC' },
    });
    if (!ciclo) throw new NotFoundException('Tu licenciatura no tiene un ciclo de acreditación vigente. Pide a la Administración que lo registre.');

    const hoy = hoyEnMexico();
    const activo = cicloActivo(ciclo, hoy);
    const periodo = periodoDelInforme(hoy, ciclo.vigenciaInicio, ciclo.vigenciaFin);
    const planAprobado = await this.planes.existsBy({ cicloId: ciclo.id, estado: EstadoVersion.APROBADO });

    const actual = periodo ? await this.informes.findOneBy({ cicloId: ciclo.id, fechaInicio: periodo.inicio }) : null;
    const version = actual ? await this.ultimaVersion(actual.id) : null;
    const anteriores = (await this.listar(usuario, { cicloId: ciclo.id })).filter((r) => r.informeId !== actual?.id);

    return {
      ciclo: {
        id: ciclo.id,
        nombre: ciclo.nombre,
        licenciatura: ciclo.licenciatura.nombre,
        organismo: nombreOrganismo(ciclo.organismo),
        vigenciaInicio: ciclo.vigenciaInicio,
        vigenciaFin: ciclo.vigenciaFin,
        activo,
        mensaje: activo ? null : MENSAJE_CICLO_FINALIZADO,
      },
      periodo: periodo ? { nombre: periodo.nombre, fechaInicio: periodo.inicio, fechaFin: periodo.fin, fechaCorte: periodo.fechaCorte } : null,
      planAprobado,
      informe: version ? await this.detalle(version) : null,
      anteriores,
    };
  }

  /** PDF de una evidencia guardada en la carpeta del ciclo (proveedor local). Revisa la licenciatura. */
  async archivoEvidencia(usuario: UsuarioToken, evidenciaId: string) {
    validarId(evidenciaId, 'la evidencia');
    const evidencia = await this.evidencias.findOne({
      where: { id: evidenciaId },
      relations: { avance: { versionInforme: { informe: { ciclo: true } } } },
    });
    if (!evidencia || !this.puedeVer(usuario, evidencia.avance.versionInforme.informe.ciclo.licenciaturaId)) {
      throw new NotFoundException('Evidencia no encontrada.');
    }
    if (evidencia.origen !== 'ARCHIVO') throw new NotFoundException('Esta evidencia es un enlace externo; ábrela desde su enlace.');
    try {
      const { contenido, tamano } = await this.carpetas.abrir(evidencia.ubicacion);
      return { contenido, tamano, nombre: evidencia.nombreOriginal.replace(/\.[^.]+$/, '') + '.pdf' };
    } catch (error) {
      if (error instanceof ArchivoNoEncontrado) throw new NotFoundException('El archivo de esta evidencia ya no está disponible en la carpeta.');
      throw error;
    }
  }

  // ----- Ayudantes para las líneas A (HU-07) y B (HU-08/HU-11) -----

  /** Versión con informe, ciclo, licenciatura y organismo. 404 si no existe o es de otra licenciatura (no se revela que exista). */
  async versionVisible(usuario: UsuarioToken, id: string): Promise<VersionInforme> {
    validarId(id, 'el informe');
    const version = await this.versiones.findOne({
      where: { id },
      relations: { informe: { ciclo: { licenciatura: true, organismo: true } } },
    });
    if (!version || !this.puedeVer(usuario, version.informe.ciclo.licenciaturaId)) throw new NotFoundException('Informe no encontrado.');
    return version;
  }

  /** InformeDetalle completo: recomendaciones del plan aprobado, avances, evidencias y revisiones. */
  async detalle(version: VersionInforme): Promise<InformeDetalle> {
    const { informe } = version;
    const ciclo = informe.ciclo;
    const [indicadores, avances, revisiones, totales] = await Promise.all([
      this.dataSource.getRepository(Indicador).find({
        where: { versionPlanId: version.versionPlanId },
        relations: { categoria: true, recomendaciones: { metas: true } },
        order: { orden: 'ASC', recomendaciones: { orden: 'ASC', metas: { orden: 'ASC' } } },
      }),
      this.dataSource.getRepository(AvanceRecomendacion).find({
        where: { versionInformeId: version.id },
        relations: { evidencias: { usuario: true } },
        order: { evidencias: { id: 'ASC' } },
      }),
      this.dataSource.getRepository(RevisionInforme).find({
        where: { versionInformeId: version.id },
        relations: { revisor: true, observaciones: true },
        order: { id: 'ASC' },
      }),
      this.totales([version.id]),
    ]);

    const avanceDe = new Map(avances.map((a) => [a.recomendacionId, a]));
    const ultima = revisiones.at(-1) ?? null;
    // Las observaciones por recomendación solo aplican mientras el informe sigue devuelto (o reabierto).
    const observacionDe = new Map<string, string>();
    if (ultima?.decision === 'DEVUELTO') {
      ultima.observaciones.filter((o) => o.recomendacionId).forEach((o) => observacionDe.set(o.recomendacionId as string, o.comentario));
    }

    let numero = 0;
    const filas: AvanceDetalle[] = indicadores.flatMap((ind) =>
      ind.recomendaciones.map((r) => {
        const avance = avanceDe.get(r.id) ?? null;
        const porcentaje = avance ? avance.porcentaje : null;
        const metas = r.metas.map((m) => ({ descripcion: m.descripcion, fechaCompromiso: m.fechaCompromiso, porcentajeEsperado: m.porcentajeEsperado }));
        return {
          recomendacionId: r.id,
          numero: ++numero,
          categoria: ind.categoria.nombre,
          indicador: ind.descripcion,
          recomendacion: r.descripcion,
          fechaCumplimiento: r.fechaCumplimiento,
          metas,
          esperadoAlCorte: esperadoAlCorte(metas, informe.fechaCorte),
          porcentaje,
          observaciones: avance?.observaciones ?? null,
          evidenciaObligatoria: evidenciaObligatoria(porcentaje),
          observacionRevision: observacionDe.get(r.id) ?? null,
          evidencias: (avance?.evidencias ?? []).map((e) => this.evidencia(e)),
        };
      }),
    );

    const bloqueo = bloqueoInforme(version.estado, cicloActivo(ciclo, hoyEnMexico()));
    return {
      ...this.resumen(version, totales.get(version.id)),
      organismo: nombreOrganismo(ciclo.organismo),
      vigenciaInicio: ciclo.vigenciaInicio,
      vigenciaFin: ciclo.vigenciaFin,
      editable: bloqueo === null,
      bloqueo,
      avances: filas,
      ultimaRevision: ultima ? this.revision(ultima) : null,
      revisiones: revisiones.map((r) => this.revision(r)),
    };
  }

  // ----- Privados -----

  private puedeVer(usuario: UsuarioToken, licenciaturaId: string) {
    return usuario.rol === Rol.ADMINISTRADOR || usuario.licenciaturaId === licenciaturaId;
  }

  private consultaBase() {
    return this.versiones
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.informe', 'i')
      .innerJoinAndSelect('i.ciclo', 'c')
      .innerJoinAndSelect('c.licenciatura', 'l')
      .innerJoinAndSelect('c.organismo', 'o');
  }

  private ultimaVersion(informeId: string) {
    return this.versiones.findOne({
      where: { informeId },
      order: { numeroVersion: 'DESC' },
      relations: { informe: { ciclo: { licenciatura: true, organismo: true } } },
    });
  }

  /** Recomendaciones del plan, recomendaciones con avance y evidencias de cada versión. */
  private async totales(ids: string[]) {
    const mapa = new Map<string, { recomendaciones: number; conAvance: number; evidencias: number }>();
    if (!ids.length) return mapa;
    const filas: Array<{ id: string; recomendaciones: string | number; con_avance: string | number; evidencias: string | number }> = await this.dataSource.query(
      `SELECT vi.version_informe_id AS id,
              (SELECT COUNT(*) FROM recomendacion r JOIN indicador ind ON ind.indicador_id = r.indicador_id
                WHERE ind.version_plan_id = vi.version_plan_id) AS recomendaciones,
              (SELECT COUNT(*) FROM avance_recomendacion a WHERE a.version_informe_id = vi.version_informe_id) AS con_avance,
              (SELECT COUNT(*) FROM evidencia e JOIN avance_recomendacion a ON a.avance_id = e.avance_id
                WHERE a.version_informe_id = vi.version_informe_id) AS evidencias
       FROM version_informe vi
       WHERE vi.version_informe_id IN (?)`,
      [ids],
    );
    filas.forEach((f) =>
      mapa.set(String(f.id), { recomendaciones: Number(f.recomendaciones), conAvance: Number(f.con_avance), evidencias: Number(f.evidencias) }),
    );
    return mapa;
  }

  private resumen(v: VersionInforme, t?: { recomendaciones: number; conAvance: number; evidencias: number }): InformeResumen {
    const { informe } = v;
    return {
      id: v.id,
      informeId: informe.id,
      cicloId: informe.cicloId,
      licenciaturaId: informe.ciclo.licenciaturaId,
      licenciatura: informe.ciclo.licenciatura.nombre,
      ciclo: informe.ciclo.nombre,
      periodo: informe.nombrePeriodo,
      fechaInicio: informe.fechaInicio,
      fechaFin: informe.fechaFin,
      fechaCorte: informe.fechaCorte,
      estado: v.estado,
      enviadoEn: iso(v.enviadoEn),
      aprobadoEn: iso(v.aprobadoEn),
      recomendaciones: t?.recomendaciones ?? 0,
      conAvance: t?.conAvance ?? 0,
      evidencias: t?.evidencias ?? 0,
    };
  }

  private evidencia(e: Evidencia): EvidenciaInforme {
    const externo = e.origen === 'URL' || Boolean(e.urlVista);
    return {
      id: e.id,
      origen: e.origen,
      nombre: e.nombreOriginal,
      tamano: e.tamanoBytes === null ? null : Number(e.tamanoBytes),
      enlace: e.origen === 'URL' ? e.ubicacion : (e.urlVista ?? rutaArchivoEvidencia(e.id)),
      externo,
      cargadaPor: e.usuario ? `${e.usuario.nombre} ${e.usuario.apellido}` : '—',
      cargadaEn: iso(e.cargadaEn) ?? '',
    };
  }

  private revision(r: RevisionInforme): RevisionResumen {
    return {
      id: r.id,
      decision: r.decision,
      comentario: r.comentarioGeneral,
      revisor: `${r.revisor.nombre} ${r.revisor.apellido}`,
      fecha: fechaCorta(r.revisadoEn),
      observaciones: (r.observaciones ?? []).map((o) => ({ recomendacionId: o.recomendacionId, comentario: o.comentario })),
    };
  }
}
