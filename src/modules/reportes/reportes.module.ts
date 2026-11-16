// HU-15 · Resumen general de atención por estatus de cumplimiento.
// Responsable: Desarrollador/a 3. Ver la lista de tareas en CONTRIBUTING.md.
import { Controller, Get, Injectable, Module, NotImplementedException, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../../common/auth';
import { Rol } from '../../common/enums';
import { Recomendacion } from '../../database/plan.entities';
import { ConteoAtencion } from './reglas';

// ---------- Contrato (debe coincidir con AtencionLicenciatura en ssm-frontend/src/lib/types.ts) ----------

export type AtencionLicenciatura = ConteoAtencion & { licenciatura: string };

// ---------- Servicio ----------

@Injectable()
export class ReportesService {
  constructor(@InjectRepository(Recomendacion) private readonly recomendaciones: Repository<Recomendacion>) {}

  // TODO(HU-15) resumenAtencion():
  //   1. Recomendaciones de la última version_plan APROBADA del ciclo VIGENTE de cada licenciatura.
  //   2. Para cada recomendación, el porcentaje del ÚLTIMO INFORME CAPTURADO (decisión D3 del 16/11/2026):
  //      la version_informe más reciente del informe más reciente del ciclo, en cualquier estado
  //      (BORRADOR, EN_REVISION, DEVUELTO o APROBADO). Ver docs/decisiones.md.
  //   3. contarPorEstatus() por licenciatura. Si llega licenciaturaId, filtrar solo esa.
  //   Pista: un QueryBuilder sobre `recomendacion` con joins a indicador → version_plan → ciclo_acreditacion → licenciatura
  //   y un LEFT JOIN a avance_recomendacion. Los datos de prueba vienen en db/datos_desarrollo.sql.
  resumenAtencion(_licenciaturaId?: string): Promise<AtencionLicenciatura[]> {
    void this.recomendaciones;
    throw new NotImplementedException('HU-15: resumen de atención pendiente');
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
  @ApiQuery({ name: 'licenciaturaId', required: false })
  atencion(@Query('licenciaturaId') licenciaturaId?: string) {
    return this.servicio.resumenAtencion(licenciaturaId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Recomendacion])],
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
