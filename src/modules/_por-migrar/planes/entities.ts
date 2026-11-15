import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { Base } from '../../common/base.entity';
import { EstadoDocumento } from '../../common/enums';
import { Licenciatura } from '../usuarios/entities';

/** Plan de mejora de una licenciatura para un ciclo de acreditación de 5 años (HU-04). */
@Entity('planes')
export class Plan extends Base {
  @ManyToOne(() => Licenciatura, { eager: true })
  @JoinColumn({ name: 'licenciatura_id' })
  licenciatura: Licenciatura;

  @Column({ name: 'licenciatura_id' })
  licenciaturaId: string;

  @Column({ name: 'ciclo_inicio', type: 'date' })
  cicloInicio: string;

  @Column({ name: 'ciclo_fin', type: 'date' })
  cicloFin: string;

  @Column({ type: 'enum', enum: EstadoDocumento, default: EstadoDocumento.BORRADOR })
  estado: EstadoDocumento;

  @Column({ name: 'enviado_en', type: 'datetime', nullable: true })
  enviadoEn: Date | null;

  @Column({ name: 'validado_en', type: 'datetime', nullable: true })
  validadoEn: Date | null;

  @OneToMany(() => Recomendacion, (r) => r.plan, { cascade: true })
  recomendaciones: Recomendacion[];
}

@Entity('recomendaciones')
export class Recomendacion extends Base {
  @ManyToOne(() => Plan, (p) => p.recomendaciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ type: 'smallint' })
  numero: number;

  /** Una de las 10 categorías del catálogo (common/enums CATEGORIAS). */
  @Column({ length: 60 })
  categoria: string;

  @Column({ length: 160 })
  criterio: string;

  @Column({ type: 'text' })
  texto: string;

  @Column({ type: 'text' })
  acciones: string;

  /** Área responsable (catálogo). */
  @Column({ length: 120 })
  responsable: string;

  @Column({ type: 'text', nullable: true })
  indicador: string | null;

  @Column({ type: 'text', nullable: true })
  meta: string | null;

  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ name: 'fecha_termino', type: 'date' })
  fechaTermino: string;

  /** Etiquetas para agrupar recomendaciones transversales (HU-17). */
  @Column({ type: 'simple-array', nullable: true })
  etiquetas: string[] | null;

  @OneToMany(() => Hito, (h) => h.recomendacion, { cascade: true })
  hitos: Hito[];
}

/** Hito intermedio con % esperado entre 1 y 99 (HU-12). */
@Entity('hitos')
export class Hito extends Base {
  @ManyToOne(() => Recomendacion, (r) => r.hitos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recomendacion_id' })
  recomendacion: Recomendacion;

  @Column({ name: 'recomendacion_id' })
  recomendacionId: string;

  @Column({ length: 200 })
  descripcion: string;

  /** YYYY-MM-DD (los DATE se leen como texto: dateStrings en la conexión). */
  @Column({ name: 'fecha_compromiso', type: 'date' })
  fechaCompromiso: string;

  @Column({ name: 'porcentaje_esperado', type: 'tinyint' })
  porcentajeEsperado: number;

  /** Último avance reportado en un informe validado. */
  @Column({ name: 'porcentaje_real', type: 'tinyint', default: 0 })
  porcentajeReal: number;
}
