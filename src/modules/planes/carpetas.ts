// HU-18 · Carpetas de evidencias de cada ciclo: /Evidencias/[Licenciatura]/[20XX-20XX]/
// El resto del sistema solo conoce ProveedorCarpetas. Hoy existe el proveedor "local" (carpetas en disco,
// dentro de CARPETAS_DIR). Cuando la FES entregue la cuenta de servicio de Google, se agrega un
// proveedor "drive" con la misma interfaz y se elige con CARPETAS_PROVEEDOR=drive, sin tocar los ciclos.
// Ningún proveedor borra carpetas: las de ciclos anteriores se conservan para el histórico (HU-16).
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export type CarpetaCiclo = {
  /** Ruta lógica, igual en cualquier proveedor: /Evidencias/Actuaría/2024-2029 */
  ruta: string;
  /** Enlace para abrirla (Drive). El proveedor local no tiene enlace. */
  url: string | null;
};

export abstract class ProveedorCarpetas {
  /** Crea la carpeta si no existe y la devuelve; si ya existe, solo la devuelve. */
  abstract asegurar(segmentos: string[]): Promise<CarpetaCiclo>;
}

export class CarpetasLocales extends ProveedorCarpetas {
  private readonly logger = new Logger(CarpetasLocales.name);

  constructor(private readonly base: string) {
    super();
  }

  async asegurar(segmentos: string[]): Promise<CarpetaCiclo> {
    const destino = resolve(this.base, ...segmentos);
    // Los segmentos ya vienen saneados; esto evita salir de CARPETAS_DIR aunque alguien cambie esa regla.
    if (!destino.startsWith(resolve(this.base) + sep)) throw new Error('Ruta de carpeta fuera de CARPETAS_DIR.');
    await mkdir(destino, { recursive: true });
    this.logger.log(`Carpeta de evidencias lista: ${join(...segmentos)}`);
    return { ruta: `/${segmentos.join('/')}`, url: null };
  }
}

export const proveedorCarpetas: Provider = {
  provide: ProveedorCarpetas,
  inject: [ConfigService],
  useFactory: (config: ConfigService): ProveedorCarpetas => {
    const tipo = config.get<string>('CARPETAS_PROVEEDOR', 'local');
    if (tipo !== 'local') {
      throw new Error(`CARPETAS_PROVEEDOR=${tipo} todavía no está disponible. Usa "local" hasta integrar Google Drive.`);
    }
    return new CarpetasLocales(config.get<string>('CARPETAS_DIR', 'storage'));
  },
};
