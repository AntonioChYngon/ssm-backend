// HU-04 · Captura del Plan de Mejora Continua.
// Responsable: Desarrollador/a 2. Ver la lista de tareas en CONTRIBUTING.md.
import { Body, Controller, Get, Injectable, Module, NotImplementedException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AreaResponsable, Categoria, OrganismoAcreditador } from '../../database/plan.entities';

// ---------- Contrato (debe coincidir con ssm-frontend/src/lib/types.ts) ----------

export type ItemCatalogo = { id: string; nombre: string };
export type Catalogos = { categorias: ItemCatalogo[]; areas: ItemCatalogo[]; organismos: ItemCatalogo[] };

export class NuevaRecomendacionDto {
  @IsString() categoriaId: string;

  /** Usa un indicador existente del plan, o escribe uno nuevo. */
  @IsOptional() @IsString() indicadorId?: string;
  @ValidateIf((o: NuevaRecomendacionDto) => !o.indicadorId) @IsString() @Length(3, 2000) indicador?: string;

  @IsString() @Length(3, 4000) descripcion: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) @Type(() => String) acciones: string[];
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) @Type(() => String) metas: string[];
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) areaIds: string[];
  @IsDateString() fechaCumplimiento: string;
  @IsOptional() @IsString() @Length(0, 80) etiquetaFecha?: string;
}

// ---------- Servicio ----------

@Injectable()
export class PlanesService {
  constructor(
    @InjectRepository(Categoria) private readonly categorias: Repository<Categoria>,
    @InjectRepository(AreaResponsable) private readonly areas: Repository<AreaResponsable>,
    @InjectRepository(OrganismoAcreditador) private readonly organismos: Repository<OrganismoAcreditador>,
  ) {}

  /** Ya funciona: catálogos para los selectores del formulario. */
  async catalogos(): Promise<Catalogos> {
    const [categorias, areas, organismos] = await Promise.all([
      this.categorias.find({ where: { activa: true }, order: { orden: 'ASC' } }),
      this.areas.find({ where: { activa: true }, order: { nombre: 'ASC' } }),
      this.organismos.find({ where: { activo: true }, order: { nombre: 'ASC' } }),
    ]);
    const item = (x: { id: string; nombre: string }) => ({ id: x.id, nombre: x.nombre });
    return { categorias: categorias.map(item), areas: areas.map(item), organismos: organismos.map(item) };
  }

  // TODO(HU-04) planDeMiCiclo(): buscar el ciclo VIGENTE de la coordinación del usuario y su última
  //   version_plan con indicadores → recomendaciones → acciones, metas y áreas.
  //   Usa verificarCoordinacion() para que Captura/Auxiliar solo vean su licenciatura.
  planDelCiclo(_usuario: UsuarioToken, _cicloId: string): Promise<unknown> {
    throw new NotImplementedException('HU-04: consulta del plan pendiente');
  }

  // TODO(HU-04) agregarRecomendacion(), en una transacción:
  //   1. El plan debe estar en BORRADOR o DEVUELTO (si no existe, crear version_plan numero 1).
  //   2. validarFechaCumplimiento() contra vigencia_inicio/vigencia_fin del ciclo.
  //   3. Crear o reutilizar el indicador, luego recomendacion, accion_recomendacion, meta y recomendacion_area.
  //   4. Registrar el cambio en AuditoriaService.
  agregarRecomendacion(_usuario: UsuarioToken, _cicloId: string, _dto: NuevaRecomendacionDto): Promise<unknown> {
    throw new NotImplementedException('HU-04: captura de recomendación pendiente');
  }
}

// ---------- Controlador ----------

@ApiTags('HU-04 · Plan de mejora')
@ApiBearerAuth()
@Controller()
export class PlanesController {
  constructor(private readonly servicio: PlanesService) {}

  @Get('catalogos')
  catalogos() {
    return this.servicio.catalogos();
  }

  @Get('ciclos/:cicloId/plan')
  plan(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string) {
    return this.servicio.planDelCiclo(usuario, cicloId);
  }

  @Post('ciclos/:cicloId/plan/recomendaciones')
  @Roles(Rol.CAPTURA, Rol.AUXILIAR)
  agregar(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string, @Body() dto: NuevaRecomendacionDto) {
    return this.servicio.agregarRecomendacion(usuario, cicloId, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Categoria, AreaResponsable, OrganismoAcreditador])],
  controllers: [PlanesController],
  providers: [PlanesService],
})
export class PlanesModule {}
