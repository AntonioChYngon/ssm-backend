// HU-18 · Carpetas de evidencias de cada ciclo: /Evidencias/[Licenciatura]/[20XX-20XX]/
// El resto del sistema solo conoce ProveedorCarpetas. Hoy existe el proveedor "local" (carpetas en disco,
// dentro de CARPETAS_DIR). Cuando la FES entregue la cuenta de servicio de Google, se agrega un
// proveedor "drive" con la misma interfaz y se elige con CARPETAS_PROVEEDOR=drive, sin tocar los ciclos.
// Ningún proveedor borra carpetas ni archivos: los de ciclos anteriores se conservan para el histórico (HU-16).
// Bloque Informe (HU-07/HU-08): guardar() deja cada evidencia PDF en su carpeta y abrir() la entrega para descargarla.
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

export type CarpetaCiclo = {
  /** Ruta lógica, igual en cualquier proveedor: /Evidencias/Actuaría/2024-2029 */
  ruta: string;
  /** Enlace para abrirla (Drive). El proveedor local no tiene enlace. */
  url: string | null;
};

export type ArchivoGuardado = {
  /** Ruta lógica del archivo, igual en cualquier proveedor: /Evidencias/Derecho/2024-2029/Informe-2027-1/Rec-01/<uuid>.pdf */
  ubicacion: string;
  /** Enlace de solo lectura (Drive). El proveedor local no tiene enlace: el backend sirve el archivo con sesión. */
  url: string | null;
};

/** El archivo no existe en la carpeta (p. ej. se recreó el volumen sin respaldo). */
export class ArchivoNoEncontrado extends Error {}

export abstract class ProveedorCarpetas {
  /** Crea la carpeta si no existe y la devuelve; si ya existe, solo la devuelve. */
  abstract asegurar(segmentos: string[]): Promise<CarpetaCiclo>;
  /** Guarda un archivo nuevo dentro de la carpeta (la crea si hace falta). `nombre` lo genera el sistema; nunca el usuario. */
  abstract guardar(segmentos: string[], nombre: string, contenido: Buffer): Promise<ArchivoGuardado>;
  /** Abre un archivo guardado con guardar(). Lanza ArchivoNoEncontrado si ya no existe. */
  abstract abrir(ubicacion: string): Promise<{ contenido: Readable; tamano: number }>;
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

  async guardar(segmentos: string[], nombre: string, contenido: Buffer): Promise<ArchivoGuardado> {
    if (!/^[\w.-]+$/.test(nombre)) throw new Error('Nombre de archivo no permitido.');
    await this.asegurar(segmentos);
    const destino = this.dentroDeLaBase([...segmentos, nombre]);
    // 'wx': nunca sobrescribe un archivo existente.
    await writeFile(destino, contenido, { flag: 'wx' });
    return { ubicacion: `/${[...segmentos, nombre].join('/')}`, url: null };
  }

  async abrir(ubicacion: string) {
    const ruta = this.dentroDeLaBase(ubicacion.split('/').filter(Boolean));
    const info = await stat(ruta).catch(() => null);
    if (!info?.isFile()) throw new ArchivoNoEncontrado(`No existe el archivo ${ubicacion}.`);
    return { contenido: createReadStream(ruta), tamano: info.size };
  }

  /** Ruta absoluta dentro de CARPETAS_DIR; rechaza cualquier intento de salir de ella. */
  private dentroDeLaBase(segmentos: string[]) {
    const ruta = resolve(this.base, ...segmentos);
    if (!ruta.startsWith(resolve(this.base) + sep)) throw new Error('Ruta fuera de CARPETAS_DIR.');
    return ruta;
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
