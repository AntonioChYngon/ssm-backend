import { PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { UsuarioToken } from '../../common/auth';
import { ConversionNoDisponible } from './conversor';
import { EvidenciasInformesService, nombreUtf8 } from './evidencias.service';

const PDF = Buffer.from('%PDF-1.7\nprueba');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const usuario = { sub: '7', rol: 'CAPTURA' } as UsuarioToken;

const crear = (convertir: () => Promise<Buffer> = async () => PDF) => {
  const version = { id: '10', informe: { nombrePeriodo: '2027-1', ciclo: { nombre: '2024-2029', licenciatura: { nombre: 'Economía' } } } };
  const insert = jest.fn().mockResolvedValue(undefined);
  const captura = {
    contexto: jest.fn().mockResolvedValue({ version, recomendacionId: '55', numero: 2 }),
    editarConBloqueo: jest.fn((_v: unknown, escribir: (tx: unknown) => unknown) => escribir({ insert })),
    avanceRequerido: jest.fn().mockResolvedValue({ id: 'a1' }),
    registrarEvidencia: jest.fn().mockResolvedValue(undefined),
  };
  const carpetas = { guardar: jest.fn().mockResolvedValue({ ubicacion: '/Evidencias/Economía/2024-2029/Informe-2027-1/Rec-02/x.pdf', url: null }) };
  const conversor = { convertir: jest.fn(convertir) };
  const servicio = new EvidenciasInformesService(
    captura as never,
    { obtener: jest.fn().mockResolvedValue('detalle') } as never,
    conversor as never,
    carpetas as never,
    { get: () => undefined } as never,
  );
  return { servicio, insert, carpetas, conversor };
};

describe('HU-07 · subida de evidencias', () => {
  it('guarda un PDF sin convertirlo, con nombre del sistema, en la carpeta de la recomendación', async () => {
    const { servicio, insert, carpetas, conversor } = crear();
    await expect(servicio.subir(usuario, '10', '55', { originalname: 'Acta.pdf', size: PDF.length, buffer: PDF })).resolves.toBe('detalle');
    expect(conversor.convertir).not.toHaveBeenCalled();
    const [segmentos, nombre] = carpetas.guardar.mock.calls[0];
    expect(segmentos).toEqual(['Evidencias', 'Economía', '2024-2029', 'Informe-2027-1', 'Rec-02']);
    expect(nombre).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(insert.mock.calls[0][1]).toMatchObject({ avanceId: 'a1', origen: 'ARCHIVO', nombreOriginal: 'Acta.pdf', tipoMime: 'application/pdf' });
    expect(insert.mock.calls[0][1].checksumSha256).toHaveLength(64);
  });

  it('convierte .docx/.xlsx/.pptx a PDF antes de guardarlo', async () => {
    const { servicio, conversor, insert } = crear();
    await servicio.subir(usuario, '10', '55', { originalname: 'lista.xlsx', size: ZIP.length, buffer: ZIP });
    expect(conversor.convertir).toHaveBeenCalledWith(ZIP, '.xlsx');
    expect(insert.mock.calls[0][1].tamanoBytes).toBe(String(PDF.length));
  });

  it('responde 415 por tipo, 413 por peso y 503 si la conversión falla', async () => {
    const { servicio } = crear();
    await expect(servicio.subir(usuario, '10', '55', { originalname: 'virus.exe', size: 10, buffer: ZIP })).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(servicio.subir(usuario, '10', '55', { originalname: 'falso.pdf', size: 10, buffer: ZIP })).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(servicio.subir(usuario, '10', '55', { originalname: 'grande.pdf', size: 16 * 1024 * 1024, buffer: PDF })).rejects.toBeInstanceOf(PayloadTooLargeException);
    const fallida = crear(async () => {
      throw new ConversionNoDisponible('sin LibreOffice');
    });
    await expect(fallida.servicio.subir(usuario, '10', '55', { originalname: 'acta.docx', size: ZIP.length, buffer: ZIP })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fallida.insert).not.toHaveBeenCalled();
  });

  it('recupera nombres con acentos que Multer entrega en latin1', () => {
    expect(nombreUtf8(Buffer.from('Reporte de reprobación.xlsx', 'utf8').toString('latin1'))).toBe('Reporte de reprobación.xlsx');
    expect(nombreUtf8('acta.pdf')).toBe('acta.pdf');
  });
});
