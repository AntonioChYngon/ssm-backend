// Contrato del Informe de Seguimiento. Debe coincidir con ssm-frontend/src/lib/types.ts.
// Si cambias un campo aquí, cámbialo allá en el mismo PR y avisa en el canal del equipo.
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { EstadoVersion } from '../../common/enums';
import { PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import type { RevisionResumen } from '../planes/planes.module';
import type { BloqueoInforme } from './reglas';

export type { RevisionResumen };

/** id = version_informe_id (como el plan, que usa version_plan_id). */
export type InformeResumen = {
  id: string;
  informeId: string;
  cicloId: string;
  licenciaturaId: string;
  licenciatura: string;
  ciclo: string;
  /** Semestre: "2027-1". */
  periodo: string;
  fechaInicio: string;
  fechaFin: string;
  fechaCorte: string;
  estado: EstadoVersion;
  enviadoEn: string | null;
  aprobadoEn: string | null;
  /** Recomendaciones del plan aprobado al que se liga el informe. */
  recomendaciones: number;
  /** Recomendaciones con % capturado. */
  conAvance: number;
  evidencias: number;
};

export type EvidenciaInforme = {
  id: string;
  origen: 'ARCHIVO' | 'URL';
  nombre: string;
  /** Bytes del PDF; null en enlaces. */
  tamano: number | null;
  /**
   * externo = true: URL para abrir directo en pestaña nueva (enlace del Plan B o de Drive).
   * externo = false: ruta del API (/evidencias/:id/archivo) que se descarga con sesión y se abre como blob:.
   */
  enlace: string;
  externo: boolean;
  cargadaPor: string;
  cargadaEn: string;
};

export type MetaInforme = { descripcion: string; fechaCompromiso: string | null; porcentajeEsperado: number | null };

export type AvanceDetalle = {
  recomendacionId: string;
  numero: number;
  categoria: string;
  indicador: string;
  recomendacion: string;
  fechaCumplimiento: string | null;
  metas: MetaInforme[];
  /** Mayor % esperado de las metas que vencen hasta el corte (null si ninguna). */
  esperadoAlCorte: number | null;
  /** null = aún no se captura. */
  porcentaje: number | null;
  observaciones: string | null;
  /** true cuando está al 100 %: necesita al menos una evidencia para enviar. */
  evidenciaObligatoria: boolean;
  /** Observación del Administrador en la última devolución o reapertura. */
  observacionRevision: string | null;
  evidencias: EvidenciaInforme[];
};

export type InformeDetalle = InformeResumen & {
  organismo: string;
  vigenciaInicio: string;
  vigenciaFin: string;
  /** Solo el backend decide si la coordinación puede editar. */
  editable: boolean;
  bloqueo: BloqueoInforme | null;
  avances: AvanceDetalle[];
  ultimaRevision: RevisionResumen | null;
  revisiones: RevisionResumen[];
};

export type PeriodoActual = { nombre: string; fechaInicio: string; fechaFin: string; fechaCorte: string };

/** GET /informes/mio: lo que necesita la pantalla de la coordinación para iniciar o seguir su informe. */
export type MiInforme = {
  ciclo: { id: string; nombre: string; licenciatura: string; organismo: string; vigenciaInicio: string; vigenciaFin: string; activo: boolean; mensaje: string | null };
  /** Semestre en curso dentro de la vigencia (null si hoy está fuera del ciclo). */
  periodo: PeriodoActual | null;
  /** Sin plan aprobado no se puede iniciar el informe. */
  planAprobado: boolean;
  /** Informe del semestre en curso (null si aún no se inicia). */
  informe: InformeDetalle | null;
  /** Informes de semestres anteriores del mismo ciclo, del más reciente al más antiguo. */
  anteriores: InformeResumen[];
};

// ---------- DTO ----------

const ESTADOS = Object.values(EstadoVersion);
const ID = /^\d{1,19}$/;

export class FiltrosInformesDto {
  @IsOptional() @IsIn(ESTADOS) estado?: EstadoVersion;
  @IsOptional() @Matches(ID) licenciaturaId?: string;
  /** HU-13: una o varias licenciaturas separadas por coma (sin el parámetro, todas). */
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
  @IsOptional() @Matches(ID) cicloId?: string;
  @IsOptional() @IsString() @MaxLength(20) periodo?: string;
}

/** HU-07 · Guardar el avance de una recomendación. */
export class AvanceDto {
  @IsInt({ message: 'El avance debe ser un número entero de 0 a 100.' })
  @Min(0, { message: 'El avance debe ser un número entero de 0 a 100.' })
  @Max(100, { message: 'El avance debe ser un número entero de 0 a 100.' })
  porcentaje: number;

  @IsOptional() @IsString() @MaxLength(4000) observaciones?: string;
}

/** HU-07 · Plan B: evidencia como enlace. */
export class EnlaceDto {
  @IsString() @Length(8, 2000) url: string;
  @IsOptional() @IsString() @MaxLength(255) nombre?: string;
}

export class ValidarInformeDto {
  @IsOptional() @IsString() @MaxLength(4000) comentario?: string;
}

export class ObservacionInformeDto {
  @Matches(ID) recomendacionId: string;
  @IsString() @Length(1, 4000) comentario: string;
}

/** HU-08 · Devolver: motivo general y observaciones por recomendación (mismo formato que el plan). */
export class DevolverInformeDto {
  @IsString() @Length(5, 4000) motivo: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ObservacionInformeDto) observaciones?: ObservacionInformeDto[];
}

/** HU-08 · Reabrir un informe aprobado: el motivo es obligatorio. */
export class ReabrirInformeDto {
  @IsString() @Length(5, 4000) motivo: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ObservacionInformeDto) observaciones?: ObservacionInformeDto[];
}
