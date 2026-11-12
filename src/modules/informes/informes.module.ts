import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  NotImplementedException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, OneToMany, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken, verificarLicenciatura } from '../../common/auth';
import { Base } from '../../common/base.entity';
import { EstadoDocumento, Rol, TipoDocumento, TipoNotificacion } from '../../common/enums';
import { BitacoraService } from '../bitacora/bitacora.module';
import { NotificacionesModule, NotificacionesService } from '../notificaciones/notificaciones.module';
import { ObservacionesModule, ObservacionesService } from '../observaciones/observaciones.module';
import { DevolverDto } from '../planes/dto';
import { Hito, Plan } from '../planes/entities';
import { PlanesModule } from '../planes/planes.module';

/** Informe de seguimiento de un plan validado (HU-07, HU-08). */
@Entity('informes')
export class Informe extends Base {
  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id' })
  planId: string;

  /** Ej. "2026-2" */
  @Column({ length: 10 })
  periodo: string;

  @Column({ name: 'fecha_corte', type: 'date' })
  fechaCorte: string;

  @Column({ type: 'enum', enum: EstadoDocumento, default: EstadoDocumento.BORRADOR })
  estado: EstadoDocumento;

  @Column({ name: 'enviado_en', type: 'datetime', nullable: true })
  enviadoEn: Date | null;

  @OneToMany(() => AvanceReportado, (a) => a.informe, { cascade: true, eager: true })
  avances: AvanceReportado[];
}

@Entity('avances_reportados')
export class AvanceReportado extends Base {
  @ManyToOne(() => Informe, (i) => i.avances, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'informe_id' })
  informe: Informe;

  @Column({ name: 'hito_id' })
  hitoId: string;

  @Column({ name: 'porcentaje_real', type: 'tinyint' })
  porcentajeReal: number;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;
}

class CrearInformeDto {
  @IsUUID()
  planId: string;

  @Matches(/^\d{4}-[12]$/, { message: 'El periodo debe tener el formato AAAA-1 o AAAA-2.' })
  periodo: string;

  @IsDateString()
  fechaCorte: string;
}

class AvanceDto {
  @IsUUID()
  hitoId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  porcentajeReal: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  comentario?: string;
}

class AvancesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvanceDto)
  avances: AvanceDto[];
}

@Injectable()
export class InformesService {
  constructor(
    @InjectRepository(Informe) private readonly informes: Repository<Informe>,
    @InjectRepository(AvanceReportado) private readonly avances: Repository<AvanceReportado>,
    @InjectRepository(Plan) private readonly planes: Repository<Plan>,
    @InjectRepository(Hito) private readonly hitos: Repository<Hito>,
    private readonly dataSource: DataSource,
    private readonly bitacora: BitacoraService,
    private readonly notificaciones: NotificacionesService,
    private readonly observaciones: ObservacionesService,
  ) {}

  async listar(usuario: UsuarioToken) {
    const informes = await this.informes.find({ order: { creadoEn: 'DESC' } });
    const visibles = usuario.rol === Rol.ADMINISTRADOR ? informes : informes.filter((i) => i.plan.licenciaturaId === usuario.licenciaturaId);
    const totales = await Promise.all(
      visibles.map((i) => this.hitos.count({ where: { recomendacion: { planId: i.planId } } })),
    );
    return visibles.map((i, n) => ({
      id: i.id,
      licenciatura: i.plan.licenciatura.nombre,
      periodo: i.periodo,
      hitosReportados: i.avances.length,
      hitosTotales: totales[n],
      fechaEnvio: i.enviadoEn,
      estado: i.estado,
    }));
  }

  async obtener(id: string, usuario: UsuarioToken) {
    const informe = await this.informes.findOneBy({ id });
    if (!informe) throw new NotFoundException('Informe no encontrado.');
    verificarLicenciatura(usuario, informe.plan.licenciaturaId);
    return informe;
  }

  async crear(dto: CrearInformeDto, usuario: UsuarioToken) {
    const plan = await this.planes.findOneBy({ id: dto.planId });
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    verificarLicenciatura(usuario, plan.licenciaturaId);
    if (plan.estado !== EstadoDocumento.VALIDADO) throw new BadRequestException('Solo se pueden crear informes de planes validados.');
    const informe = await this.informes.save(this.informes.create(dto));
    await this.bitacora.registrar(usuario, 'INFORME_CREADO', 'Informe', informe.id, `Informe ${dto.periodo}`);
    return informe;
  }

  async guardarAvances(id: string, { avances }: AvancesDto, usuario: UsuarioToken) {
    const informe = await this.obtener(id, usuario);
    if (![EstadoDocumento.BORRADOR, EstadoDocumento.DEVUELTO].includes(informe.estado)) throw new ConflictException('El informe ya fue enviado.');
    await this.dataSource.transaction(async (tx) => {
      await tx.delete(AvanceReportado, { informe: { id } });
      await tx.save(AvanceReportado, avances.map((a) => tx.create(AvanceReportado, { ...a, comentario: a.comentario ?? null, informe: { id } })));
    });
    await this.bitacora.registrar(usuario, 'AVANCE_REPORTADO', 'Informe', id, `${avances.length} hitos reportados`);
    return { id, avances: avances.length };
  }

