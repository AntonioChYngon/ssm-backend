import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoVersion } from '../../common/enums';
import {
  cicloActivo,
  claveTexto,
  esEditable,
  esMetaCuantitativa,
  faltantes,
  hoyEnMexico,
  inicioHitos,
  limpiarLista,
  limpiarListaOpcional,
  MENSAJE_CICLO_FINALIZADO,
  mensajeDevolucion,
  nombreCiclo,
  rutaCarpetaCiclo,
  validarEnvio,
  validarFechaCumplimiento,
  validarMetas,
  validarMetasBorrador,
  validarVigencia,
  verificarCicloAbierto,
  verificarTransicion,
} from './reglas';

const inicio = '2024-11-28';
const fin = '2029-11-28';

describe('HU-04 · validarFechaCumplimiento', () => {
  it('acepta fechas dentro de la vigencia, incluidos los extremos', () => {
    expect(() => validarFechaCumplimiento('2026-06-30', inicio, fin)).not.toThrow();
    expect(() => validarFechaCumplimiento(inicio, inicio, fin)).not.toThrow();
    expect(() => validarFechaCumplimiento(fin, inicio, fin)).not.toThrow();
  });

  it('rechaza fechas fuera de la vigencia o mal escritas', () => {
    expect(() => validarFechaCumplimiento('2030-01-01', inicio, fin)).toThrow(BadRequestException);
    expect(() => validarFechaCumplimiento('2024-11-27', inicio, fin)).toThrow(BadRequestException);
    expect(() => validarFechaCumplimiento('30/06/2026', inicio, fin)).toThrow(BadRequestException);
  });
});

describe('HU-04 · listas e indicador', () => {
  it('quita vacíos y exige al menos un elemento', () => {
    expect(limpiarLista([' Curso ', ''], 'acción')).toEqual(['Curso']);
    expect(() => limpiarLista(['  '], 'meta')).toThrow(BadRequestException);
  });

  it('en borrador permite listas vacías', () => {
    expect(limpiarListaOpcional(undefined)).toEqual([]);
    expect(limpiarListaOpcional(['  ', ' Meta 1 '])).toEqual(['Meta 1']);
  });

  it('reutiliza el indicador aunque cambien mayúsculas o espacios', () => {
    expect(claveTexto('  Perfil   del Profesorado ')).toBe(claveTexto('perfil del profesorado'));
  });
});

describe('HU-04 / HU-05 · flujo de estados', () => {
  it('solo se edita y envía en Borrador o Devuelto', () => {
    expect(esEditable(EstadoVersion.BORRADOR)).toBe(true);
    expect(esEditable(EstadoVersion.DEVUELTO)).toBe(true);
    expect(esEditable(EstadoVersion.EN_REVISION)).toBe(false);
    expect(() => verificarTransicion(EstadoVersion.APROBADO, 'enviar')).toThrow(ConflictException);
  });

  it('solo se valida o devuelve un plan en validación', () => {
    expect(() => verificarTransicion(EstadoVersion.EN_REVISION, 'validar')).not.toThrow();
    expect(() => verificarTransicion(EstadoVersion.BORRADOR, 'validar')).toThrow(ConflictException);
    expect(() => verificarTransicion(EstadoVersion.DEVUELTO, 'devolver')).toThrow(ConflictException);
  });
});

describe('HU-04 · validarEnvio', () => {
  const completa = { numero: 1, acciones: 1, metas: 2, metasConfiguradas: 2, metasSinCifra: 0, areaResponsable: 'Coordinación', fechaCumplimiento: '2027-06-30' };

  it('acepta un plan con recomendaciones completas', () => {
    expect(() => validarEnvio([completa], inicio, fin)).not.toThrow();
  });

  it('rechaza un plan vacío', () => {
    expect(() => validarEnvio([], inicio, fin)).toThrow(BadRequestException);
  });

  it('indica qué le falta a cada recomendación', () => {
    expect(faltantes({ ...completa, metas: 0, areaResponsable: ' ', fechaCumplimiento: null }, inicio, fin)).toEqual([
      'metas',
      'área responsable',
      'fecha de cumplimiento',
    ]);
    expect(() => validarEnvio([completa, { ...completa, numero: 2, fechaCumplimiento: '2031-01-01' }], inicio, fin)).toThrow(
      /recomendación 2: falta fecha de cumplimiento dentro del ciclo/,
    );
  });

  it('HU-12: exige al menos una meta con fecha y % esperado', () => {
    expect(faltantes({ ...completa, metasConfiguradas: 0 }, inicio, fin)).toEqual(['al menos una meta con fecha y % esperado']);
    expect(() => validarEnvio([{ ...completa, metasConfiguradas: 0 }], inicio, fin)).toThrow(BadRequestException);
  });
});

