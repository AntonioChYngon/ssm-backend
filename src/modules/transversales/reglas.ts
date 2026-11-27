// HU-17 · Reglas puras de las recomendaciones transversales: alcance de ciclos, agrupación y reporte consolidado.
import { avanceConsolidado } from '../../common/avances';
import type { CeldaReporte, ReporteTabla } from '../planes/membrete/reporte-pdf';

/** Ciclo vigente (activo hoy), históricos (terminados o archivados) o todos. */
export const ALCANCES = ['vigentes', 'historicos', 'todos'] as const;
export type AlcanceCiclos = (typeof ALCANCES)[number];

export const ETIQUETA_ALCANCE: Record<AlcanceCiclos, string> = {
  vigentes: 'Ciclos vigentes',
  historicos: 'Ciclos históricos',
  todos: 'Ciclos vigentes e históricos',
};

export const enAlcance = (vigente: boolean, alcance: AlcanceCiclos) => alcance === 'todos' || (alcance === 'vigentes') === vigente;

/** Una recomendación del último plan de un ciclo, tal como la ve la consulta (contrato con el frontend). */
export type RecomendacionConsulta = {
  id: string;
  licenciatura: { id: string; nombre: string };
  ciclo: { id: string; nombre: string; vigente: boolean };
  planEstado: string;
  categoria: string;
  indicador: string;
  recomendacion: string;
  transversal: boolean;
  grupo: { id: string; nombre: string } | null;
  /** % del último informe capturado; null si nunca se capturó (cuenta como 0 % en el consolidado). */
  avance: number | null;
};

export type GrupoTransversal = { id: string; nombre: string; descripcion: string | null };

/** Vista agrupada: todas las licenciaturas que comparten la misma recomendación transversal. */
export type GrupoConsolidado = GrupoTransversal & {
  licenciaturas: string[];
  recomendaciones: RecomendacionConsulta[];
  /** Promedio del % de sus recomendaciones; null si el grupo no tiene ninguna en el alcance elegido. */
  avanceConsolidado: number | null;
};

const porNombre = (a: string, b: string) => a.localeCompare(b, 'es');

export const agruparTransversales = (grupos: readonly GrupoTransversal[], recomendaciones: readonly RecomendacionConsulta[]): GrupoConsolidado[] =>
  grupos
    .map((g) => {
      const miembros = recomendaciones
        .filter((r) => r.grupo?.id === g.id)
        .sort((a, b) => porNombre(a.licenciatura.nombre, b.licenciatura.nombre) || porNombre(b.ciclo.nombre, a.ciclo.nombre));
      return {
        ...g,
        licenciaturas: [...new Set(miembros.map((r) => r.licenciatura.nombre))].sort(porNombre),
        recomendaciones: miembros,
        avanceConsolidado: avanceConsolidado(miembros.map((r) => r.avance ?? 0)),
      };
    })
    .sort((a, b) => b.licenciaturas.length - a.licenciaturas.length || porNombre(a.nombre, b.nombre));

const porcentaje = (valor: number | null) => (valor === null ? 'Sin capturar' : `${valor} %`);

export const COLUMNAS_TRANSVERSALES = [
  { titulo: 'N.º', proporcion: 25 },
  { titulo: 'Recomendación transversal', proporcion: 150 },
  { titulo: 'Licenciaturas afectadas', proporcion: 120 },
  { titulo: 'Recomendación en cada licenciatura y su avance', proporcion: 400 },
  { titulo: 'Avance consolidado', proporcion: 70 },
];

/** Reporte consolidado (PDF y Word): cada recomendación transversal con sus carreras y su avance consolidado. */
export const reporteTransversales = (
  grupos: readonly GrupoConsolidado[],
  filtros: { alcance: AlcanceCiclos; licenciaturas: string },
): ReporteTabla & { tituloDocumento: string } => {
  const conMiembros = grupos.filter((g) => g.recomendaciones.length);
  const licenciaturas = new Set(conMiembros.flatMap((g) => g.licenciaturas));
  return {
    titulo: 'Recomendaciones Transversales · Reporte consolidado',
    tituloDocumento: 'Recomendaciones Transversales · Reporte consolidado',
    membrete: {
      lineas: [
        { etiqueta: 'Unidad responsable', valor: 'Unidad de Planeación · FES Acatlán' },
        { etiqueta: 'Ciclos de acreditación', valor: ETIQUETA_ALCANCE[filtros.alcance] },
        { etiqueta: 'Licenciaturas consultadas', valor: filtros.licenciaturas },
      ],
    },
    detalle:
      `${conMiembros.length} ${conMiembros.length === 1 ? 'recomendación transversal' : 'recomendaciones transversales'} · ` +
      `${licenciaturas.size} ${licenciaturas.size === 1 ? 'licenciatura afectada' : 'licenciaturas afectadas'} · ` +
      'Avance: último informe capturado; sin captura cuenta como 0 %',
    columnas: COLUMNAS_TRANSVERSALES,
    filas: conMiembros.map((g, i): CeldaReporte[] => [
      String(i + 1),
      g.descripcion ? `${g.nombre}\n${g.descripcion}` : g.nombre,
      `${g.licenciaturas.length}: ${g.licenciaturas.join(', ')}`,
      g.recomendaciones.map((r) => `• ${r.licenciatura.nombre} (ciclo ${r.ciclo.nombre}${r.ciclo.vigente ? '' : ', histórico'}): ${r.recomendacion} · ${porcentaje(r.avance)}`).join('\n'),
      porcentaje(g.avanceConsolidado),
    ]),
    vacio: 'No hay recomendaciones transversales en los ciclos y licenciaturas consultados.',
  };
};

export const nombreArchivoTransversales = (alcance: AlcanceCiclos) => `recomendaciones-transversales-${alcance}`;
