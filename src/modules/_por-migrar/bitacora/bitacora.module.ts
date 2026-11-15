import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Repository } from 'typeorm';
import { Roles, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';

/** Bitácora inmutable (HU-03): solo se inserta; no hay endpoints de edición ni borrado. */
@Entity('bitacora')
export class EventoBitacora {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn({ name: 'fecha' })
  fecha: Date;

  @Column({ name: 'usuario_id', nullable: true })
  usuarioId: string | null;

  @Column({ length: 160 })
  correo: string;

  @Column({ type: 'enum', enum: Rol })
  rol: Rol;

  /** Ej. "PLAN_VALIDADO", "EVIDENCIA_SUBIDA" */
  @Column({ length: 60 })
  accion: string;

  @Column({ length: 60 })
  entidad: string;

  @Column({ name: 'entidad_id', length: 36, nullable: true })
  entidadId: string | null;

  /** Descripción legible del cambio, ej. "Estado: En revisión → Validado". */
  @Column({ type: 'text' })
  detalle: string;
}

@Injectable()
export class BitacoraService {
  constructor(@InjectRepository(EventoBitacora) private readonly repo: Repository<EventoBitacora>) {}

  registrar(usuario: UsuarioToken | null, accion: string, entidad: string, entidadId: string | null, detalle: string) {
    return this.repo.insert({
      usuarioId: usuario?.sub ?? null,
      correo: usuario?.correo ?? 'sistema',
      rol: usuario?.rol ?? Rol.ADMINISTRADOR,
      accion,
      entidad,
      entidadId,
      detalle,
    });
  }

  listar(filtros: { desde?: string; hasta?: string; rol?: Rol; limite?: number }) {
    const q = this.repo.createQueryBuilder('b').orderBy('b.fecha', 'DESC').take(Math.min(filtros.limite ?? 50, 200));
    if (filtros.desde) q.andWhere('b.fecha >= :desde', { desde: filtros.desde });
    if (filtros.hasta) q.andWhere('b.fecha <= :hasta', { hasta: filtros.hasta });
    if (filtros.rol) q.andWhere('b.rol = :rol', { rol: filtros.rol });
    return q.getMany();
  }
}

@ApiTags('Bitácora')
@ApiBearerAuth()
@Controller('bitacora')
@Roles(Rol.ADMINISTRADOR)
export class BitacoraController {
  constructor(private readonly bitacora: BitacoraService) {}

  @Get()
  listar(@Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('rol') rol?: Rol, @Query('limite') limite?: string) {
    return this.bitacora.listar({ desde, hasta, rol, limite: limite ? Number(limite) : undefined });
  }
}

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EventoBitacora])],
  controllers: [BitacoraController],
  providers: [BitacoraService],
  exports: [BitacoraService],
})
export class BitacoraModule {}
