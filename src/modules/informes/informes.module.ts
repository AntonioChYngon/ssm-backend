// Bloque Informe de Seguimiento: HU-07 (captura), HU-08 (revisión), HU-11 (aviso de entrega).
// Este archivo solo une las piezas. Cada historia trabaja en su propio archivo para no pisarse:
//   consulta.service.ts  · base compartida (lectura, permisos, InformeDetalle)
//   captura.service.ts   · HU-07 (línea A): iniciar, avances, enlaces, enviar          → pendiente
//   evidencias.service.ts· HU-07 (línea A): subida, conversión, baja                   → pendiente
//   revision.service.ts  · HU-08 + HU-11 (línea B): validar, devolver, reabrir, avisos → pendiente
import { Controller, Get, Module, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AvanceRecomendacion, CicloAcreditacion, Evidencia, Informe, RevisionInforme, VersionInforme, VersionPlan } from '../../database/plan.entities';
import { proveedorCarpetas } from '../planes/carpetas';
import { ConsultaInformesService } from './consulta.service';
import { FiltrosInformesDto } from './contrato';
import { conversorPdf } from './conversor';

const CAPTURA = [Rol.CAPTURA, Rol.AUXILIAR];

@ApiTags('Informe de seguimiento')
@ApiBearerAuth()
@Controller()
export class InformesController {
  constructor(private readonly consulta: ConsultaInformesService) {}

  /** Listado: el Administrador ve todos; Captura y Auxiliar, los de su licenciatura. */
  @Get('informes')
  listar(@UsuarioActual() usuario: UsuarioToken, @Query() filtros: FiltrosInformesDto) {
    return this.consulta.listar(usuario, filtros);
  }

  /** Va antes de informes/:id para que "mio" no se lea como id. */
  @Get('informes/mio')
  @Roles(...CAPTURA)
  mio(@UsuarioActual() usuario: UsuarioToken) {
    return this.consulta.mio(usuario);
  }

  @Get('informes/:id')
  obtener(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.consulta.obtener(usuario, id);
  }

  /** PDF de una evidencia guardada en la carpeta local. El navegador lo abre como blob: en una pestaña nueva. */
  @Get('evidencias/:id/archivo')
  async archivo(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    const { contenido, tamano, nombre } = await this.consulta.archivoEvidencia(usuario, id);
    return new StreamableFile(contenido, {
      type: 'application/pdf',
      length: tamano,
      disposition: `inline; filename="${encodeURIComponent(nombre)}"`,
    });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Informe, VersionInforme, AvanceRecomendacion, Evidencia, RevisionInforme, CicloAcreditacion, VersionPlan])],
  controllers: [InformesController],
  providers: [ConsultaInformesService, proveedorCarpetas, conversorPdf],
  exports: [ConsultaInformesService],
})
export class InformesModule {}
