// Entidades del Plan de Mejora y del Informe de Seguimiento (db/ssm_mariadb.sql).
// Son compartidas: HU-04 escribe en ellas y HU-15 las consulta. Si necesitas una columna nueva,
// cámbiala primero en db/ssm_mariadb.sql y avisa al equipo en el PR.
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { EstadoVersion } from '../common/enums';
import { Licenciatura, Usuario } from './entities';

/** DECIMAL llega como texto desde MariaDB; lo convertimos a número. */
const decimal = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('organismo_acreditador')
export class OrganismoAcreditador {
  @PrimaryGeneratedColumn({ name: 'organismo_id', type: 'bigint' })
  id: string;

  @Column({ length: 200 })
  nombre: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  siglas: string | null;

  @Column({ type: 'boolean' })
  activo: boolean;
}

@Entity('area_responsable')
export class AreaResponsable {
  @PrimaryGeneratedColumn({ name: 'area_id', type: 'bigint' })
  id: string;

  @Column({ length: 200 })
  nombre: string;

  @Column({ type: 'boolean' })
  activa: boolean;
}

/** Catálogo cerrado de 10 categorías (HU-04). Se carga con el script SQL. */
@Entity('categoria')
export class Categoria {
  @PrimaryGeneratedColumn({ name: 'categoria_id', type: 'bigint' })
  id: string;

  @Column({ length: 160 })
  nombre: string;

  @Column({ type: 'smallint' })
  orden: number;

  @Column({ type: 'boolean' })
  activa: boolean;
}

@Entity('ciclo_acreditacion')
export class CicloAcreditacion {
  @PrimaryGeneratedColumn({ name: 'ciclo_id', type: 'bigint' })
  id: string;

  @Column({ name: 'licenciatura_id', type: 'bigint' })
  licenciaturaId: string;

  @ManyToOne(() => Licenciatura)
  @JoinColumn({ name: 'licenciatura_id' })
  licenciatura: Licenciatura;

  @Column({ name: 'organismo_id', type: 'bigint' })
  organismoId: string;

  @ManyToOne(() => OrganismoAcreditador)
  @JoinColumn({ name: 'organismo_id' })
  organismo: OrganismoAcreditador;

  /** Fechas DATE como texto YYYY-MM-DD (dateStrings). */
  @Column({ name: 'fecha_emision', type: 'date' })
  fechaEmision: string;

  @Column({ name: 'vigencia_inicio', type: 'date' })
  vigenciaInicio: string;

  @Column({ name: 'vigencia_fin', type: 'date' })
  vigenciaFin: string;

  @Column({ type: 'varchar', length: 20 })
  estado: 'VIGENTE' | 'CERRADO' | 'HISTORICO';

  @Column({ name: 'referencia_constancia', type: 'varchar', length: 255, nullable: true })
  referenciaConstancia: string | null;
}

@Entity('version_plan')
export class VersionPlan {
  @PrimaryGeneratedColumn({ name: 'version_plan_id', type: 'bigint' })
  id: string;

  @Column({ name: 'ciclo_id', type: 'bigint' })
  cicloId: string;

  @ManyToOne(() => CicloAcreditacion)
  @JoinColumn({ name: 'ciclo_id' })
  ciclo: CicloAcreditacion;

  @Column({ name: 'numero_version', type: 'int' })
  numeroVersion: number;

  @Column({ type: 'varchar', length: 20 })
  estado: EstadoVersion;

  @Column({ name: 'creado_por', type: 'bigint' })
  creadoPor: string;

  @Column({ name: 'creado_en', type: 'datetime', insert: false, update: false })
  creadoEn: Date;

  @Column({ name: 'enviado_en', type: 'datetime', nullable: true })
  enviadoEn: Date | null;

  @Column({ name: 'aprobado_en', type: 'datetime', nullable: true })
  aprobadoEn: Date | null;

  @OneToMany(() => Indicador, (i) => i.versionPlan)
  indicadores: Indicador[];
}

@Entity('indicador')
export class Indicador {
  @PrimaryGeneratedColumn({ name: 'indicador_id', type: 'bigint' })
  id: string;

  @Column({ name: 'version_plan_id', type: 'bigint' })
  versionPlanId: string;

  @ManyToOne(() => VersionPlan, (v) => v.indicadores)
  @JoinColumn({ name: 'version_plan_id' })
  versionPlan: VersionPlan;

