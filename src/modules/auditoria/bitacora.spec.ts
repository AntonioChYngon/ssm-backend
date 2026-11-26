import { BadRequestException } from '@nestjs/common';
import { aEvento, CONDICION_AREA, condicionesBitacora } from './bitacora';

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 9, usuario_id: 3, nombre: 'Ana', apellido: 'Torres', correo: 'ana@acatlan.unam.mx', rol_codigo: 'AUXILIAR',
  entidad: 'recomendacion', entidad_id: 55, campo: 'fecha de cumplimiento', valor_anterior: '2027-06-30', valor_nuevo: '2027-12-15',
  ocurrido_en: new Date('2026-11-25T18:00:00Z'), licenciatura: 'Economía', ...extra,
});

describe('HU-03 · filtros de la bitácora', () => {
  it('sin filtros no agrega condiciones', () => {
    expect(condicionesBitacora({})).toEqual({ where: '', valores: [] });
  });

  it('combina rol, área, fechas (día de la Ciudad de México) y licenciaturas', () => {
    const { where, valores } = condicionesBitacora({ rol: 'AUXILIAR', area: 'INFORME', desde: '2026-11-01', hasta: '2026-11-25', licenciaturaIds: '3,4' });
    expect(where).toContain('a.rol_codigo = ?');
    expect(where).toContain(CONDICION_AREA.INFORME);
    expect(where).toContain('IN (?)');
    expect(valores).toEqual(['AUXILIAR', '2026-11-01 06:00:00', '2026-11-25 06:00:00', ['3', '4']]);
  });

  it('la búsqueda escapa comodines y busca en usuario, campo y valores', () => {
    const { valores } = condicionesBitacora({ q: '50%_x' });
    expect(valores).toEqual(Array(5).fill('%50\\%\\_x%'));
  });

  it('rechaza un rango de fechas invertido', () => {
    expect(() => condicionesBitacora({ desde: '2026-11-25', hasta: '2026-11-01' })).toThrow(BadRequestException);
  });
});

describe('HU-03 · evento de la bitácora', () => {
  it('describe la acción, distingue el rol y conserva valor anterior y nuevo', () => {
    expect(aEvento(fila(), 'Economía · Recomendación: Crear un sistema')).toEqual({
      id: '9', fecha: '2026-11-25T18:00:00.000Z', usuario: { id: '3', nombre: 'Ana Torres', correo: 'ana@acatlan.unam.mx' },
      rol: 'AUXILIAR', tipo: 'PLAN', accion: 'Editó una recomendación del plan', entidad: 'recomendacion', entidadId: '55',
      campo: 'fecha de cumplimiento', anterior: '2027-06-30', nuevo: '2027-12-15', contexto: 'Economía · Recomendación: Crear un sistema', licenciatura: 'Economía',
    });
  });

  it('resume el JSON de una baja de cuenta', () => {
    const evento = aEvento(fila({ entidad: 'usuario', campo: 'estado', valor_anterior: 'ACTIVO', valor_nuevo: JSON.stringify({ estado: 'INACTIVO', motivo: 'Cambio de titular' }) }), null);
    expect(evento.nuevo).toBe('INACTIVO · Cambio de titular');
    expect(evento.accion).toBe('Desactivó una cuenta');
  });
});
