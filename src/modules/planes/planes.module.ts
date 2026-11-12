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
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken, verificarLicenciatura } from '../../common/auth';
import { EstadoDocumento, Rol, TipoDocumento, TipoNotificacion } from '../../common/enums';
import { BitacoraService } from '../bitacora/bitacora.module';
import { NotificacionesModule, NotificacionesService } from '../notificaciones/notificaciones.module';
import { ObservacionesModule, ObservacionesService } from '../observaciones/observaciones.module';
import { CrearPlanDto, DevolverDto, EtiquetasDto, HitosDto, RecomendacionDto } from './dto';
import { Hito, Plan, Recomendacion } from './entities';

const EDITABLES = [EstadoDocumento.BORRADOR, EstadoDocumento.DEVUELTO];

/** Avance de un plan = promedio del % real de sus hitos. */
const avancePlan = (plan: Plan) => {
  const hitos = (plan.recomendaciones ?? []).flatMap((r) => r.hitos ?? []);
  return hitos.length ? Math.round(hitos.reduce((s, h) => s + h.porcentajeReal, 0) / hitos.length) : 0;
};

@Injectable()
export class PlanesService {
  constructor(
    @InjectRepository(Plan) private readonly planes: Repository<Plan>,
    @InjectRepository(Recomendacion) private readonly recomendaciones: Repository<Recomendacion>,
    private readonly dataSource: DataSource,
    private readonly bitacora: BitacoraService,
    private readonly notificaciones: NotificacionesService,
    private readonly observaciones: ObservacionesService,
  ) {}

  async listar(usuario: UsuarioToken) {
    const where = usuario.rol === Rol.ADMINISTRADOR ? {} : { licenciaturaId: usuario.licenciaturaId ?? '' };
    const planes = await this.planes.find({ where, relations: { recomendaciones: { hitos: true } }, order: { actualizadoEn: 'DESC' } });
    return planes.map((p) => ({
      id: p.id,
      licenciatura: p.licenciatura.nombre,
      organismo: p.licenciatura.organismo,
      ciclo: `${p.cicloInicio.slice(0, 4)}–${p.cicloFin.slice(0, 4)}`,
      recomendaciones: p.recomendaciones.length,
      avance: avancePlan(p),
      estado: p.estado,
      actualizado: p.actualizadoEn,
    }));
  }

  async obtener(id: string, usuario: UsuarioToken) {
    const plan = await this.planes.findOne({ where: { id }, relations: { recomendaciones: { hitos: true } }, order: { recomendaciones: { numero: 'ASC' } } });
    if (!plan) throw new NotFoundException('Plan no encontrado.');
    verificarLicenciatura(usuario, plan.licenciaturaId);
    return plan;
  }

  async crear(dto: CrearPlanDto, usuario: UsuarioToken) {
    verificarLicenciatura(usuario, dto.licenciaturaId);
    if (dto.cicloFin <= dto.cicloInicio) throw new BadRequestException('El fin del ciclo debe ser posterior al inicio.');
    const plan = await this.planes.save(this.planes.create(dto));
    await this.bitacora.registrar(usuario, 'PLAN_CREADO', 'Plan', plan.id, 'Plan creado en borrador');
    return plan;
  }

  private async editable(planId: string, usuario: UsuarioToken) {
    const plan = await this.obtener(planId, usuario);
    if (!EDITABLES.includes(plan.estado)) throw new ConflictException('El plan está en revisión o validado y no se puede editar.');
    return plan;
  }

  private validarFechas(plan: Plan, inicio: string, termino: string) {
    if (termino < inicio) throw new BadRequestException('La fecha de término debe ser posterior a la de inicio.');
    if (inicio < plan.cicloInicio || termino > plan.cicloFin) {
      throw new BadRequestException(`Las fechas deben estar dentro del ciclo de acreditación (${plan.cicloInicio} a ${plan.cicloFin}).`);
    }
  }

  async agregarRecomendacion(planId: string, dto: RecomendacionDto, usuario: UsuarioToken) {
    const plan = await this.editable(planId, usuario);
    this.validarFechas(plan, dto.fechaInicio, dto.fechaTermino);
    const numero = plan.recomendaciones.length + 1;
    const rec = await this.recomendaciones.save(this.recomendaciones.create({ ...dto, planId, numero }));
    await this.bitacora.registrar(usuario, 'RECOMENDACION_CREADA', 'Recomendacion', rec.id, `Recomendación ${numero} del plan`);
    return rec;
  }

