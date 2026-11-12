import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsUUID } from 'class-validator';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Column, Entity, Index, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken, verificarLicenciatura } from '../../common/auth';
import { Base } from '../../common/base.entity';
import { EstadoEvidencia, Rol } from '../../common/enums';
import { BitacoraService } from '../bitacora/bitacora.module';
import { Hito } from '../planes/entities';
import { PlanesModule } from '../planes/planes.module';

const run = promisify(execFile);

export const EXTENSIONES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png'];

@Entity('evidencias')
export class Evidencia extends Base {
  @Index()
  @Column({ name: 'hito_id' })
  hitoId: string;

  @Column({ name: 'licenciatura_id' })
  licenciaturaId: string;

  @Column({ name: 'nombre_original', length: 255 })
  nombreOriginal: string;

  @Column({ name: 'tamano_bytes', type: 'int' })
  tamanoBytes: number;

  /** Ruta relativa a UPLOAD_DIR del PDF final. */
  @Column({ name: 'ruta_pdf', length: 255, nullable: true })
  rutaPdf: string | null;

  @Column({ type: 'enum', enum: EstadoEvidencia, default: EstadoEvidencia.CONVIRTIENDO })
  estado: EstadoEvidencia;

  @Column({ name: 'mensaje_error', length: 255, nullable: true })
  mensajeError: string | null;

  @Column({ name: 'subido_por' })
  subidoPor: string;
}

class SubirEvidenciaDto {
  @IsUUID()
  hitoId: string;
}

/** Conversión forzada a PDF en el servidor con LibreOffice headless (HU-07). */
@Injectable()
export class ConversionPdfService {
  private readonly logger = new Logger(ConversionPdfService.name);

  constructor(private readonly config: ConfigService) {}

  async convertir(origen: string, carpetaDestino: string): Promise<string> {
    const destino = join(carpetaDestino, `${randomUUID()}.pdf`);
    if (extname(origen).toLowerCase() === '.pdf') {
      await copyFile(origen, destino);
      return destino;
    }
    const salida = join(carpetaDestino, 'tmp', randomUUID());
    await mkdir(salida, { recursive: true });
    try {
      // execFile no pasa por shell: el nombre del archivo no puede inyectar comandos.
      await run(this.config.get('SOFFICE_BIN') ?? 'soffice', ['--headless', '--convert-to', 'pdf', '--outdir', salida, origen], { timeout: 120_000 });
      const generado = join(salida, `${origen.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')}.pdf`);
      await copyFile(generado, destino);
      return destino;
    } catch (error) {
      this.logger.error(`Fallo al convertir ${origen}`, error as Error);
      throw new Error('No se pudo convertir. Guárdalo como PDF y reintenta.');
    } finally {
      await rm(salida, { recursive: true, force: true });
    }
  }
}

@Injectable()
export class EvidenciasService {
  private readonly raiz: string;

  constructor(
    @InjectRepository(Evidencia) private readonly repo: Repository<Evidencia>,
    @InjectRepository(Hito) private readonly hitos: Repository<Hito>,
    private readonly conversion: ConversionPdfService,
    private readonly bitacora: BitacoraService,
    config: ConfigService,
  ) {
    this.raiz = resolve(config.get('UPLOAD_DIR') ?? './storage/evidencias');
  }

  private async licenciaturaDelHito(hitoId: string) {
    const hito = await this.hitos.findOne({ where: { id: hitoId }, relations: { recomendacion: { plan: true } } });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    return hito.recomendacion.plan.licenciaturaId;
  }

  async listar(hitoId: string, usuario: UsuarioToken) {
    verificarLicenciatura(usuario, await this.licenciaturaDelHito(hitoId));
    return this.repo.find({ where: { hitoId }, order: { creadoEn: 'DESC' } });
  }

  async subir(hitoId: string, archivo: Express.Multer.File, usuario: UsuarioToken) {
    const licenciaturaId = await this.licenciaturaDelHito(hitoId);
    verificarLicenciatura(usuario, licenciaturaId);
    const evidencia = await this.repo.save(
      this.repo.create({ hitoId, licenciaturaId, nombreOriginal: archivo.originalname, tamanoBytes: archivo.size, subidoPor: usuario.sub, estado: EstadoEvidencia.CONVIRTIENDO }),
    );
    // La conversión corre en segundo plano; el frontend consulta GET /evidencias/:id para ver el estado.
    void this.convertir(evidencia, archivo.path, usuario);
    return evidencia;
  }