  async enviar(id: string, usuario: UsuarioToken) {
    const informe = await this.obtener(id, usuario);
    if (!informe.avances.length) throw new BadRequestException('Reporta el avance de al menos un hito antes de enviar.');
    await this.informes.update(id, { estado: EstadoDocumento.EN_REVISION, enviadoEn: new Date() });
    await this.bitacora.registrar(usuario, 'INFORME_ENVIADO', 'Informe', id, 'Estado → EN_REVISION');
    await this.notificaciones.notificarAdministradores({ tipo: TipoNotificacion.HITO, titulo: 'Informe por validar', descripcion: `${informe.plan.licenciatura.nombre} envió su informe ${informe.periodo}.`, enlace: `/admin/informes/${id}` });
    return { id, estado: EstadoDocumento.EN_REVISION };
  }

  /** Al validar, el % real de cada hito se actualiza con lo reportado. */
  async validar(id: string, usuario: UsuarioToken) {
    const informe = await this.obtener(id, usuario);
    if (informe.estado !== EstadoDocumento.EN_REVISION) throw new ConflictException('Solo se validan informes en revisión.');
    await this.dataSource.transaction(async (tx) => {
      for (const a of informe.avances) await tx.update(Hito, a.hitoId, { porcentajeReal: a.porcentajeReal });
      await tx.update(Informe, id, { estado: EstadoDocumento.VALIDADO });
    });
    await this.bitacora.registrar(usuario, 'INFORME_VALIDADO', 'Informe', id, 'Estado: EN_REVISION → VALIDADO');
    await this.notificaciones.notificarLicenciatura(informe.plan.licenciaturaId, { tipo: TipoNotificacion.DEVOLUCION, titulo: 'Informe validado', descripcion: `Tu informe ${informe.periodo} fue validado.`, enlace: '/licenciatura/dashboard' });
    return { id, estado: EstadoDocumento.VALIDADO };
  }

  async devolver(id: string, dto: DevolverDto, usuario: UsuarioToken) {
    const informe = await this.obtener(id, usuario);
    if (informe.estado !== EstadoDocumento.EN_REVISION) throw new ConflictException('Solo se devuelven informes en revisión.');
    const observaciones = dto.observaciones ?? [];
    await this.observaciones.crear({ tipoDocumento: TipoDocumento.INFORME, documentoId: id, licenciaturaId: informe.plan.licenciaturaId, autorId: usuario.sub, mensaje: dto.motivo, observaciones });
    await this.informes.update(id, { estado: EstadoDocumento.DEVUELTO });
    await this.bitacora.registrar(usuario, 'INFORME_DEVUELTO', 'Informe', id, `Estado: EN_REVISION → DEVUELTO (${observaciones.length} observaciones)`);
    await this.notificaciones.notificarLicenciatura(informe.plan.licenciaturaId, { tipo: TipoNotificacion.DEVOLUCION, titulo: 'Informe devuelto', descripcion: `Tu informe ${informe.periodo} tiene observaciones.`, enlace: '/licenciatura/observaciones' });
    return { id, estado: EstadoDocumento.DEVUELTO };
  }
}

@ApiTags('Informes de seguimiento')
@ApiBearerAuth()
@Controller('informes')
export class InformesController {
  constructor(private readonly servicio: InformesService) {}

  @Get()
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.servicio.listar(u);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.obtener(id, u);
  }

  /** PDF del informe con evidencias, para el visor integrado (HU-08) y el Anexo 2 (HU-09). */
  @Get(':id/pdf')
  pdf() {
    // TODO(HU-09): generar el PDF oficial (encabezado con licenciatura, organismo, fecha e imagen institucional) y unirlo con las evidencias.
    throw new NotImplementedException('La generación del PDF del informe está pendiente (HU-09).');
  }

  @Post()
  @Roles(Rol.CAPTURISTA)
  crear(@Body() dto: CrearInformeDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.crear(dto, u);
  }

  @Put(':id/avances')
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  avances(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AvancesDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.guardarAvances(id, dto, u);
  }

  @Post(':id/enviar')
  @HttpCode(200)
  @Roles(Rol.CAPTURISTA)
  enviar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.enviar(id, u);
  }

  @Post(':id/validar')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  validar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.validar(id, u);
  }

  @Post(':id/devolver')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  devolver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DevolverDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.devolver(id, dto, u);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Informe, AvanceReportado]), PlanesModule, NotificacionesModule, ObservacionesModule],
  controllers: [InformesController],
  providers: [InformesService],
})
export class InformesModule {}