  async actualizarRecomendacion(id: string, dto: RecomendacionDto, usuario: UsuarioToken) {
    const rec = await this.recomendaciones.findOneBy({ id });
    if (!rec) throw new NotFoundException('Recomendación no encontrada.');
    const plan = await this.editable(rec.planId, usuario);
    this.validarFechas(plan, dto.fechaInicio, dto.fechaTermino);
    await this.recomendaciones.update(id, dto);
    await this.bitacora.registrar(usuario, 'RECOMENDACION_EDITADA', 'Recomendacion', id, `Recomendación ${rec.numero} actualizada`);
    return this.recomendaciones.findOneBy({ id });
  }

  /** Reemplaza los hitos de una recomendación validando orden de fechas y % (HU-12). */
  async guardarHitos(recomendacionId: string, { hitos }: HitosDto, usuario: UsuarioToken) {
    const rec = await this.recomendaciones.findOneBy({ id: recomendacionId });
    if (!rec) throw new NotFoundException('Recomendación no encontrada.');
    await this.editable(rec.planId, usuario);
    hitos.forEach((h, i) => {
      if (h.fechaCompromiso < rec.fechaInicio || h.fechaCompromiso > rec.fechaTermino) {
        throw new BadRequestException(`El hito ${i + 1} debe estar entre ${rec.fechaInicio} y ${rec.fechaTermino}.`);
      }
      const anterior = hitos[i - 1];
      if (anterior && h.fechaCompromiso <= anterior.fechaCompromiso) throw new BadRequestException(`El hito ${i + 1} debe ser posterior al hito ${i}.`);
      if (anterior && h.porcentajeEsperado <= anterior.porcentajeEsperado) throw new BadRequestException(`El % esperado del hito ${i + 1} debe ser mayor que el del hito ${i}.`);
    });
    await this.dataSource.transaction(async (tx) => {
      await tx.delete(Hito, { recomendacionId });
      await tx.save(Hito, hitos.map((h) => tx.create(Hito, { ...h, recomendacionId })));
    });
    await this.bitacora.registrar(usuario, 'HITOS_CONFIGURADOS', 'Recomendacion', recomendacionId, `${hitos.length} hitos configurados`);
    return { recomendacionId, hitos: hitos.length };
  }

  async etiquetar(id: string, { etiquetas }: EtiquetasDto, usuario: UsuarioToken) {
    await this.recomendaciones.update(id, { etiquetas });
    await this.bitacora.registrar(usuario, 'RECOMENDACION_ETIQUETADA', 'Recomendacion', id, `Etiquetas: ${etiquetas.join(', ')}`);
    return { id, etiquetas };
  }

  async enviar(id: string, usuario: UsuarioToken) {
    const plan = await this.editable(id, usuario);
    if (!plan.recomendaciones.length) throw new BadRequestException('Agrega al menos una recomendación antes de enviar.');
    const sinHitos = plan.recomendaciones.filter((r) => !r.hitos?.length).map((r) => r.numero);
    if (sinHitos.length) throw new BadRequestException(`Configura hitos para las recomendaciones: ${sinHitos.join(', ')}.`);
    if (plan.estado === EstadoDocumento.DEVUELTO && (await this.observaciones.pendientes(TipoDocumento.PLAN, id)) > 0) {
      throw new BadRequestException('Atiende todas las observaciones antes de reenviar el plan.');
    }
    await this.planes.update(id, { estado: EstadoDocumento.EN_REVISION, enviadoEn: new Date() });
    await this.bitacora.registrar(usuario, 'PLAN_ENVIADO', 'Plan', id, `Estado: ${plan.estado} → EN_REVISION`);
    await this.notificaciones.notificarAdministradores({ tipo: TipoNotificacion.HITO, titulo: 'Plan por validar', descripcion: `${plan.licenciatura.nombre} envió su plan de mejora.`, enlace: `/admin/planes/${id}` });
    return { id, estado: EstadoDocumento.EN_REVISION };
  }