  private async convertir(evidencia: Evidencia, origen: string, usuario: UsuarioToken) {
    const carpeta = join(this.raiz, evidencia.licenciaturaId);
    try {
      await mkdir(carpeta, { recursive: true });
      const pdf = await this.conversion.convertir(origen, carpeta);
      await this.repo.update(evidencia.id, { estado: EstadoEvidencia.LISTO, rutaPdf: pdf.slice(this.raiz.length + 1) });
      await this.bitacora.registrar(usuario, 'EVIDENCIA_SUBIDA', 'Evidencia', evidencia.id, `${evidencia.nombreOriginal} convertida a PDF`);
    } catch (error) {
      await this.repo.update(evidencia.id, { estado: EstadoEvidencia.ERROR, mensajeError: (error as Error).message.slice(0, 255) });
    } finally {
      await rm(origen, { force: true });
    }
  }

  async obtener(id: string, usuario: UsuarioToken) {
    const evidencia = await this.repo.findOneBy({ id });
    if (!evidencia) throw new NotFoundException('Evidencia no encontrada.');
    verificarLicenciatura(usuario, evidencia.licenciaturaId);
    return evidencia;
  }

  async pdf(id: string, usuario: UsuarioToken) {
    const evidencia = await this.obtener(id, usuario);
    if (evidencia.estado !== EstadoEvidencia.LISTO || !evidencia.rutaPdf) throw new BadRequestException('El PDF todavía no está listo.');
    const ruta = resolve(this.raiz, evidencia.rutaPdf);
    if (!ruta.startsWith(this.raiz)) throw new BadRequestException();
    return new StreamableFile(createReadStream(ruta), { type: 'application/pdf', disposition: `inline; filename="${encodeURIComponent(evidencia.nombreOriginal)}.pdf"` });
  }

  async eliminar(id: string, usuario: UsuarioToken) {
    const evidencia = await this.obtener(id, usuario);
    if (evidencia.rutaPdf) await rm(resolve(this.raiz, evidencia.rutaPdf), { force: true });
    await this.repo.delete(id);
    await this.bitacora.registrar(usuario, 'EVIDENCIA_ELIMINADA', 'Evidencia', id, evidencia.nombreOriginal);
    return { id };
  }
}

const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? 20);

@ApiTags('Evidencias')
@ApiBearerAuth()
@Controller('evidencias')
@Roles(Rol.CAPTURISTA, Rol.AUXILIAR, Rol.ADMINISTRADOR)
export class EvidenciasController {
  constructor(private readonly servicio: EvidenciasService) {}

  @Get()
  listar(@Query('hitoId', ParseUUIDPipe) hitoId: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.listar(hitoId, u);
  }

  @Post()
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('archivo', {
      dest: join(process.env.UPLOAD_DIR ?? './storage/evidencias', 'entrantes'),
      limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, callback) => {
        const valido = EXTENSIONES.includes(extname(file.originalname).toLowerCase());
        callback(valido ? null : new BadRequestException('Formato no permitido. Usa PDF, Word, Excel, PowerPoint o imagen.'), valido);
      },
    }),
  )
  subir(@Body() dto: SubirEvidenciaDto, @UploadedFile() archivo: Express.Multer.File | undefined, @UsuarioActual() u: UsuarioToken) {
    if (!archivo) throw new BadRequestException('Adjunta un archivo.');
    return this.servicio.subir(dto.hitoId, archivo, u);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.obtener(id, u);
  }

  @Get(':id/pdf')
  pdf(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.pdf(id, u);
  }

  @Delete(':id')
  @Roles(Rol.CAPTURISTA, Rol.AUXILIAR)
  eliminar(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() u: UsuarioToken) {
    return this.servicio.eliminar(id, u);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Evidencia]), PlanesModule],
  controllers: [EvidenciasController],
  providers: [EvidenciasService, ConversionPdfService],
})
export class EvidenciasModule {}
