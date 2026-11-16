import { clasificarAtencion, contarPorEstatus } from './reglas';

describe('HU-15 · clasificarAtencion', () => {
  it('usa los 3 estatus estrictos', () => {
    expect(clasificarAtencion(100)).toBe('ATENDIDA');
    expect(clasificarAtencion(99)).toBe('EN_PROCESO');
    expect(clasificarAtencion(1)).toBe('EN_PROCESO');
    expect(clasificarAtencion(0)).toBe('NO_ATENDIDA');
  });
});

describe('HU-15 · contarPorEstatus', () => {
  it('cuenta cada estatus y trata "sin avance" como no atendida', () => {
    expect(contarPorEstatus([100, 50, 0, null, 100])).toEqual({ atendidas: 2, enProceso: 1, sinAtender: 2 });
  });

  it('regresa ceros para una lista vacía', () => {
    expect(contarPorEstatus([])).toEqual({ atendidas: 0, enProceso: 0, sinAtender: 0 });
  });

  it.todo('el filtro por licenciatura solo cuenta recomendaciones de esa licenciatura');
});
