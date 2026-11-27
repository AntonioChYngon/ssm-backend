import { generarDocxReporte } from '../planes/membrete/reporte-docx';
import { generarPdfReporte } from '../planes/membrete/reporte-pdf';
import { agruparTransversales, enAlcance, RecomendacionConsulta, reporteTransversales } from './reglas';

const rec = (id: string, licenciatura: string, grupo: string | null, avance: number | null, vigente = true): RecomendacionConsulta => ({
  id,
  licenciatura: { id: licenciatura, nombre: licenciatura },
  ciclo: { id: `c-${licenciatura}`, nombre: vigente ? '2024-2029' : '2019-2024', vigente },
  planEstado: 'APROBADO',
  categoria: 'Infraestructura y Equipamiento',
  indicador: '9.1 Laboratorios',
  recomendacion: `Recomendación ${id}`,
  transversal: grupo !== null,
  grupo: grupo ? { id: grupo, nombre: `Grupo ${grupo}` } : null,
  avance,
});

const GRUPOS = [
  { id: '1', nombre: 'Equipo de cómputo', descripcion: 'Renovar laboratorios' },
  { id: '2', nombre: 'Bibliografía', descripcion: null },
  { id: '3', nombre: 'Sin miembros', descripcion: null },
];

describe('HU-17 · recomendaciones transversales', () => {
  it('el alcance distingue ciclo vigente, históricos y todos', () => {
    expect(enAlcance(true, 'vigentes')).toBe(true);
    expect(enAlcance(false, 'vigentes')).toBe(false);
    expect(enAlcance(false, 'historicos')).toBe(true);
    expect(enAlcance(true, 'historicos')).toBe(false);
    expect(enAlcance(false, 'todos')).toBe(true);
  });

  it('agrupa por recomendación similar con las licenciaturas que la comparten y su avance consolidado', () => {
    const grupos = agruparTransversales(GRUPOS, [
      rec('10', 'Derecho', '1', 20),
      rec('11', 'Actuaría', '1', 60),
      rec('12', 'Economía', '1', null),
      rec('13', 'Derecho', '2', 100),
      rec('14', 'Derecho', null, 50),
    ]);
    expect(grupos.map((g) => g.id)).toEqual(['1', '2', '3']);
    expect(grupos[0].licenciaturas).toEqual(['Actuaría', 'Derecho', 'Economía']);
    // (20 + 60 + 0) / 3: sin captura cuenta como 0 %.
    expect(grupos[0].avanceConsolidado).toBe(27);
    expect(grupos[1].avanceConsolidado).toBe(100);
    expect(grupos[2]).toMatchObject({ licenciaturas: [], avanceConsolidado: null });
  });

  it('el reporte consolidado lista cada grupo con sus carreras y su avance', () => {
    const grupos = agruparTransversales(GRUPOS, [rec('10', 'Derecho', '1', 20), rec('11', 'Actuaría', '1', 60, false)]);
    const reporte = reporteTransversales(grupos, { alcance: 'todos', licenciaturas: 'Todas' });
    expect(reporte.filas).toHaveLength(1);
    expect(reporte.filas[0][1]).toBe('Equipo de cómputo\nRenovar laboratorios');
    expect(reporte.filas[0][2]).toBe('2: Actuaría, Derecho');
    expect(reporte.filas[0][3]).toContain('Actuaría (ciclo 2019-2024, histórico): Recomendación 11 · 60 %');
    expect(reporte.filas[0][4]).toBe('40 %');
    expect(reporte.detalle).toContain('1 recomendación transversal · 2 licenciaturas afectadas');
    expect(reporte.membrete).toEqual({
      lineas: [
        { etiqueta: 'Unidad responsable', valor: 'Unidad de Planeación · FES Acatlán' },
        { etiqueta: 'Ciclos de acreditación', valor: 'Ciclos vigentes e históricos' },
        { etiqueta: 'Licenciaturas consultadas', valor: 'Todas' },
      ],
    });
  });

  it('se genera en PDF y Word con el membrete institucional', () => {
    const datos = reporteTransversales(agruparTransversales(GRUPOS, [rec('10', 'Derecho', '1', 20)]), { alcance: 'vigentes', licenciaturas: 'Derecho' });
    const pdf = generarPdfReporte(datos).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(generarDocxReporte(datos).subarray(0, 2).toString()).toBe('PK');
  });
});