  @Column({ name: 'categoria_id', type: 'bigint' })
  categoriaId: string;

  @ManyToOne(() => Categoria)
  @JoinColumn({ name: 'categoria_id' })
  categoria: Categoria;

  @Column({ type: 'varchar', length: 60, nullable: true })
  clave: string | null;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'int' })
  orden: number;

  @OneToMany(() => Recomendacion, (r) => r.indicador)
  recomendaciones: Recomendacion[];
}

@Entity('recomendacion')
export class Recomendacion {
  @PrimaryGeneratedColumn({ name: 'recomendacion_id', type: 'bigint' })
  id: string;

  @Column({ name: 'indicador_id', type: 'bigint' })
  indicadorId: string;

  @ManyToOne(() => Indicador, (i) => i.recomendaciones)
  @JoinColumn({ name: 'indicador_id' })
  indicador: Indicador;

  @Column({ type: 'text' })
  descripcion: string;

  /** "Área responsable": texto abierto. */
  @Column({ name: 'area_responsable', type: 'varchar', length: 250, nullable: true })
  areaResponsable: string | null;

  /** Opcional en BORRADOR; obligatoria para enviar a validación. */
  @Column({ name: 'fecha_cumplimiento', type: 'date', nullable: true })
  fechaCumplimiento: string | null;

  /** Ej. "Semestre 2026-1". La fecha real sirve para alertas. */
  @Column({ name: 'etiqueta_fecha', type: 'varchar', length: 80, nullable: true })
  etiquetaFecha: string | null;

  @Column({ type: 'int' })
  orden: number;

  @Column({ type: 'boolean' })
  transversal: boolean;

  @OneToMany(() => AccionRecomendacion, (a) => a.recomendacion)
  acciones: AccionRecomendacion[];

  @OneToMany(() => Meta, (m) => m.recomendacion)
  metas: Meta[];

  /** Catálogo de áreas (legado). La captura usa areaResponsable. */
  @ManyToMany(() => AreaResponsable)
  @JoinTable({
    name: 'recomendacion_area',
    joinColumn: { name: 'recomendacion_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'area_id', referencedColumnName: 'id' },
  })
  areas: AreaResponsable[];
}

@Entity('accion_recomendacion')
export class AccionRecomendacion {
  @PrimaryGeneratedColumn({ name: 'accion_id', type: 'bigint' })
  id: string;

  @Column({ name: 'recomendacion_id', type: 'bigint' })
  recomendacionId: string;

  @ManyToOne(() => Recomendacion, (r) => r.acciones)
  @JoinColumn({ name: 'recomendacion_id' })
  recomendacion: Recomendacion;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'int' })
  orden: number;
}

@Entity('meta')
export class Meta {
  @PrimaryGeneratedColumn({ name: 'meta_id', type: 'bigint' })
  id: string;

  @Column({ name: 'recomendacion_id', type: 'bigint' })
  recomendacionId: string;

  @ManyToOne(() => Recomendacion, (r) => r.metas)
  @JoinColumn({ name: 'recomendacion_id' })
  recomendacion: Recomendacion;

  @Column({ type: 'text' })
  descripcion: string;

  /** Configuración de Metas: fecha compromiso (YYYY-MM-DD) y % esperado a esa fecha. */
  @Column({ name: 'fecha_compromiso', type: 'date', nullable: true })
  fechaCompromiso: string | null;

  @Column({ name: 'porcentaje_esperado', type: 'decimal', precision: 5, scale: 2, nullable: true, transformer: decimal })
  porcentajeEsperado: number | null;

  @Column({ type: 'int' })
  orden: number;
}

/** Legado: el Plan de Mejora ya usa Meta.fechaCompromiso / porcentajeEsperado. Se conserva por los datos existentes. */
@Entity('hito_avance')
export class HitoAvance {
  @PrimaryGeneratedColumn({ name: 'hito_id', type: 'bigint' })
  id: string;

  @Column({ name: 'recomendacion_id', type: 'bigint' })
  recomendacionId: string;

  @Column({ name: 'fecha_hito', type: 'date' })
  fechaHito: string;

  @Column({ name: 'porcentaje_esperado', type: 'decimal', precision: 5, scale: 2, transformer: decimal })
  porcentajeEsperado: number;

