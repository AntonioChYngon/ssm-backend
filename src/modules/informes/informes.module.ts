// Bloque Informe de Seguimiento: HU-07 (captura), HU-08 (revisión), HU-11 (aviso de entrega).
// Este archivo solo une las piezas. Cada historia trabaja en su propio archivo para no pisarse:
//   consulta.service.ts  · base compartida (lectura, permisos, InformeDetalle)
//   captura.service.ts   · HU-07: iniciar el semestre, avances, enlaces, quitar evidencias y enviar
//   evidencias.service.ts· HU-07: subida de archivos y conversión a PDF
//   revision.service.ts  · HU-08 + HU-11: validar, devolver, reabrir y aviso de entrega
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { AvanceRecomendacion, CicloAcreditacion, Evidencia, Informe, RevisionInforme, VersionInforme, VersionPlan } from '../../database/plan.entities';
import { proveedorCarpetas } from '../planes/carpetas';
import { generarDocxReporte } from '../planes/membrete/reporte-docx';
import { generarPdfReporte } from '../planes/membrete/reporte-pdf';
import { CapturaInformesService } from './captura.service';
import { ConsultaInformesService } from './consulta.service';
import { AvanceDto, DevolverInformeDto, EnlaceDto, FiltrosInformesDto, ReabrirInformeDto, ValidarInformeDto } from './contrato';
import { conversorPdf } from './conversor';
import { type ArchivoSubido, EvidenciasInformesService, megasEvidencia } from './evidencias.service';
import { nombreArchivoInforme, reporteInforme } from './reporte';
import { RevisionInformesService } from './revision.service';

const CAPTURA = [Rol.CAPTURA, Rol.AUXILIAR];

@ApiTags('Informe de seguimiento')
@ApiBearerAuth()
@Controller()
export class InformesController {
  constructor(
    private readonly consulta: ConsultaInformesService,
    private readonly revision: RevisionInformesService,
    private readonly captura: CapturaInformesService,
    private readonly evidencias: EvidenciasInformesService,
    private readonly config: ConfigService,
  ) {}

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

  // ----- HU-09 · Exportación (Administrador y la coordinación de esa licenciatura) -----

  /** Informe de Seguimiento en PDF con membrete y evidencias como hipervínculos. */
  @Get('informes/:id/pdf')
  async exportarPdf(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    const informe = await this.consulta.obtener(usuario, id);
    return new StreamableFile(generarPdfReporte(reporteInforme(informe, this.frontendUrl())), {
      type: 'application/pdf',
      disposition: `attachment; filename="${nombreArchivoInforme(informe)}.pdf"`,
    });
  }

  /** El mismo reporte en Word editable (.docx). */
  @Get('informes/:id/docx')
  async exportarWord(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    const informe = await this.consulta.obtener(usuario, id);
    return new StreamableFile(generarDocxReporte(reporteInforme(informe, this.frontendUrl())), {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="${nombreArchivoInforme(informe)}.docx"`,
    });
  }

  private frontendUrl() {
    return this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  // ----- HU-07 · Captura (Captura y Auxiliar) -----

  /** "Iniciar informe del semestre": si ya existe, devuelve el mismo. */
  @Post('ciclos/:cicloId/informes')
  @Roles(...CAPTURA)
  iniciar(@UsuarioActual() usuario: UsuarioToken, @Param('cicloId') cicloId: string) {
    return this.captura.iniciar(usuario, cicloId);
  }

  @Put('informes/:id/avances/:recomendacionId')
  @Roles(...CAPTURA)
  guardarAvance(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Param('recomendacionId') recomendacionId: string, @Body() dto: AvanceDto) {
    return this.captura.guardarAvance(usuario, id, recomendacionId, dto);
  }

  /** Plan A: archivo (.pdf, .docx, .xlsx, .pptx) en el campo "archivo". Multer lo deja en memoria; nunca toca el disco sin validar. */
  @Post('informes/:id/avances/:recomendacionId/evidencias')
  @Roles(...CAPTURA)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: megasEvidencia() * 1024 * 1024, files: 1 } }))
  subirEvidencia(
    @UsuarioActual() usuario: UsuarioToken,
    @Param('id') id: string,
    @Param('recomendacionId') recomendacionId: string,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ) {
    if (!archivo) throw new BadRequestException('Adjunta un archivo en el campo "archivo".');
    return this.evidencias.subir(usuario, id, recomendacionId, archivo);
  }

  /** Plan B: enlace http(s). */
  @Post('informes/:id/avances/:recomendacionId/enlaces')
  @Roles(...CAPTURA)
  agregarEnlace(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Param('recomendacionId') recomendacionId: string, @Body() dto: EnlaceDto) {
    return this.captura.agregarEnlace(usuario, id, recomendacionId, dto);
  }

  @Delete('evidencias/:id')
  @Roles(...CAPTURA)
  quitarEvidencia(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.captura.quitarEvidencia(usuario, id);
  }

  @Post('informes/:id/enviar')
  @HttpCode(200)
  @Roles(...CAPTURA)
  enviar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.captura.enviar(usuario, id);
  }

  // ----- HU-08 · Revisión (solo Administrador) -----

  @Post('informes/:id/validar')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  validar(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: ValidarInformeDto) {
    return this.revision.validar(usuario, id, dto);
  }

  @Post('informes/:id/devolver')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  devolver(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: DevolverInformeDto) {
    return this.revision.devolver(usuario, id, dto);
  }

  @Post('informes/:id/reabrir')
  @HttpCode(200)
  @Roles(Rol.ADMINISTRADOR)
  reabrir(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string, @Body() dto: ReabrirInformeDto) {
    return this.revision.reabrir(usuario, id, dto);
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
  providers: [ConsultaInformesService, RevisionInformesService, CapturaInformesService, EvidenciasInformesService, proveedorCarpetas, conversorPdf],
  exports: [ConsultaInformesService],
})
export class InformesModule {}
