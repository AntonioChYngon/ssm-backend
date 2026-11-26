import { avisoRecordatorios, detectarRecordatorios, msHastaLaHora, RecomendacionSeguimiento, recordatoriosDe, TIPOS_CON_AVISO } from './reglas';

const rec = (cambios: Partial<RecomendacionSeguimiento> = {}): RecomendacionSeguimiento => ({
  id: '10',
  indicador: '1.1 Formación docente',
  recomendacion: 'Actualizar los programas',
  fechaCumplimiento: '2026-12-15',
  metas: [
    { id: '100', descripcion: 'Programas revisados', fechaCompromiso: '2026-06-30', porcentajeEsperado: 50 },
    { id: '101', descripcion: 'Programas aprobados', fechaCompromiso: '2026-10-31', porcentajeEsperado: 80 },
  ],
  avanceActual: 30,
  ...cambios,
});

describe('HU-10 · recordatorios', () => {
  it('avisa X días antes de la fecha límite si el avance es menor al 100 %', () => {
    expect(recordatoriosDe(rec(), '2026-12-07', 7).find((r) => r.tipo === 'FECHA_LIMITE')).toBeUndefined();
    const limite = recordatoriosDe(rec(), '2026-12-08', 7).find((r) => r.tipo === 'FECHA_LIMITE');
    expect(limite).toMatchObject({ clave: 'LIMITE:10:2026-12-15', comprometido: 100, actual: 30, diasRestantes: 7 });
    expect(limite?.meta).toBe('Programas revisados; Programas aprobados');
  });

  it('al 100 % no hay ningún recordatorio', () => {
    expect(recordatoriosDe(rec({ avanceActual: 100 }), '2026-12-14', 7)).toEqual([]);
  });

  it('detecta rezago contra el hito vencido más exigente', () => {
    const [rezago] = recordatoriosDe(rec(), '2026-11-01', 7);
    expect(rezago).toMatchObject({ tipo: 'REZAGO', clave: 'REZAGO:101:2026-10-31:80', comprometido: 80, actual: 30, fechaHito: '2026-10-31', meta: 'Programas aprobados' });
    // Antes del segundo hito solo cuenta el primero; con 50 % ya lo cumple.
    expect(recordatoriosDe(rec(), '2026-07-01', 7)[0]).toMatchObject({ comprometido: 50 });
    expect(recordatoriosDe(rec({ avanceActual: 50 }), '2026-07-01', 7)).toEqual([]);
  });

  it('sin hitos vencidos ni fecha cercana no avisa', () => {
    expect(recordatoriosDe(rec(), '2026-06-29', 7)).toEqual([]);
  });

  it('pasada la fecha límite queda como VENCIDA: se muestra en el banner pero no se manda correo', () => {
    const vencida = recordatoriosDe(rec(), '2026-12-20', 7).find((r) => r.tipo === 'VENCIDA');
    expect(vencida).toMatchObject({ diasRestantes: -5 });
    expect(TIPOS_CON_AVISO.has('VENCIDA')).toBe(false);
  });

  it('el mensaje lleva indicador, recomendación, meta, % comprometido vs actual y fecha límite', () => {
    const lista = detectarRecordatorios([rec()], '2026-12-10', 7).filter((r) => r.tipo === 'FECHA_LIMITE');
    const aviso = avisoRecordatorios('Derecho', 'FECHA_LIMITE', lista, 7);
    expect(aviso.tipo).toBe('RECORDATORIO_FECHA_LIMITE');
    expect(aviso.titulo).toBe('Recordatorio: fecha límite próxima (1)');
    for (const texto of ['Indicador: 1.1 Formación docente', 'Recomendación: Actualizar los programas', 'Meta pendiente:', '% comprometido: 100 % · % actual: 30 %', 'Fecha límite: 15/12/2026 (faltan 5 días)', 'Puedes seguir capturando']) {
      expect(aviso.mensaje).toContain(texto);
    }
    expect(avisoRecordatorios('Derecho', 'REZAGO', detectarRecordatorios([rec()], '2026-11-01', 7), 7).mensaje).toContain('Fecha del hito: 31/10/2026');
  });

  it('calcula el tiempo hasta la próxima hora programada en la Ciudad de México', () => {
    // 13:00 UTC = 7:00 en CDMX → faltan 60 min para las 8:00.
    expect(msHastaLaHora(8, new Date('2026-11-26T13:00:00Z'))).toBe(3_600_000);
    // 15:00 UTC = 9:00 en CDMX → al día siguiente a las 8:00 (23 h).
    expect(msHastaLaHora(8, new Date('2026-11-26T15:00:00Z'))).toBe(23 * 3_600_000);
  });
});
