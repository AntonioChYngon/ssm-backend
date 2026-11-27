// HU-17 · Identificación y agrupación de recomendaciones transversales (solo Administrador).
// - Consulta de recomendaciones de todas las licenciaturas, con el filtro "Mostrar sólo recomendaciones transversales",
//   sobre el ciclo vigente o los históricos (último plan de cada ciclo).
// - Etiquetado manual: se seleccionan una o varias recomendaciones y se marcan como "Transversal" dentro de un grupo
//   (la "recomendación similar" que comparten varias carreras: tablas grupo_transversal y recomendacion_transversal).
// - Vista agrupada y reporte consolidado (PDF y Word) con las carreras afectadas y el avance consolidado de cada grupo.
// Cada marca, cambio de grupo o quitada queda en la bitácora (HU-03).
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Column, DataSource, Entity, EntityManager, PrimaryGeneratedColumn } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { ultimosAvances } from '../../common/avances';
import { Rol } from '../../common/enums';
import { leerLicenciaturaIds, PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import { AuditoriaService } from '../auditoria/auditoria.module';
import { generarDocxReporte } from '../planes/membrete/reporte-docx';
import { generarPdfReporte } from '../planes/membrete/reporte-pdf';
import { cicloActivo, hoyEnMexico } from '../planes/reglas';
import {
  agruparTransversales,
  AlcanceCiclos,
  ALCANCES,
  enAlcance,
  GrupoConsolidado,
  GrupoTransversal,
  nombreArchivoTransversales,
  RecomendacionConsulta,
  reporteTransversales,
} from './reglas';

@Entity('grupo_transversal')
export class GrupoTransversalEntidad {
  @PrimaryGeneratedColumn({ name: 'grupo_transversal_id', type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 180 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'creado_por', type: 'bigint' })
  creadoPor: string;

  @Column({ name: 'creado_en', type: 'datetime', insert: false, update: false })
  creadoEn: Date;
}

const ID = /^\d{1,19}$/;

export class FiltrosTransversalesDto {
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
  @IsOptional() @IsIn(ALCANCES) ciclos?: AlcanceCiclos;
  /** "Mostrar sólo recomendaciones transversales". */
  @IsOptional() @IsIn(['true', 'false']) soloTransversales?: 'true' | 'false';
  @IsOptional() @Matches(ID) grupoId?: string;
  @IsOptional() @IsString() @Length(0, 120) q?: string;
}

export class GrupoDto {
  @IsString() @Length(3, 180) nombre: string;
  @IsOptional() @IsString() @Length(0, 1000) descripcion?: string;
}

export class MarcarDto {
  @Matches(ID) grupoId: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @Matches(ID, { each: true }) recomendacionIds: string[];
}

export class DesmarcarDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @Matches(ID, { each: true }) recomendacionIds: string[];
}

type FilaConsulta = {
  id: string | number;
  recomendacion: string;
  transversal: number | boolean;
  categoria: string;
  indicador: string;
  clave: string | null;
  licenciatura_id: string | number;
  licenciatura: string;
  ciclo_id: string | number;
  ciclo: string;
  ciclo_estado: string;
  vigencia_fin: string;
  plan_estado: string;
  grupo_id: string | number | null;
  grupo: string | null;
};

const esDuplicado = (error: unknown) => {
  const e = error as { code?: string; driverError?: { code?: string } };
  return (e?.code ?? e?.driverError?.code) === 'ER_DUP_ENTRY';
};

