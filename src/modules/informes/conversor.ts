// HU-07 · Conversión automática de evidencias (.docx, .xlsx, .pptx) a PDF con LibreOffice (Plan A).
// Una conversión a la vez: LibreOffice no maneja bien varias instancias simultáneas. Cada llamada usa un perfil
// temporal propio y se cancela a los 120 s. Si LibreOffice no está instalado (equipos Windows en desarrollo),
// lanza ConversionNoDisponible y el servicio responde 503 para que la interfaz ofrezca el enlace (Plan B).
// El Containerfile ya instala LibreOffice; en local se configura con SOFFICE_BIN.
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ConversionNoDisponible extends Error {}

export abstract class ConversorPdf {
  /** Recibe el archivo original y su extensión (.docx, .xlsx, .pptx) y devuelve el PDF. */
  abstract convertir(contenido: Buffer, extension: '.docx' | '.xlsx' | '.pptx'): Promise<Buffer>;
}

export const LIMITE_CONVERSION_MS = 120_000;

export class ConversorLibreOffice extends ConversorPdf {
  private readonly logger = new Logger(ConversorLibreOffice.name);
  /** Cola: cada conversión espera a que termine la anterior. */
  private cola: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly binario: string,
    private readonly limiteMs = LIMITE_CONVERSION_MS,
  ) {
    super();
  }

  convertir(contenido: Buffer, extension: '.docx' | '.xlsx' | '.pptx'): Promise<Buffer> {
    const tarea = this.cola.then(() => this.ejecutar(contenido, extension));
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async ejecutar(contenido: Buffer, extension: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'ssm-pdf-'));
    try {
      const entrada = join(dir, `entrada${extension}`);
      await writeFile(entrada, contenido);
      const perfil = pathToFileURL(join(dir, 'perfil')).href;
      await new Promise<void>((resolver, rechazar) => {
        execFile(
          this.binario,
          [`-env:UserInstallation=${perfil}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, entrada],
          { timeout: this.limiteMs, killSignal: 'SIGKILL' },
          (error) => {
            if (!error) return resolver();
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rechazar(new ConversionNoDisponible('LibreOffice no está instalado en el servidor.'));
            if (error.killed) return rechazar(new ConversionNoDisponible('La conversión tardó demasiado.'));
            rechazar(new ConversionNoDisponible(`LibreOffice no pudo convertir el archivo: ${error.message}`));
          },
        );
      });
      const pdf = await readFile(join(dir, 'entrada.pdf')).catch(() => {
        throw new ConversionNoDisponible('LibreOffice no generó el PDF.');
      });
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new ConversionNoDisponible('El resultado de la conversión no es un PDF.');
      return pdf;
    } catch (error) {
      this.logger.warn(`Conversión a PDF fallida: ${(error as Error).message}`);
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export const conversorPdf: Provider = {
  provide: ConversorPdf,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ConversorPdf => new ConversorLibreOffice(config.get<string>('SOFFICE_BIN', 'soffice')),
};
