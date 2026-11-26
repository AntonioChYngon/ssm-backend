import { Controller, Get, Global, Injectable, Logger, Module, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Roles } from '../../common/auth';
import { Rol } from '../../common/enums';
import { RegistroAuditoria } from '../../database/entities';
import { Actividad, describirActividad } from './actividad';
import { aEvento, condicionesBitacora, FiltrosBitacoraDto, LICENCIATURA_DEL_REGISTRO, type EventoAuditoria, type PaginaBitacora } from './bitacora';
import { diferencias, type Instantanea } from './cambios';
import { validarId } from '../planes/reglas';

type Cambio = { entidad: string; entidadId: string; campo: string; anterior?: string | null; nuevo?: string | null };

/** Escribe en registro_auditoria (HU-03). Solo inserta: la base impide editar o borrar. */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    @InjectRepository(RegistroAuditoria) private readonly repo: Repository<RegistroAuditoria>,
    private readonly dataSource: DataSource,
  ) {}

  async registrar(usuario: { sub: string; rol: string }, cambio: Cambio) {
    try {
      await this.repo.insert({
        usuarioId: usuario.sub,
        rolCodigo: usuario.rol,
        entidad: cambio.entidad,
        entidadId: cambio.entidadId,
        campo: cambio.campo,
        valorAnterior: cambio.anterior ?? null,
        valorNuevo: cambio.nuevo ?? null,
      });
    } catch (error) {
      // La auditoría no debe tumbar la operación principal, pero sí dejar rastro en el log.
      this.logger.error(`No se pudo registrar auditoría de ${cambio.entidad}#${cambio.entidadId}`, error as Error);
    }
  }

  /**
   * HU-03 · Registro por campo: una fila por cada campo que cambió entre `antes` y `despues`.
   * Si nada cambió no escribe nada. Devuelve cuántos campos registró.
   */
  async registrarCambios(
    usuario: { sub: string; rol: string },
    { entidad, entidadId, antes, despues, sufijo }: { entidad: string; entidadId: string; antes: Instantanea; despues: Instantanea; sufijo?: string },
  ) {
    const cambios = diferencias(antes, despues, sufijo);
    if (!cambios.length) return 0;
    try {
      await this.repo.insert(
        cambios.map((c) => ({ usuarioId: usuario.sub, rolCodigo: usuario.rol, entidad, entidadId, campo: c.campo, valorAnterior: c.anterior, valorNuevo: c.nuevo })),
      );
    } catch (error) {
      this.logger.error(`No se pudo registrar auditoría de ${entidad}#${entidadId}`, error as Error);
    }
    return cambios.length;
  }

  /**
   * Últimos movimientos que hizo la propia persona (Mi perfil). Un mismo guardado deja una fila por campo (HU-03);
   * aquí se muestran como un solo movimiento.
   */
  async actividadDe(usuarioId: string, limite = 10): Promise<Actividad[]> {
    const registros = await this.repo.find({ where: { usuarioId }, order: { ocurridoEn: 'DESC', id: 'DESC' }, take: limite * 8 });
    const vistos = new Set<string>();
    const actividad: Actividad[] = [];
    for (const r of registros) {
      const a = describirActividad(r);
      const clave = `${r.entidad}|${r.entidadId}|${a.descripcion}|${a.fecha.slice(0, 19)}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      actividad.push(a);
      if (actividad.length === limite) break;
    }
    return actividad;
  }

  /** HU-03 · Bitácora del Administrador: del más reciente al más antiguo, con filtros y paginación. */
  async listar(filtros: FiltrosBitacoraDto): Promise<PaginaBitacora> {
    const pagina = filtros.pagina ?? 1;
    const limite = filtros.limite ?? 50;
    const { where, valores } = condicionesBitacora(filtros);
    const desde = `FROM registro_auditoria a JOIN usuario u ON u.usuario_id = a.usuario_id ${where}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*) AS total ${desde}`, valores);
    const filas = await this.dataSource.query(
      `SELECT ${COLUMNAS} ${desde} ORDER BY a.ocurrido_en DESC, a.auditoria_id DESC LIMIT ? OFFSET ?`,
      [...valores, limite, (pagina - 1) * limite],
    );
    return { total: Number(total), pagina, limite, eventos: await this.conContexto(filas) };
  }

  /**
   * HU-03 · Línea de tiempo de una recomendación, de lo más antiguo a lo más reciente: su captura en el plan
   * (campo por campo) y su avance y evidencias en cada informe.
   */
  async historialRecomendacion(recomendacionId: string): Promise<EventoAuditoria[]> {
    validarId(recomendacionId, 'la recomendación');
    const filas = await this.dataSource.query(
      `SELECT ${COLUMNAS} FROM registro_auditoria a JOIN usuario u ON u.usuario_id = a.usuario_id
       WHERE a.entidad IN ('recomendacion', 'avance_recomendacion') AND a.entidad_id = ?
       ORDER BY a.ocurrido_en ASC, a.auditoria_id ASC`,
      [recomendacionId],
    );
    return this.conContexto(filas);
  }

  /** Texto legible de lo que se modificó, resuelto en una consulta por tipo de registro. */
  private async conContexto(filas: Array<Parameters<typeof aEvento>[0]>): Promise<EventoAuditoria[]> {
    const ids = (...entidades: string[]) => [...new Set(filas.filter((f) => entidades.includes(f.entidad)).map((f) => String(f.entidad_id)))];
    const consultar = async (lista: string[], sql: string): Promise<Map<string, string>> => {
      if (!lista.length) return new Map();
      const resultado: Array<{ id: string | number; texto: string }> = await this.dataSource.query(sql, [lista]);
      return new Map(resultado.map((r) => [String(r.id), r.texto]));
    };
    const [recomendaciones, planes, informes, ciclos, cuentas] = await Promise.all([
      consultar(ids('recomendacion', 'avance_recomendacion'), `SELECT r.recomendacion_id AS id, CONCAT(l.nombre, ' · Recomendación: ', LEFT(r.descripcion, 90)) AS texto
        FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
        JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id WHERE r.recomendacion_id IN (?)`),
      consultar(ids('version_plan'), `SELECT vp.version_plan_id AS id, CONCAT(l.nombre, ' · Plan de mejora ', c.nombre) AS texto
        FROM version_plan vp JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id WHERE vp.version_plan_id IN (?)`),
      consultar(ids('version_informe'), `SELECT vi.version_informe_id AS id, CONCAT(l.nombre, ' · Informe de seguimiento ', inf.nombre_periodo) AS texto
        FROM version_informe vi JOIN informe inf ON inf.informe_id = vi.informe_id JOIN ciclo_acreditacion c ON c.ciclo_id = inf.ciclo_id
        JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id WHERE vi.version_informe_id IN (?)`),
      consultar(ids('ciclo_acreditacion'), `SELECT c.ciclo_id AS id, CONCAT(l.nombre, ' · Ciclo ', c.nombre) AS texto
        FROM ciclo_acreditacion c JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id WHERE c.ciclo_id IN (?)`),
      consultar(ids('usuario'), `SELECT u.usuario_id AS id, CONCAT('Cuenta: ', u.nombre, ' ', u.apellido, ' (', u.correo, ')') AS texto FROM usuario u WHERE u.usuario_id IN (?)`),
    ]);
    const mapa: Record<string, Map<string, string>> = {
      recomendacion: recomendaciones,
      avance_recomendacion: recomendaciones,
      version_plan: planes,
      version_informe: informes,
      ciclo_acreditacion: ciclos,
      usuario: cuentas,
    };
    return filas.map((f) => aEvento(f, mapa[f.entidad]?.get(String(f.entidad_id)) ?? null));
  }
}

const COLUMNAS = `a.auditoria_id AS id, a.usuario_id, u.nombre, u.apellido, u.correo, a.rol_codigo, a.entidad, a.entidad_id, a.campo,
  a.valor_anterior, a.valor_nuevo, a.ocurrido_en,
  (SELECT l.nombre FROM licenciatura l WHERE l.licenciatura_id = ${LICENCIATURA_DEL_REGISTRO}) AS licenciatura`;

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('auditoria')
@Roles(Rol.ADMINISTRADOR)
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  /** HU-03 · Bitácora con filtros: rol, área, fechas (AAAA-MM-DD), búsqueda y licenciaturas (HU-13). */
  @Get()
  listar(@Query() filtros: FiltrosBitacoraDto) {
    return this.auditoria.listar(filtros);
  }

  /** HU-03 · Línea de tiempo de modificaciones de una recomendación (plan e informes). */
  @Get('recomendaciones/:id')
  historial(@Param('id') id: string) {
    return this.auditoria.historialRecomendacion(id);
  }
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RegistroAuditoria])],
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
