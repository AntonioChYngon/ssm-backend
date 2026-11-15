import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/auth';
import { Rol } from '../../common/enums';
import { RegistroAuditoria } from '../../database/entities';

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