  private async enRevision(id: string, usuario: UsuarioToken) {
    const plan = await this.obtener(id, usuario);
    if (plan.estado !== EstadoDocumento.EN_REVISION) throw new ConflictException('Solo se pueden validar o devolver planes en revisión.');
    return plan;
  }

  /** Validar bloquea la edición posterior (HU-05). */
  async validar(id: string, usuario: UsuarioToken) {
    const plan = await this.enRevision(id, usuario);
    await this.planes.update(id, { estado: EstadoDocumento.VALIDADO, validadoEn: new Date() });
    await this.bitacora.registrar(usuario, 'PLAN_VALIDADO', 'Plan', id, 'Estado: EN_REVISION → VALIDADO');
    await this.notificaciones.notificarLicenciatura(plan.licenciaturaId, { tipo: TipoNotificacion.DEVOLUCION, titulo: 'Plan validado', descripcion: 'Tu plan de mejora fue validado.', enlace: '/licenciatura/dashboard' });
    return { id, estado: EstadoDocumento.VALIDADO };
  }

  async devolver(id: string, dto: DevolverDto, usuario: UsuarioToken) {
    const plan = await this.enRevision(id, usuario);
    const observaciones = dto.observaciones ?? [];
    const ids = new Set(plan.recomendaciones.map((r) => r.id));
    if (observaciones.some((o) => !ids.has(o.recomendacionId))) throw new BadRequestException('Una observación apunta a una recomendación de otro plan.');
    await this.observaciones.crear({ tipoDocumento: TipoDocumento.PLAN, documentoId: id, licenciaturaId: plan.licenciaturaId, autorId: usuario.sub, mensaje: dto.motivo, observaciones });
    await this.planes.update(id, { estado: EstadoDocumento.DEVUELTO });
    await this.bitacora.registrar(usuario, 'PLAN_DEVUELTO', 'Plan', id, `Estado: EN_REVISION → DEVUELTO (${observaciones.length} observaciones)`);
    await this.notificaciones.notificarLicenciatura(plan.licenciaturaId, { tipo: TipoNotificacion.DEVOLUCION, titulo: 'Plan devuelto', descripcion: `La Administración devolvió tu plan con ${observaciones.length} observaciones.`, enlace: '/licenciatura/observaciones' });
    return { id, estado: EstadoDocumento.DEVUELTO };
  }
}

@ApiTags('Planes de mejora')
@ApiBearerAuth()
@Controller()
export class PlanesController {
  constructor(private readonly servicio: PlanesService) {}

  @Get('planes')
  listar(@UsuarioActual() u: UsuarioToken) {
    return this.servicio.listar(u);
  }

  @Get('planes/:id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.obtener(id, u);
  }

  @Post('planes')
  @Roles(Rol.CAPTURISTA, Rol.ADMINISTRADOR)
  crear(@Body() dto: CrearPlanDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.crear(dto, u);
  }

  /** Capturista y Auxiliar capturan el plan de forma colaborativa. */
  @Post('planes/:id/recomendaciones')
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  agregarRecomendacion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecomendacionDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.agregarRecomendacion(id, dto, u);
  }

  @Put('recomendaciones/:id')
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  actualizarRecomendacion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecomendacionDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.actualizarRecomendacion(id, dto, u);
  }

  /** Solo el Capturista configura hitos (el Auxiliar no tiene esta pantalla). */
  @Put('recomendaciones/:id/hitos')
  @Roles(Rol.CAPTURISTA)
  guardarHitos(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HitosDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.guardarHitos(id, dto, u);
  }

  @Patch('recomendaciones/:id/etiquetas')
  @Roles(Rol.ADMINISTRADOR)
  etiquetar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EtiquetasDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.etiquetar(id, dto, u);
  }

  @Post('planes/:id/enviar')
  @HttpCode(200)
  @Roles(Rol.CAPTURISTA)
  enviar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.enviar(id, u);
  }

  @Post('planes/:id/validar')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  validar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.validar(id, u);
  }

  @Post('planes/:id/devolver')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  devolver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DevolverDto, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.devolver(id, dto, u);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Plan, Recomendacion, Hito]), NotificacionesModule, ObservacionesModule],
  controllers: [PlanesController],
  providers: [PlanesService],
  exports: [TypeOrmModule],
})
export class PlanesModule {}
