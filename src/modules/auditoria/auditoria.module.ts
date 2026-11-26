import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/auth';
import { Rol } from '../../common/enums';
import { RegistroAuditoria } from '../../database/entities';
import { Actividad, describirActividad } from './actividad';
import { diferencias, type Instantanea } from './cambios';

type Cambio = { entidad: string; entidadId: string; campo: string; anterior?: string | null; nuevo?: string | null };

/** Escribe en registro_auditoria (HU-03). Solo inserta: la base impide editar o borrar. */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(@InjectRepository(RegistroAuditoria) private readonly repo: Repository<RegistroAuditoria>) {}

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

  listar(filtros: { entidad?: string; desde?: string; hasta?: string; limite?: number }) {
    const q = this.repo.createQueryBuilder('a').orderBy('a.ocurridoEn', 'DESC').take(Math.min(filtros.limite ?? 50, 200));
    if (filtros.entidad) q.andWhere('a.entidad = :entidad', { entidad: filtros.entidad });
    if (filtros.desde) q.andWhere('a.ocurridoEn >= :desde', { desde: filtros.desde });
    if (filtros.hasta) q.andWhere('a.ocurridoEn <= :hasta', { hasta: filtros.hasta });
    return q.getMany();
  }
}

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('auditoria')
@Roles(Rol.ADMINISTRADOR)
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  listar(@Query('entidad') entidad?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('limite') limite?: string) {
    return this.auditoria.listar({ entidad, desde, hasta, limite: limite ? Number(limite) : undefined });
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