@Injectable()
export class TransversalesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Consulta de recomendaciones con sus filtros (licenciaturas, ciclos, sólo transversales, grupo, texto). */
  async consultar(filtros: FiltrosTransversalesDto, hoy = hoyEnMexico()): Promise<RecomendacionConsulta[]> {
    const licenciaturaIds = leerLicenciaturaIds(filtros.licenciaturaIds);
    const alcance = filtros.ciclos ?? 'vigentes';
    const condiciones = ['vp.numero_version = (SELECT MAX(x.numero_version) FROM version_plan x WHERE x.ciclo_id = vp.ciclo_id)'];
    const valores: unknown[] = [];
    if (licenciaturaIds) {
      condiciones.push('c.licenciatura_id IN (?)');
      valores.push(licenciaturaIds);
    }
    if (filtros.soloTransversales === 'true') condiciones.push('r.transversal = TRUE');
    if (filtros.grupoId) {
      condiciones.push('rt.grupo_transversal_id = ?');
      valores.push(filtros.grupoId);
    }
    const texto = filtros.q?.trim();
    if (texto) {
      condiciones.push('(r.descripcion LIKE ? OR i.descripcion LIKE ? OR g.nombre LIKE ?)');
      const patron = `%${texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      valores.push(patron, patron, patron);
    }
    const filas: FilaConsulta[] = await this.ds.query(
      `SELECT r.recomendacion_id AS id, r.descripcion AS recomendacion, r.transversal,
              cat.nombre AS categoria, i.descripcion AS indicador, i.clave,
              l.licenciatura_id, l.nombre AS licenciatura,
              c.ciclo_id, c.nombre AS ciclo, c.estado AS ciclo_estado, c.vigencia_fin,
              vp.estado AS plan_estado, g.grupo_transversal_id AS grupo_id, g.nombre AS grupo
       FROM recomendacion r
       JOIN indicador i ON i.indicador_id = r.indicador_id
       JOIN categoria cat ON cat.categoria_id = i.categoria_id
       JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id
       JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       LEFT JOIN recomendacion_transversal rt ON rt.recomendacion_id = r.recomendacion_id
       LEFT JOIN grupo_transversal g ON g.grupo_transversal_id = rt.grupo_transversal_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY l.nombre, c.vigencia_inicio DESC, cat.orden, i.orden, r.orden`,
      valores,
    );
    const visibles = filas.filter((f) => enAlcance(cicloActivo({ estado: f.ciclo_estado, vigenciaFin: String(f.vigencia_fin).slice(0, 10) }, hoy), alcance));
    const avances = await ultimosAvances(this.ds, visibles.map((f) => String(f.id)));
    return visibles.map((f) => ({
      id: String(f.id),
      licenciatura: { id: String(f.licenciatura_id), nombre: f.licenciatura },
      ciclo: { id: String(f.ciclo_id), nombre: f.ciclo, vigente: cicloActivo({ estado: f.ciclo_estado, vigenciaFin: String(f.vigencia_fin).slice(0, 10) }, hoy) },
      planEstado: f.plan_estado,
      categoria: f.categoria,
      indicador: f.clave ? `${f.clave} ${f.indicador}` : f.indicador,
      recomendacion: f.recomendacion,
      transversal: Boolean(Number(f.transversal)),
      grupo: f.grupo_id ? { id: String(f.grupo_id), nombre: String(f.grupo) } : null,
      avance: avances.get(String(f.id)) ?? null,
    }));
  }

  /** Vista agrupada: cada grupo con las licenciaturas que lo comparten y su avance consolidado. */
  async grupos(filtros: FiltrosTransversalesDto): Promise<GrupoConsolidado[]> {
    const grupos = await this.listaGrupos();
    const recomendaciones = await this.consultar({ ...filtros, soloTransversales: 'true', grupoId: undefined, q: undefined });
    const consolidados = agruparTransversales(grupos, recomendaciones);
    return filtros.grupoId ? consolidados.filter((g) => g.id === filtros.grupoId) : consolidados;
  }

  async crearGrupo(admin: UsuarioToken, dto: GrupoDto): Promise<GrupoTransversal> {
    const nombre = dto.nombre.trim();
    if (nombre.length < 3) throw new BadRequestException('El nombre del grupo debe tener al menos 3 caracteres.');
    try {
      const repo = this.ds.getRepository(GrupoTransversalEntidad);
      const grupo = await repo.save(repo.create({ nombre, descripcion: dto.descripcion?.trim() || null, creadoPor: admin.sub }));
      await this.auditoria.registrar(admin, { entidad: 'grupo_transversal', entidadId: grupo.id, campo: 'alta', nuevo: nombre });
      return { id: grupo.id, nombre: grupo.nombre, descripcion: grupo.descripcion };
    } catch (error) {
      if (esDuplicado(error)) throw new ConflictException(`Ya existe un grupo llamado "${nombre}".`);
      throw error;
    }
  }

  async editarGrupo(admin: UsuarioToken, id: string, dto: GrupoDto): Promise<GrupoTransversal> {
    const repo = this.ds.getRepository(GrupoTransversalEntidad);
    const grupo = await this.buscarGrupo(repo.manager, id);
    const nombre = dto.nombre.trim();
    const descripcion = dto.descripcion?.trim() || null;
    try {
      await repo.update(id, { nombre, descripcion });
    } catch (error) {
      if (esDuplicado(error)) throw new ConflictException(`Ya existe un grupo llamado "${nombre}".`);
      throw error;
    }
    if (grupo.nombre !== nombre) await this.auditoria.registrar(admin, { entidad: 'grupo_transversal', entidadId: id, campo: 'nombre', anterior: grupo.nombre, nuevo: nombre });
    if ((grupo.descripcion ?? null) !== descripcion) await this.auditoria.registrar(admin, { entidad: 'grupo_transversal', entidadId: id, campo: 'descripcion', anterior: grupo.descripcion, nuevo: descripcion });
    return { id, nombre, descripcion };
  }

  /** Borra el grupo; sus recomendaciones dejan de ser transversales (no se borra ninguna recomendación). */
  async eliminarGrupo(admin: UsuarioToken, id: string) {
    const quitadas = await this.ds.transaction(async (tx) => {
      const grupo = await this.buscarGrupo(tx, id);
      const miembros: { id: string | number }[] = await tx.query('SELECT recomendacion_id AS id FROM recomendacion_transversal WHERE grupo_transversal_id = ?', [id]);
      const ids = miembros.map((m) => String(m.id));
      if (ids.length) {
        await tx.query('DELETE FROM recomendacion_transversal WHERE grupo_transversal_id = ?', [id]);
        await tx.query('UPDATE recomendacion SET transversal = FALSE WHERE recomendacion_id IN (?)', [ids]);
      }
      await tx.delete(GrupoTransversalEntidad, { id });
      return { grupo, ids };
    });
    for (const recomendacionId of quitadas.ids) {
      await this.auditoria.registrar(admin, { entidad: 'recomendacion', entidadId: recomendacionId, campo: 'transversal', anterior: quitadas.grupo.nombre, nuevo: null });
    }
    await this.auditoria.registrar(admin, { entidad: 'grupo_transversal', entidadId: id, campo: 'eliminado', anterior: quitadas.grupo.nombre, nuevo: null });
    return { id, recomendacionesQuitadas: quitadas.ids.length };
  }

  /** Etiquetado manual: marca las recomendaciones como transversales en el grupo (si estaban en otro, se mueven). */
  async marcar(admin: UsuarioToken, dto: MarcarDto) {
    const ids = [...new Set(dto.recomendacionIds)];
    const cambios = await this.ds.transaction(async (tx) => {
      const grupo = await this.buscarGrupo(tx, dto.grupoId);
      const anteriores = await this.gruposActuales(tx, ids);
      await tx.query('DELETE FROM recomendacion_transversal WHERE recomendacion_id IN (?)', [ids]);
      await tx.query(`INSERT INTO recomendacion_transversal (grupo_transversal_id, recomendacion_id) VALUES ${ids.map(() => '(?, ?)').join(', ')}`, ids.flatMap((r) => [dto.grupoId, r]));
      await tx.query('UPDATE recomendacion SET transversal = TRUE WHERE recomendacion_id IN (?)', [ids]);
      return ids.filter((r) => anteriores.get(r) !== grupo.nombre).map((r) => ({ id: r, anterior: anteriores.get(r) ?? null, nuevo: grupo.nombre }));
    });
    for (const c of cambios) await this.auditoria.registrar(admin, { entidad: 'recomendacion', entidadId: c.id, campo: 'transversal', anterior: c.anterior, nuevo: c.nuevo });
    return { grupoId: dto.grupoId, marcadas: ids.length };
  }

  /** Quita la marca de transversal (y el grupo) a las recomendaciones. */
  async desmarcar(admin: UsuarioToken, dto: DesmarcarDto) {
    const ids = [...new Set(dto.recomendacionIds)];
    const anteriores = await this.ds.transaction(async (tx) => {
      const previos = await this.gruposActuales(tx, ids);
      await tx.query('DELETE FROM recomendacion_transversal WHERE recomendacion_id IN (?)', [ids]);
      await tx.query('UPDATE recomendacion SET transversal = FALSE WHERE recomendacion_id IN (?)', [ids]);
      return previos;
    });
    for (const [id, grupo] of anteriores) await this.auditoria.registrar(admin, { entidad: 'recomendacion', entidadId: id, campo: 'transversal', anterior: grupo, nuevo: null });
    return { quitadas: anteriores.size };
  }

  async reporte(filtros: FiltrosTransversalesDto, formato: 'pdf' | 'docx') {
    const grupos = await this.grupos(filtros);
    const ids = leerLicenciaturaIds(filtros.licenciaturaIds);
    let licenciaturas = 'Todas';
    if (ids) {
      const filas: { nombre: string }[] = await this.ds.query('SELECT nombre FROM licenciatura WHERE licenciatura_id IN (?) ORDER BY nombre', [ids]);
      licenciaturas = filas.map((f) => f.nombre).join(', ') || 'Ninguna';
    }
    const datos = reporteTransversales(grupos, { alcance: filtros.ciclos ?? 'vigentes', licenciaturas });
    return formato === 'pdf' ? generarPdfReporte(datos) : generarDocxReporte(datos);
  }

  private async listaGrupos(): Promise<GrupoTransversal[]> {
    const grupos = await this.ds.getRepository(GrupoTransversalEntidad).find({ order: { nombre: 'ASC' } });
    return grupos.map((g) => ({ id: g.id, nombre: g.nombre, descripcion: g.descripcion }));
  }

  private async buscarGrupo(tx: EntityManager, id: string) {
    const grupo = await tx.findOneBy(GrupoTransversalEntidad, { id });
    if (!grupo) throw new NotFoundException('Grupo transversal no encontrado.');
    return grupo;
  }

  /** recomendacionId → nombre del grupo donde está hoy. Además confirma que todas existen. */
  private async gruposActuales(tx: EntityManager, ids: string[]) {
    const filas: { id: string | number; grupo: string | null }[] = await tx.query(
      `SELECT r.recomendacion_id AS id, g.nombre AS grupo
       FROM recomendacion r
       LEFT JOIN recomendacion_transversal rt ON rt.recomendacion_id = r.recomendacion_id
       LEFT JOIN grupo_transversal g ON g.grupo_transversal_id = rt.grupo_transversal_id
       WHERE r.recomendacion_id IN (?)`,
      [ids],
    );
    const existentes = new Set(filas.map((f) => String(f.id)));
    if (ids.some((id) => !existentes.has(id))) throw new NotFoundException('Alguna de las recomendaciones ya no existe; recarga la consulta.');
    return new Map(filas.filter((f) => f.grupo).map((f) => [String(f.id), String(f.grupo)]));
  }
}

@ApiTags('Transversales')
@ApiBearerAuth()
@Controller('transversales')
@Roles(Rol.ADMINISTRADOR)
export class TransversalesController {
  constructor(private readonly servicio: TransversalesService) {}

  /** Consulta de recomendaciones, con el filtro "Mostrar sólo recomendaciones transversales" (soloTransversales=true). */
  @Get('recomendaciones')
  consultar(@Query() filtros: FiltrosTransversalesDto) {
    return this.servicio.consultar(filtros);
  }

  /** Vista agrupada con las carreras afectadas y el avance consolidado de cada grupo. */
  @Get('grupos')
  grupos(@Query() filtros: FiltrosTransversalesDto) {
    return this.servicio.grupos(filtros);
  }

  @Post('grupos')
  crearGrupo(@UsuarioActual() admin: UsuarioToken, @Body() dto: GrupoDto) {
    return this.servicio.crearGrupo(admin, dto);
  }

  @Patch('grupos/:id')
  editarGrupo(@UsuarioActual() admin: UsuarioToken, @Param('id') id: string, @Body() dto: GrupoDto) {
    return this.servicio.editarGrupo(admin, this.id(id), dto);
  }

  @Delete('grupos/:id')
  eliminarGrupo(@UsuarioActual() admin: UsuarioToken, @Param('id') id: string) {
    return this.servicio.eliminarGrupo(admin, this.id(id));
  }

  /** Selector: marca una o varias recomendaciones como transversales dentro de un grupo. */
  @Post('marcar')
  @HttpCode(200)
  marcar(@UsuarioActual() admin: UsuarioToken, @Body() dto: MarcarDto) {
    return this.servicio.marcar(admin, dto);
  }

  @Post('desmarcar')
  @HttpCode(200)
  desmarcar(@UsuarioActual() admin: UsuarioToken, @Body() dto: DesmarcarDto) {
    return this.servicio.desmarcar(admin, dto);
  }

  /** Reporte consolidado en PDF. */
  @Get('reporte/pdf')
  async reportePdf(@Query() filtros: FiltrosTransversalesDto) {
    return new StreamableFile(await this.servicio.reporte(filtros, 'pdf'), {
      type: 'application/pdf',
      disposition: `attachment; filename="${nombreArchivoTransversales(filtros.ciclos ?? 'vigentes')}.pdf"`,
    });
  }

  /** El mismo reporte en Word editable. */
  @Get('reporte/docx')
  async reporteWord(@Query() filtros: FiltrosTransversalesDto) {
    return new StreamableFile(await this.servicio.reporte(filtros, 'docx'), {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${nombreArchivoTransversales(filtros.ciclos ?? 'vigentes')}.docx"`,
    });
  }

  private id(id: string) {
    if (!ID.test(id)) throw new BadRequestException('El identificador del grupo no es válido.');
    return id;
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([GrupoTransversalEntidad])],
  controllers: [TransversalesController],
  providers: [TransversalesService],
})
export class TransversalesModule {}
