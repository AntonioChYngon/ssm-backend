import { describirActividad } from './actividad';

const registro = (entidad: string, campo: string, valorNuevo: string | null) => ({
  id: '1',
  entidad,
  campo,
  valorNuevo,
  ocurridoEn: new Date('2026-11-25T14:30:00Z'),
});

describe('describirActividad (Mi perfil · actividad reciente)', () => {
  it('describe sesiones, intentos fallidos y cambios de contraseña', () => {
    expect(describirActividad(registro('usuario', 'sesion', 'INICIO_SESION'))).toEqual({
      id: '1',
      tipo: 'SESION',
      descripcion: 'Inicio de sesión',
      fecha: '2026-11-25T14:30:00.000Z',
    });
    expect(describirActividad(registro('usuario', 'sesion', 'INTENTO_FALLIDO')).tipo).toBe('SEGURIDAD');
    expect(describirActividad(registro('usuario', 'hash_contrasena', 'CAMBIADA')).descripcion).toBe('Cambió su contraseña');
  });

  it('describe acciones del plan y de la administración sin exponer valores', () => {
    expect(describirActividad(registro('version_plan', 'estado', 'EN_REVISION')).descripcion).toBe('Envió el plan de mejora a validación');
    expect(describirActividad(registro('recomendacion', 'creada (borrador)', 'texto privado')).descripcion).toBe('Agregó una recomendación al plan');
    const baja = describirActividad(registro('usuario', 'estado', JSON.stringify({ estado: 'INACTIVO', motivo: 'x' })));
    expect(baja.descripcion).toBe('Desactivó una cuenta');
    expect(JSON.stringify(baja)).not.toContain('motivo');
  });

  it('describe la edición por campo del plan y las acciones del informe (HU-03)', () => {
    expect(describirActividad(registro('recomendacion', 'fecha de cumplimiento', '2027-06-30')).descripcion).toBe('Editó una recomendación del plan');
    expect(describirActividad(registro('recomendacion', 'metas', 'Meta (2026-06-30, 50%)')).descripcion).toBe('Configuró las metas de una recomendación');
    expect(describirActividad(registro('avance_recomendacion', 'porcentaje · Informe 2027-1', '60')).descripcion).toBe('Actualizó el avance de una recomendación del informe');
    expect(describirActividad(registro('avance_recomendacion', 'evidencia agregada · Informe 2027-1', 'acta.pdf')).descripcion).toBe('Agregó una evidencia al informe de seguimiento');
    expect(describirActividad(registro('version_informe', 'estado', 'EN_REVISION')).descripcion).toBe('Envió el informe de seguimiento a revisión');
    expect(describirActividad(registro('version_informe', 'reabierto', 'motivo')).descripcion).toBe('Reabrió un informe de seguimiento aprobado');
  });

  it('usa una frase genérica para eventos que aún no conoce', () => {
    expect(describirActividad(registro('informe', 'nuevo_campo', 'x'))).toMatchObject({ tipo: 'OTRO', descripcion: 'Actualizó información del sistema' });
  });
});
