import { Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Base } from '../../common/base.entity';
import { Rol, TipoDocumento } from '../../common/enums';

/** Devolución de un plan o informe con observaciones por recomendación (HU-05, HU-08). */
@Entity('devoluciones')
export class Devolucion extends Base {
  @Column({ name: 'tipo_documento', type: 'enum', enum: TipoDocumento })
  tipoDocumento: TipoDocumento;

  @Column({ name: 'documento_id' })
  documentoId: string;

  @Column({ name: 'licenciatura_id' })
  licenciaturaId: string;

  @Column({ name: 'autor_id' })
  autorId: string;

  /** Motivo general escrito en el modal de confirmación. */
  @Column({ type: 'text' })
  mensaje: string;

  @OneToMany(() => ObservacionItem, (i) => i.devolucion, { cascade: true, eager: true })
  items: ObservacionItem[];
}

@Entity('observaciones')
export class ObservacionItem extends Base {
  @ManyToOne(() => Devolucion, (d) => d.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'devolucion_id' })
  devolucion: Devolucion;

  @Column({ name: 'recomendacion_id' })
  recomendacionId: string;

  @Column({ type: 'text' })
  texto: string;

  @Column({ default: false })
  atendida: boolean;
}

@Injectable()
export class ObservacionesService {
  constructor(
    @InjectRepository(Devolucion) private readonly devoluciones: Repository<Devolucion>,
    @InjectRepository(ObservacionItem) private readonly items: Repository<ObservacionItem>,
  ) {}

  crear(datos: { tipoDocumento: TipoDocumento; documentoId: string; licenciaturaId: string; autorId: string; mensaje: string; observaciones: { recomendacionId: string; texto: string }[] }) {
    const { observaciones, ...resto } = datos;
    return this.devoluciones.save(this.devoluciones.create({ ...resto, items: observaciones.map((o) => this.items.create(o)) }));
  }

  listarPorLicenciatura(licenciaturaId: string) {
    return this.devoluciones.find({ where: { licenciaturaId }, order: { creadoEn: 'DESC' } });
  }

  async pendientes(tipoDocumento: TipoDocumento, documentoId: string) {
    const devs = await this.devoluciones.find({ where: { tipoDocumento, documentoId } });
    return devs.flatMap((d) => d.items).filter((i) => !i.atendida).length;
  }

  async atender(itemId: string, usuario: UsuarioToken) {
    const item = await this.items.findOne({ where: { id: itemId }, relations: { devolucion: true } });
    if (!item) throw new NotFoundException('Observación no encontrada.');
    if (item.devolucion.licenciaturaId !== usuario.licenciaturaId) throw new ForbiddenException();
    await this.items.update(itemId, { atendida: true });
    return { id: itemId, atendida: true };
  }
}

@ApiTags('Observaciones')
@ApiBearerAuth()
@Controller('observaciones')
export class ObservacionesController {
  constructor(private readonly servicio: ObservacionesService) {}

  /** Historial de devoluciones de la licenciatura del usuario (pantalla 19). */
  @Get()
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  listar(@UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.listarPorLicenciatura(usuario.licenciaturaId ?? '');
  }

  @Get('licenciatura/:id')
  @Roles(Rol.ADMINISTRADOR)
  listarAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicio.listarPorLicenciatura(id);
  }

  @Patch('items/:id/atender')
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  atender(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: UsuarioToken) {
    return this.servicio.atender(id, usuario);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Devolucion, ObservacionItem])],
  controllers: [ObservacionesController],
  providers: [ObservacionesService],
  exports: [ObservacionesService],
})
export class ObservacionesModule {}
