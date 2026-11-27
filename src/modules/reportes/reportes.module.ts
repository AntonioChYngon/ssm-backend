// HU-14 y HU-15 · Reportes ejecutivos de avance (solo Administrador).
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/auth';
import { ultimosAvances } from '../../common/avances';
import { Rol } from '../../common/enums';
import { leerLicenciaturaIds, PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import { hoyEnMexico } from '../planes/reglas';
import { contarPorEstatus, ConteoAtencion } from './reglas';

// ---------- Contrato (debe coincidir con AtencionLicenciatura en ssm-frontend/src/lib/types.ts) ----------

export type AtencionLicenciatura = ConteoAtencion & {
  licenciaturaId: string;
  licenciatura: string;
};

export type Incumplimiento = {
  id: string;
  licenciaturaId: string;
  licenciatura: string;
  ciclo: string;
  recomendacionId: string;
  numeroRecomendacion: number;
  indicador: string;
  recomendacion: string;
  metaId: string | null;
  meta: string;
  fechaCompromiso: string | null;
  porcentajeMeta: number | null;
  esperado: number;
  real: number;
  brecha: number;
};

export class FiltroLicenciaturasDto {
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
}

export class FiltroIncumplimientoDto extends FiltroLicenciaturasDto {
  @IsDateString({}, { message: 'fechaCorte debe ser una fecha válida (AAAA-MM-DD).' }) fechaCorte: string;
  @Type(() => Number)
  @IsInt({ message: 'porcentajeEsperado debe ser un número entero.' })
  @Min(1, { message: 'porcentajeEsperado debe ser al menos 1.' })
  @Max(100, { message: 'porcentajeEsperado no puede ser mayor a 100.' })
  porcentajeEsperado: number;
}

type FilaRecomendacion = {
  id: string | number;
  licenciatura_id: string | number;
  licenciatura: string;
  ciclo: string;
  numero: number;
  indicador_clave: string | null;
  indicador: string;
  recomendacion: string;
};

type FilaIncumplimiento = FilaRecomendacion & {
  meta_id: string | number | null;
  meta: string | null;
  fecha_compromiso: string | null;
  porcentaje_meta: string | number | null;
};

// ---------- Servicio ----------

@Injectable()
export class ReportesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async resumenAtencion(filtros: FiltroLicenciaturasDto): Promise<AtencionLicenciatura[]> {
    const filas = await this.recomendacionesVigentes(leerLicenciaturaIds(filtros.licenciaturaIds));
    const avances = await ultimosAvances(this.ds, filas.map((f) => String(f.id)));
    const grupos = new Map<string, { nombre: string; porcentajes: (number | null)[] }>();
    for (const fila of filas) {
      const id = String(fila.licenciatura_id);
      const grupo = grupos.get(id) ?? { nombre: fila.licenciatura, porcentajes: [] };
      grupo.porcentajes.push(avances.get(String(fila.id)) ?? null);
      grupos.set(id, grupo);
    }
    return [...grupos.entries()].map(([licenciaturaId, grupo]) => ({
      licenciaturaId,
      licenciatura: grupo.nombre,
      ...contarPorEstatus(grupo.porcentajes),
    }));
  }

  async incumplimiento(filtros: FiltroIncumplimientoDto): Promise<Incumplimiento[]> {
    const ids = leerLicenciaturaIds(filtros.licenciaturaIds);
    const condiciones = [
      "c.estado = 'VIGENTE'",
      'c.vigencia_fin >= ?',
      "vp.estado = 'APROBADO'",
      "vp.numero_version = (SELECT MAX(x.numero_version) FROM version_plan x WHERE x.ciclo_id = vp.ciclo_id AND x.estado = 'APROBADO')",
    ];
    const valores: unknown[] = [hoyEnMexico()];
    if (ids) {
      condiciones.push('c.licenciatura_id IN (?)');
      valores.push(ids);
    }
    const filas: FilaIncumplimiento[] = await this.ds.query(
      `SELECT r.recomendacion_id AS id, c.licenciatura_id, l.nombre AS licenciatura, c.nombre AS ciclo,
              r.orden AS numero, i.clave AS indicador_clave, i.descripcion AS indicador,
              r.descripcion AS recomendacion, m.meta_id, m.descripcion AS meta,
              m.fecha_compromiso, m.porcentaje_esperado AS porcentaje_meta
       FROM recomendacion r
       JOIN indicador i ON i.indicador_id = r.indicador_id
       JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id
       JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       LEFT JOIN meta m ON m.recomendacion_id = r.recomendacion_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY l.nombre, i.orden, r.orden, m.orden`,
      valores,
    );
    const avances = await ultimosAvances(this.ds, [...new Set(filas.map((f) => String(f.id)))], filtros.fechaCorte);
    return filas
      .map((f): Incumplimiento => {
        const real = avances.get(String(f.id)) ?? 0;
        const indicador = f.indicador_clave ? `${f.indicador_clave} · ${f.indicador}` : f.indicador;
        return {
          id: `${f.id}:${f.meta_id ?? 'sin-meta'}`,
          licenciaturaId: String(f.licenciatura_id),
          licenciatura: f.licenciatura,
          ciclo: f.ciclo,
          recomendacionId: String(f.id),
          numeroRecomendacion: Number(f.numero),
          indicador,
          recomendacion: f.recomendacion,
          metaId: f.meta_id === null ? null : String(f.meta_id),
          meta: f.meta ?? 'Sin meta registrada',
          fechaCompromiso: f.fecha_compromiso ? String(f.fecha_compromiso).slice(0, 10) : null,
          porcentajeMeta: f.porcentaje_meta === null ? null : Number(f.porcentaje_meta),
          esperado: filtros.porcentajeEsperado,
          real,
          brecha: filtros.porcentajeEsperado - real,
        };
      })
      .filter((f) => f.real < filtros.porcentajeEsperado);
  }

  private async recomendacionesVigentes(ids?: string[]): Promise<FilaRecomendacion[]> {
    const condiciones = [
      "c.estado = 'VIGENTE'",
      'c.vigencia_fin >= ?',
      "vp.estado = 'APROBADO'",
      "vp.numero_version = (SELECT MAX(x.numero_version) FROM version_plan x WHERE x.ciclo_id = vp.ciclo_id AND x.estado = 'APROBADO')",
    ];
    const valores: unknown[] = [hoyEnMexico()];
    if (ids) {
      condiciones.push('c.licenciatura_id IN (?)');
      valores.push(ids);
    }
    return this.ds.query(
      `SELECT r.recomendacion_id AS id, c.licenciatura_id, l.nombre AS licenciatura, c.nombre AS ciclo,
              r.orden AS numero, i.clave AS indicador_clave, i.descripcion AS indicador, r.descripcion AS recomendacion
       FROM recomendacion r
       JOIN indicador i ON i.indicador_id = r.indicador_id
       JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id
       JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY l.nombre, i.orden, r.orden`,
      valores,
    );
  }
}

// ---------- Controlador ----------

@ApiTags('HU-15 · Reportes')
@ApiBearerAuth()
@Controller('reportes')
@Roles(Rol.ADMINISTRADOR)
export class ReportesController {
  constructor(private readonly servicio: ReportesService) {}

  @Get('atencion')
  atencion(@Query() filtros: FiltroLicenciaturasDto) {
    return this.servicio.resumenAtencion(filtros);
  }

  @Get('incumplimiento')
  incumplimiento(@Query() filtros: FiltroIncumplimientoDto) {
    return this.servicio.incumplimiento(filtros);
  }
}

@Module({
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
