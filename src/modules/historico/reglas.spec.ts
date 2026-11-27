import type { CicloAcreditacion } from '../../database/plan.entities';
import { aCicloHistorico, coincideFecha } from './reglas';

const ciclo = {
  id: '7',
  nombre: '2019-2024',
  licenciaturaId: '3',
  licenciatura: { nombre: 'Derecho' },
  organismo: { siglas: 'CONAED', nombre: 'Consejo para la Acreditación de la Enseñanza del Derecho' },
  fechaEmision: '2019-11-28',
  vigenciaInicio: '2019-11-28',
  vigenciaFin: '2024-11-28',
  estado: 'HISTORICO',
  carpetaRuta: '/Evidencias/Derecho/2019-2024/',
  carpetaUrl: null,
} as unknown as CicloAcreditacion;

describe('HU-16 · archivo histórico', () => {
  it('encuentra la constancia por una fecha de su vigencia o por su emisión', () => {
    expect(coincideFecha(ciclo, '2021-05-10')).toBe(true);
    expect(coincideFecha(ciclo, '2019-11-28')).toBe(true);
    expect(coincideFecha(ciclo, '2024-11-29')).toBe(false);
  });

  it('distingue el ciclo histórico y lo etiqueta con su vigencia y organismo', () => {
    expect(aCicloHistorico(ciclo, '2026-11-27')).toMatchObject({
      activo: false,
      estado: 'HISTORICO',
      etiqueta: '28 de noviembre de 2019 al 28 de noviembre de 2024 · CONAED',
      carpeta: '/Evidencias/Derecho/2019-2024/',
    });
  });
});
