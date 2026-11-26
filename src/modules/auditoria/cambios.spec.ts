import { diferencias, LARGO_MAXIMO_VALOR, textoAuditable, textoMeta } from './cambios';

describe('HU-03 · diferencias por campo', () => {
  it('devuelve solo los campos que cambiaron, con su valor anterior y nuevo', () => {
    expect(
      diferencias(
        { categoria: 'Estudiantes', recomendacion: 'Texto  original', fecha: '2027-06-30' },
        { categoria: 'Estudiantes', recomendacion: 'Texto corregido', fecha: '2027-12-15' },
      ),
    ).toEqual([
      { campo: 'recomendacion', anterior: 'Texto original', nuevo: 'Texto corregido' },
      { campo: 'fecha', anterior: '2027-06-30', nuevo: '2027-12-15' },
    ]);
  });

  it('ignora diferencias de espacios y trata vacío como null', () => {
    expect(diferencias({ area: '  Unidad   de Planeación ' }, { area: 'Unidad de Planeación' })).toEqual([]);
    expect(diferencias({ area: '' }, { area: null })).toEqual([]);
    expect(diferencias({ area: null }, { area: 'Biblioteca' })).toEqual([{ campo: 'area', anterior: null, nuevo: 'Biblioteca' }]);
  });

  it('compara listas en orden y no compara campos ausentes en la versión nueva', () => {
    expect(diferencias({ acciones: ['A', 'B'], otro: 'x' }, { acciones: ['A', 'C'] })).toEqual([{ campo: 'acciones', anterior: 'A | B', nuevo: 'A | C' }]);
  });

  it('agrega el contexto al campo y recorta valores largos', () => {
    expect(diferencias({ porcentaje: 40 }, { porcentaje: 60 }, 'Informe 2027-1')).toEqual([{ campo: 'porcentaje · Informe 2027-1', anterior: '40', nuevo: '60' }]);
    expect(textoAuditable('x'.repeat(LARGO_MAXIMO_VALOR + 10))).toHaveLength(LARGO_MAXIMO_VALOR);
  });

  it('describe una meta con su fecha y % esperado', () => {
    expect(textoMeta({ descripcion: 'Capacitar al 80%', fechaCompromiso: '2026-06-30', porcentajeEsperado: 50 })).toBe('Capacitar al 80% (2026-06-30, 50%)');
    expect(textoMeta({ descripcion: 'Abrir 3 optativas', fechaCompromiso: null, porcentajeEsperado: null })).toBe('Abrir 3 optativas');
  });
});