  @Column({ name: 'creado_por', type: 'bigint' })
  creadoPor: string;
}

@Entity('revision_plan')
export class RevisionPlan {
  @PrimaryGeneratedColumn({ name: 'revision_plan_id', type: 'bigint' })
  id: string;

  @Column({ name: 'version_plan_id', type: 'bigint' })
  versionPlanId: string;

  @Column({ name: 'revisor_id', type: 'bigint' })
  revisorId: string;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'revisor_id' })
  revisor: Usuario;

  @Column({ type: 'varchar', length: 20 })
  decision: 'APROBADO' | 'DEVUELTO';

  @Column({ name: 'comentario_general', type: 'text', nullable: true })
  comentarioGeneral: string | null;

  @Column({ name: 'revisado_en', type: 'datetime', insert: false, update: false })
  revisadoEn: Date;

  @OneToMany(() => ObservacionPlan, (o) => o.revision)
  observaciones: ObservacionPlan[];
}

@Entity('observacion_plan')
export class ObservacionPlan {
  @PrimaryGeneratedColumn({ name: 'observacion_plan_id', type: 'bigint' })
  id: string;

  @Column({ name: 'revision_plan_id', type: 'bigint' })
  revisionPlanId: string;

  @ManyToOne(() => RevisionPlan, (r) => r.observaciones)
  @JoinColumn({ name: 'revision_plan_id' })
  revision: RevisionPlan;

  @Column({ name: 'recomendacion_id', type: 'bigint', nullable: true })
  recomendacionId: string | null;

  @Column({ type: 'text' })
  comentario: string;

  @Column({ name: 'creada_en', type: 'datetime', insert: false, update: false })
  creadaEn: Date;
}

@Entity('informe')
export class Informe {
  @PrimaryGeneratedColumn({ name: 'informe_id', type: 'bigint' })
  id: string;

  @Column({ name: 'ciclo_id', type: 'bigint' })
  cicloId: string;

  @Column({ name: 'nombre_periodo', length: 120 })
  nombrePeriodo: string;

  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ name: 'fecha_fin', type: 'date' })
  fechaFin: string;

  @Column({ name: 'fecha_corte', type: 'date' })
  fechaCorte: string;
}

@Entity('version_informe')
export class VersionInforme {
  @PrimaryGeneratedColumn({ name: 'version_informe_id', type: 'bigint' })
  id: string;

  @Column({ name: 'informe_id', type: 'bigint' })
  informeId: string;

  @ManyToOne(() => Informe)
  @JoinColumn({ name: 'informe_id' })
  informe: Informe;

  @Column({ name: 'version_plan_id', type: 'bigint' })
  versionPlanId: string;

  @Column({ name: 'numero_version', type: 'int' })
  numeroVersion: number;

  @Column({ type: 'varchar', length: 20 })
  estado: EstadoVersion;

  @Column({ name: 'creado_por', type: 'bigint' })
  creadoPor: string;

  @Column({ name: 'aprobado_en', type: 'datetime', nullable: true })
  aprobadoEn: Date | null;
}

@Entity('avance_recomendacion')
export class AvanceRecomendacion {
  @PrimaryGeneratedColumn({ name: 'avance_id', type: 'bigint' })
  id: string;

  @Column({ name: 'version_informe_id', type: 'bigint' })
  versionInformeId: string;

  @ManyToOne(() => VersionInforme)
  @JoinColumn({ name: 'version_informe_id' })
  versionInforme: VersionInforme;

  @Column({ name: 'recomendacion_id', type: 'bigint' })
  recomendacionId: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, transformer: decimal })
  porcentaje: number;

  @Column({ type: 'text', nullable: true })
  observaciones: string | null;

  @Column({ name: 'actualizado_por', type: 'bigint' })
  actualizadoPor: string;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'actualizado_por' })
  usuario: Usuario;

  @Column({ name: 'actualizado_en', type: 'datetime', insert: false, update: false })
  actualizadoEn: Date;
}

export const ENTIDADES_PLAN = [
  OrganismoAcreditador,
  AreaResponsable,
  Categoria,
  CicloAcreditacion,
  VersionPlan,
  Indicador,
  Recomendacion,
  AccionRecomendacion,
  Meta,
  HitoAvance,
  RevisionPlan,
  ObservacionPlan,
  Informe,
  VersionInforme,
  AvanceRecomendacion,
];
