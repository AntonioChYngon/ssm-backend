// HU-07 · Subida de evidencias (Plan A): revisa tipo, peso y firma, convierte .docx/.xlsx/.pptx a PDF y guarda el PDF
// en /Evidencias/[Licenciatura]/[Ciclo]/Informe-[semestre]/Rec-[NN]/ con un nombre generado por el sistema.
// Si la conversión o la carpeta fallan responde 503 y la interfaz ofrece reintentar o agregar un enlace (Plan B).
import { Injectable, Logger, PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { UsuarioToken } from '../../common/auth';
import { Evidencia } from '../../database/plan.entities';
import { type ArchivoGuardado, ProveedorCarpetas } from '../planes/carpetas';
import { CapturaInformesService } from './captura.service';
import { ConsultaInformesService } from './consulta.service';
import type { InformeDetalle } from './contrato';
import { ConversionNoDisponible, ConversorPdf } from './conversor';
import { ArchivoNoPermitido, type ExtensionEvidencia, MB_EVIDENCIA_POR_DEFECTO, rutaCarpetaEvidencias, validarArchivoEvidencia } from './reglas';

export type ArchivoSubido = { originalname: string; size: number; buffer: Buffer };

/** Peso máximo por archivo (EVIDENCIA_MAX_MB). Se lee también en el controlador para el límite de la subida. */
export const megasEvidencia = () => Number(process.env.EVIDENCIA_MAX_MB) || MB_EVIDENCIA_POR_DEFECTO;

/**
 * Multer entrega el nombre en latin1 aunque el navegador lo mande en UTF-8 ("Ã¡" en vez de "á").
 * Se recupera solo si el resultado es UTF-8 válido; si no, se deja como llegó.
 */
export const nombreUtf8 = (nombre: string) => {
  const convertido = Buffer.from(nombre, 'latin1').toString('utf8');
  return convertido.includes('�') ? nombre : convertido;
};

@Injectable()
export class EvidenciasInformesService {
  private readonly logger = new Logger(EvidenciasInformesService.name);

  constructor(
    private readonly captura: CapturaInformesService,
    private readonly consulta: ConsultaInformesService,
    private readonly conversor: ConversorPdf,
    private readonly carpetas: ProveedorCarpetas,
    private readonly config: ConfigService,
  ) {}

  async subir(usuario: UsuarioToken, id: string, recomendacionId: string, archivo: ArchivoSubido): Promise<InformeDetalle> {
    const ctx = await this.captura.contexto(usuario, id, recomendacionId);
    const nombreOriginal = nombreUtf8(archivo.originalname).slice(0, 255);
    const maxMb = Number(this.config.get('EVIDENCIA_MAX_MB')) || MB_EVIDENCIA_POR_DEFECTO;

    let extension: ExtensionEvidencia;
    try {
      extension = validarArchivoEvidencia({ nombre: nombreOriginal, tamano: archivo.size, inicio: archivo.buffer.subarray(0, 8) }, maxMb);
    } catch (error) {
      if (error instanceof ArchivoNoPermitido) {
        throw error.motivo === 'PESO' ? new PayloadTooLargeException(error.message) : new UnsupportedMediaTypeException(error.message);
      }
      throw error;
    }
    // Se revisa antes de convertir (puede tardar) que la recomendación ya tenga su % capturado.
    await this.captura.editarConBloqueo(ctx.version, (tx) => this.captura.avanceRequerido(tx, ctx));

    let pdf: Buffer;
    try {
      pdf = extension === '.pdf' ? archivo.buffer : await this.conversor.convertir(archivo.buffer, extension);
    } catch (error) {
      if (error instanceof ConversionNoDisponible) {
        throw new ServiceUnavailableException('No pudimos convertir el archivo a PDF. Reintenta, súbelo ya como PDF o agrega la evidencia como enlace.');
      }
      throw error;
    }

    const { version, numero } = ctx;
    const segmentos = rutaCarpetaEvidencias(version.informe.ciclo.licenciatura.nombre, version.informe.ciclo.nombre, version.informe.nombrePeriodo, numero);
    const nombreGuardado = `${randomUUID()}.pdf`;
    let guardado: ArchivoGuardado;
    try {
      guardado = await this.carpetas.guardar(segmentos, nombreGuardado, pdf);
    } catch (error) {
      this.logger.error(`No se pudo guardar la evidencia en ${segmentos.join('/')}`, error as Error);
      throw new ServiceUnavailableException('No pudimos guardar el archivo en la carpeta del ciclo. Reintenta o agrega la evidencia como enlace.');
    }

    await this.captura.editarConBloqueo(version, async (tx) => {
      const avance = await this.captura.avanceRequerido(tx, ctx);
      await tx.insert(Evidencia, {
        avanceId: avance.id,
        origen: 'ARCHIVO',
        nombreOriginal,
        nombreGuardado,
        ubicacion: guardado.ubicacion,
        urlVista: guardado.url,
        tipoMime: 'application/pdf',
        tamanoBytes: String(pdf.length),
        checksumSha256: createHash('sha256').update(pdf).digest('hex'),
        cargadaPor: usuario.sub,
      });
    });
    await this.captura.registrarEvidencia(usuario, ctx, 'agregada', `${nombreOriginal} → ${guardado.ubicacion}`);
    return this.consulta.obtener(usuario, id);
  }
}
