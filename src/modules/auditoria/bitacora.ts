// HU-03 · Consulta de la bitácora para el Administrador: filtros, contexto legible de cada registro y la línea de
// tiempo de una recomendación (su captura en el plan y su avance en cada informe). Solo lectura.
import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import { describirActividad, type TipoActividad } from './actividad';

export const AREAS_BITACORA = ['SESIONES', 'CUENTAS', 'PLAN', 'INFORME', 'CICLOS'] as const;
export type AreaBitacora = (typeof AREAS_BITACORA)[number];
const ROLES = ['ADMINISTRADOR', 'CAPTURA', 'AUXILIAR'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class FiltrosBitacoraDto {
  @IsOptional() @IsIn(ROLES) rol?: (typeof ROLES)[number];
  @IsOptional() @IsIn(AREAS_BITACORA) area?: AreaBitacora;
  @IsOptional() @Matches(FECHA) desde?: string;
  @IsOptional() @Matches(FECHA) hasta?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** HU-13: una o varias licenciaturas separadas por coma (sin el parámetro, todas). */
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) pagina?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100) limite?: number;
}

/** Registro de la bitácora como lo ve el Administrador (debe coincidir con EventoAuditoria del frontend). */
export type EventoAuditoria = {
  id: string;
  /** ISO 8601 */
  fecha: string;
  usuario: { id: string; nombre: string; correo: string };
  rol: string;
  tipo: TipoActividad;
  accion: string;
  entidad: string;
  entidadId: string;
  campo: string;
  anterior: string | null;
  nuevo: string | null;
  /** "Economía · Recomendación: Crear un sistema de seguimiento…" (null si el registro ya no existe). */
  contexto: string | null;
  licenciatura: string | null;
};

export type PaginaBitacora = { total: number; pagina: number; limite: number; eventos: EventoAuditoria[] };

/** Condición SQL de cada área de la bitácora (constantes; nunca vienen del usuario). */
export const CONDICION_AREA: Record<AreaBitacora, string> = {
  SESIONES: "(a.entidad = 'usuario' AND a.campo IN ('sesion', 'hash_contrasena'))",
  CUENTAS: "(a.entidad = 'usuario' AND a.campo NOT IN ('sesion', 'hash_contrasena'))",
  PLAN: "a.entidad IN ('recomendacion', 'version_plan')",
  INFORME: "a.entidad IN ('avance_recomendacion', 'version_informe')",
  CICLOS: "a.entidad = 'ciclo_acreditacion'",
};

/**
 * Licenciatura a la que pertenece lo que se modificó (no quién lo hizo). NULL si ya no existe (p. ej. una
 * recomendación eliminada) o si no aplica. Para cuentas, la licenciatura de su asignación activa.
 */
export const LICENCIATURA_DEL_REGISTRO = `(CASE a.entidad
  WHEN 'recomendacion' THEN (SELECT c.licenciatura_id FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id
    JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id WHERE r.recomendacion_id = a.entidad_id)
  WHEN 'avance_recomendacion' THEN (SELECT c.licenciatura_id FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id
    JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id WHERE r.recomendacion_id = a.entidad_id)
  WHEN 'version_plan' THEN (SELECT c.licenciatura_id FROM version_plan vp JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id WHERE vp.version_plan_id = a.entidad_id)
  WHEN 'version_informe' THEN (SELECT c.licenciatura_id FROM version_informe vi JOIN informe inf ON inf.informe_id = vi.informe_id
    JOIN ciclo_acreditacion c ON c.ciclo_id = inf.ciclo_id WHERE vi.version_informe_id = a.entidad_id)
  WHEN 'ciclo_acreditacion' THEN (SELECT c.licenciatura_id FROM ciclo_acreditacion c WHERE c.ciclo_id = a.entidad_id)
  WHEN 'usuario' THEN (SELECT co.licenciatura_id FROM asignacion_usuario asg JOIN coordinacion co ON co.coordinacion_id = asg.coordinacion_id
    WHERE asg.usuario_id = a.entidad_id AND asg.activa = TRUE LIMIT 1)
  ELSE NULL END)`;

/** Arma el WHERE y sus parámetros a partir de los filtros validados. */
export const condicionesBitacora = (f: FiltrosBitacoraDto) => {
  const partes: string[] = [];
  const valores: unknown[] = [];
  if (f.desde && f.hasta && f.desde > f.hasta) throw new BadRequestException('La fecha inicial debe ser anterior a la final.');
  if (f.rol) {
    partes.push('a.rol_codigo = ?');
    valores.push(f.rol);
  }
  if (f.area) partes.push(CONDICION_AREA[f.area]);
  // Las fechas se guardan en UTC; el filtro es por día de la Ciudad de México (UTC-6, sin horario de verano).
  if (f.desde) {
    partes.push('a.ocurrido_en >= ?');
    valores.push(`${f.desde} 06:00:00`);
  }
  if (f.hasta) {
    partes.push('a.ocurrido_en < DATE_ADD(?, INTERVAL 1 DAY)');
    valores.push(`${f.hasta} 06:00:00`);
  }
  if (f.q?.trim()) {
    const texto = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    partes.push("(CONCAT(u.nombre, ' ', u.apellido) LIKE ? OR u.correo LIKE ? OR a.campo LIKE ? OR a.valor_anterior LIKE ? OR a.valor_nuevo LIKE ?)");
    valores.push(texto, texto, texto, texto, texto);
  }
  if (f.licenciaturaIds) {
    partes.push(`${LICENCIATURA_DEL_REGISTRO} IN (?)`);
    valores.push(f.licenciaturaIds.split(','));
  }
  return { where: partes.length ? `WHERE ${partes.join(' AND ')}` : '', valores };
};

type Fila = {
  id: string | number;
  usuario_id: string | number;
  nombre: string;
  apellido: string;
  correo: string;
  rol_codigo: string;
  entidad: string;
  entidad_id: string | number;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  ocurrido_en: Date;
  licenciatura: string | null;
};

/** Valores que nunca se muestran tal cual (p. ej. el JSON con el motivo de una baja se resume). */
const valorVisible = (entidad: string, campo: string, valor: string | null) => {
  if (valor === null) return null;
  if (entidad === 'usuario' && campo === 'estado') {
    try {
      const dato = JSON.parse(valor) as { estado?: string; motivo?: string };
      return [dato.estado, dato.motivo].filter(Boolean).join(' · ') || valor;
    } catch {
      return valor;
    }
  }
  return valor;
};

export const aEvento = (f: Fila, contexto: string | null): EventoAuditoria => {
  const fecha = f.ocurrido_en instanceof Date ? f.ocurrido_en : new Date(f.ocurrido_en);
  const descrito = describirActividad({ id: String(f.id), entidad: f.entidad, campo: f.campo, valorNuevo: f.valor_nuevo, ocurridoEn: fecha });
  return {
    id: String(f.id),
    fecha: fecha.toISOString(),
    usuario: { id: String(f.usuario_id), nombre: `${f.nombre} ${f.apellido}`.trim(), correo: f.correo },
    rol: f.rol_codigo,
    tipo: descrito.tipo,
    accion: descrito.descripcion,
    entidad: f.entidad,
    entidadId: String(f.entidad_id),
    campo: f.campo,
    anterior: valorVisible(f.entidad, f.campo, f.valor_anterior),
    nuevo: valorVisible(f.entidad, f.campo, f.valor_nuevo),
    contexto,
    licenciatura: f.licenciatura,
  };
};
