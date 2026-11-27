import type { DataSource } from 'typeorm';
import { ReportesService } from './reportes.module';

describe('HU-14 y HU-15 · ReportesService', () => {
  it('agrupa el último avance de cada recomendación por licenciatura y respeta el filtro', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 10, licenciatura_id: 1, licenciatura: 'Derecho', ciclo: '2024-2029', numero: 1, indicador_clave: null, indicador: 'A', recomendacion: 'R1' },
        { id: 11, licenciatura_id: 1, licenciatura: 'Derecho', ciclo: '2024-2029', numero: 2, indicador_clave: null, indicador: 'B', recomendacion: 'R2' },
        { id: 12, licenciatura_id: 1, licenciatura: 'Derecho', ciclo: '2024-2029', numero: 3, indicador_clave: null, indicador: 'C', recomendacion: 'R3' },
      ])
      .mockResolvedValueOnce([
        { recomendacion: 10, porcentaje: 100 },
        { recomendacion: 11, porcentaje: 40 },
      ]);
    const servicio = new ReportesService({ query } as unknown as DataSource);

    await expect(servicio.resumenAtencion({ licenciaturaIds: '1' })).resolves.toEqual([
      { licenciaturaId: '1', licenciatura: 'Derecho', atendidas: 1, enProceso: 1, sinAtender: 1 },
    ]);
    expect(query.mock.calls[0][0]).toContain('c.licenciatura_id IN (?)');
    expect(query.mock.calls[0][1][1]).toEqual(['1']);
  });

  it('HU-14 usa la fecha de corte, incluye las metas y sólo devuelve avances menores al parámetro', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 20, licenciatura_id: 2, licenciatura: 'Economía', ciclo: '2024-2029', numero: 1, indicador_clave: 'I-1', indicador: 'Tutorías', recomendacion: 'Fortalecer tutorías', meta_id: 30, meta: 'Atender estudiantes', fecha_compromiso: '2027-01-15', porcentaje_meta: 60 },
        { id: 21, licenciatura_id: 2, licenciatura: 'Economía', ciclo: '2024-2029', numero: 2, indicador_clave: null, indicador: 'Egresados', recomendacion: 'Dar seguimiento', meta_id: 31, meta: 'Actualizar padrón', fecha_compromiso: '2027-02-15', porcentaje_meta: 70 },
      ])
      .mockResolvedValueOnce([
        { recomendacion: 20, porcentaje: 25 },
        { recomendacion: 21, porcentaje: 80 },
      ]);
    const servicio = new ReportesService({ query } as unknown as DataSource);

    const resultado = await servicio.incumplimiento({ fechaCorte: '2026-11-26', porcentajeEsperado: 50, licenciaturaIds: '2' });

    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({ licenciatura: 'Economía', meta: 'Atender estudiantes', real: 25, esperado: 50, brecha: 25 });
    expect(query.mock.calls[1][0]).toContain('i.fecha_corte <= ?');
    expect(query.mock.calls[1][1][1]).toBe('2026-11-26');
  });
});