describe('HU-12 · validarMetas', () => {
  const meta = (fechaCompromiso: string, porcentajeEsperado: number) => ({ descripcion: 'Meta', fechaCompromiso, porcentajeEsperado });

  it('acepta metas en orden con % entre 1 y 99', () => {
    expect(() => validarMetas([meta('2025-06-30', 25), meta('2026-06-30', 60)], inicio, '2027-06-30')).not.toThrow();
  });

  it('rechaza %, fechas desordenadas o fuera de la fecha de cumplimiento', () => {
    expect(() => validarMetas([meta('2025-06-30', 100)], inicio, fin)).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2026-06-30', 20), meta('2025-06-30', 40)], inicio, fin)).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2028-01-01', 20)], inicio, '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([], inicio, fin)).toThrow(BadRequestException);
  });

  it('la fecha debe ser posterior a la creación del plan y anterior a la fecha de cumplimiento', () => {
    expect(() => validarMetas([meta('2026-11-17', 30)], '2026-11-17', '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2027-06-30', 30)], '2026-11-17', '2027-06-30')).toThrow(BadRequestException);
    expect(() => validarMetas([meta('2026-11-18', 30)], '2026-11-17', '2027-06-30')).not.toThrow();
  });
});

describe('HU-12 · inicioHitos', () => {
  it('usa la creación del plan, o el inicio de la vigencia si es posterior', () => {
    expect(inicioHitos(new Date('2026-11-17T20:00:00Z'), inicio)).toBe('2026-11-17');
    expect(inicioHitos(new Date('2024-01-10T12:00:00Z'), inicio)).toBe(inicio);
  });
});

describe('mensajeDevolucion (HU-05)', () => {
  const recomendaciones = [
    { id: '10', numero: 1 },
    { id: '11', numero: 2 },
  ];

  it('incluye el motivo y cada observación con el número de su recomendación, en orden', () => {
    const texto = mensajeDevolucion(' Faltan evidencias ', [
      { recomendacionId: '11', comentario: 'Agrega una meta medible' },
      { recomendacionId: '10', comentario: ' Corrige el área ' },
    ], recomendaciones);
    expect(texto).toBe(
      'La Administración devolvió tu plan de mejora. Motivo: Faltan evidencias\n\nObservaciones:\n' +
        '• Recomendación 1: Corrige el área\n• Recomendación 2: Agrega una meta medible',
    );
  });

  it('sin observaciones solo lleva el motivo', () => {
    expect(mensajeDevolucion('Incompleto', [], recomendaciones)).toBe('La Administración devolvió tu plan de mejora. Motivo: Incompleto');
  });
});

