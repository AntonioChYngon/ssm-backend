import type { RecomendacionSeguimiento } from '../recordatorios/reglas';
import { alertasDe, avanceContraEsperado, esperadoAlDia, metasProximas, ordenarAlertas } from './reglas';

const rec = (id: string, avance: number, fecha: string, metas: [string, number][]): RecomendacionSeguimiento => ({
  id,
  indicador: '1.1 Indicador',
  recomendacion: `Recomendación ${id}`,
  fechaCumplimiento: fecha,
  metas: metas.map(([f, p], i) => ({ id: `${id}-${i}`, descripcion: `Meta ${id}-${i}`, fechaCompromiso: f, porcentajeEsperado: p })),
  avanceActual: avance,
});

describe('Dashboards · datos reales', () => {
  const recs = [
    rec('1', 100, '2026-12-15', [['2026-06-30', 50]]),
    rec('2', 20, '2027-06-30', [['2026-06-30', 50], ['2027-01-31', 80]]),
    rec('3', 0, '2026-11-01', []),
  ];

  it('el esperado al día es el mayor % de las metas vencidas, o 100 pasada la fecha límite', () => {
    expect(esperadoAlDia(recs[1], '2026-11-27')).toBe(50);
    expect(esperadoAlDia(recs[1], '2027-02-01')).toBe(80);
    expect(esperadoAlDia(recs[2], '2026-11-27')).toBe(100);
    expect(esperadoAlDia(rec('4', 0, '2028-01-01', [['2027-01-01', 30]]), '2026-11-27')).toBe(0);
  });

  it('promedia el avance real contra el esperado', () => {
    // real (100 + 20 + 0) / 3 = 40 · esperado (50 + 50 + 100) / 3 = 67
    expect(avanceContraEsperado(recs, '2026-11-27')).toEqual({ real: 40, esperado: 67 });
  });

  it('ordena las alertas: vencidas, rezagos y luego fechas próximas', () => {
    const alertas = ordenarAlertas(alertasDe('Derecho', recs, '2026-11-27', 30));
    expect(alertas.map((a) => a.tipo)).toEqual(['VENCIDA', 'REZAGO']);
    expect(alertas[0]).toMatchObject({ licenciatura: 'Derecho', recomendacionId: '3' });
  });

  it('lista primero las metas vencidas sin cumplir y luego las siguientes', () => {
    const metas = metasProximas(recs, '2026-11-27');
    expect(metas.map((m) => [m.meta, m.estado])).toEqual([
      ['Meta 2-0', 'VENCIDA'],
      ['Meta 2-1', 'PENDIENTE'],
    ]);
  });
});