describe('HU-18 · ciclos de acreditación', () => {
  const vigencia = { fechaEmision: '2024-11-28', vigenciaInicio: '2024-11-28', vigenciaFin: '2029-11-28' };

  it('acepta una vigencia de exactamente 5 años', () => {
    expect(() => validarVigencia(vigencia)).not.toThrow();
  });

  it('rechaza vigencias de más de 5 años, invertidas, con fechas inexistentes o con emisión posterior al fin', () => {
    expect(() => validarVigencia({ ...vigencia, vigenciaFin: '2029-11-29' })).toThrow(BadRequestException);
    expect(() => validarVigencia({ ...vigencia, vigenciaFin: '2024-11-28' })).toThrow(BadRequestException);
    expect(() => validarVigencia({ ...vigencia, vigenciaInicio: '2025-02-30' })).toThrow(BadRequestException);
    expect(() => validarVigencia({ ...vigencia, fechaEmision: '2030-01-01' })).toThrow(BadRequestException);
  });

  it('el nombre por defecto son los años de la vigencia y no admite caracteres de ruta', () => {
    expect(nombreCiclo(undefined, '2024-11-28', '2029-11-28')).toBe('2024-2029');
    expect(nombreCiclo('  Reacreditación   2024 ', '2024-11-28', '2029-11-28')).toBe('Reacreditación 2024');
    expect(() => nombreCiclo('2024/2029', '2024-11-28', '2029-11-28')).toThrow(BadRequestException);
  });

  it('el ciclo sigue activo hasta su fecha de fin, inclusive, y solo si está VIGENTE', () => {
    expect(cicloActivo({ estado: 'VIGENTE', vigenciaFin: '2029-11-28' }, '2029-11-28')).toBe(true);
    expect(cicloActivo({ estado: 'VIGENTE', vigenciaFin: '2029-11-28' }, '2029-11-29')).toBe(false);
    expect(cicloActivo({ estado: 'HISTORICO', vigenciaFin: '2029-11-28' }, '2026-01-01')).toBe(false);
  });

  it('bloquea la captura al terminar el ciclo con el mensaje de la historia', () => {
    expect(() => verificarCicloAbierto({ estado: 'VIGENTE', vigenciaFin: '2025-01-01' }, '2026-01-01')).toThrow(MENSAJE_CICLO_FINALIZADO);
    expect(() => verificarCicloAbierto({ estado: 'VIGENTE', vigenciaFin: '2029-11-28' }, '2026-01-01')).not.toThrow();
  });

  it('arma la ruta /Evidencias/[Licenciatura]/[ciclo] sin separadores peligrosos', () => {
    expect(rutaCarpetaCiclo('Actuaría', '2024-2029')).toEqual(['Evidencias', 'Actuaría', '2024-2029']);
    expect(rutaCarpetaCiclo('../Otra: Lic', '2024-2029')).toEqual(['Evidencias', '-Otra- Lic', '2024-2029']);
  });

  it('calcula el día con la hora de la Ciudad de México', () => {
    // 02:00 UTC del 1 de enero todavía es 31 de diciembre en la Ciudad de México.
    expect(hoyEnMexico(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });
});

describe('HU-04 · metas capturadas en la pantalla del plan', () => {
  const desde = '2026-11-25';
  const hasta = '2029-11-28';

  it('acepta metas sin fecha ni % (borrador) y metas completas en orden', () => {
    expect(() => validarMetasBorrador([{ descripcion: 'Diagnóstico al 100%' }], desde, hasta)).not.toThrow();
    expect(() => validarMetasBorrador([
      { descripcion: 'Meta A', fechaCompromiso: '2027-06-30', porcentajeEsperado: 40 },
      { descripcion: 'Meta B', fechaCompromiso: null, porcentajeEsperado: null },
      { descripcion: 'Meta C', fechaCompromiso: '2028-06-30', porcentajeEsperado: 80 },
    ], desde, hasta)).not.toThrow();
  });

  it('exige fecha y % juntos', () => {
    expect(() => validarMetasBorrador([{ descripcion: 'Meta', fechaCompromiso: '2027-06-30' }], desde, hasta)).toThrow('Completa la fecha compromiso y el % esperado de la meta 1');
    expect(() => validarMetasBorrador([{ descripcion: 'Meta', porcentajeEsperado: 50 }], desde, hasta)).toThrow(BadRequestException);
  });

  it('aplica las reglas de HU-12: rango de fechas, % de 1 a 99 y fechas crecientes', () => {
    expect(() => validarMetasBorrador([{ descripcion: 'M', fechaCompromiso: '2026-11-25', porcentajeEsperado: 50 }], desde, hasta)).toThrow('posterior al 2026-11-25');
    expect(() => validarMetasBorrador([{ descripcion: 'M', fechaCompromiso: '2027-01-01', porcentajeEsperado: 100 }], desde, hasta)).toThrow('entre 1 y 99');
    expect(() => validarMetasBorrador([
      { descripcion: 'M1', fechaCompromiso: '2028-01-01', porcentajeEsperado: 50 },
      { descripcion: 'M2' },
      { descripcion: 'M3', fechaCompromiso: '2027-01-01', porcentajeEsperado: 60 },
    ], desde, hasta)).toThrow('posterior a la de la meta 1');
  });

  it('una meta es medible si expresa alguna cifra o porcentaje', () => {
    expect(esMetaCuantitativa('Capacitar al 80% de la planta docente')).toBe(true);
    expect(esMetaCuantitativa('Abrir 3 optativas nuevas')).toBe(true);
    expect(esMetaCuantitativa('Mejorar la biblioteca')).toBe(false);
  });

  it('al enviar, pide metas medibles', () => {
    const r = { numero: 1, acciones: 1, metas: 1, metasConfiguradas: 1, metasSinCifra: 1, areaResponsable: 'Unidad de Planeación', fechaCumplimiento: '2028-01-01' };
    expect(faltantes(r, '2024-11-28', '2029-11-28')).toEqual(['una cifra o porcentaje en cada meta (las metas deben ser medibles)']);
  });
});
