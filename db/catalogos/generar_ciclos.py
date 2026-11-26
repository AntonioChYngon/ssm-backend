"""Genera db/ciclos_vigentes.sql a partir de "CICLOS VIGENTES.xlsx" (vigencia real de cada licenciatura).

Uso (desde ssm-backend):  python db/catalogos/generar_ciclos.py "ruta/CICLOS VIGENTES.xlsx"
Requiere: python -m pip install openpyxl

Columnas del Excel: Programa Educativo | Vigencia de acreditación | Organismo acreditador.
- "28 de noviembre de 2024 a 28 de noviembre de 2029" -> vigencia exacta.
- "Julio de 2025 a agosto de 2030" (sin día) -> del día 1 del primer mes al último día del segundo.
- "En proceso" o vacío -> sin ciclo: la Administradora lo registra en /admin/ciclos cuando tenga la constancia.
La fecha de emisión no viene en el Excel: se usa el inicio de la vigencia.

Cuando cambie el Excel, se vuelve a correr y se sube el resultado en un PR.
"""
import calendar
import re
import sys
from datetime import date
from pathlib import Path

import openpyxl

from generar_catalogos import CLAVES

RAIZ = Path(__file__).resolve().parents[2]

MESES = {m: i for i, m in enumerate(
    ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], 1)}

CON_DIA = re.compile(r'^(\d{1,2}) de (\w+) de (\d{4})$')
SIN_DIA = re.compile(r'^(\w+) de (\d{4})$')


def fecha(texto: str, final: bool) -> date:
    texto = texto.strip().lower()
    if m := CON_DIA.match(texto):
        return date(int(m[3]), MESES[m[2]], int(m[1]))
    if m := SIN_DIA.match(texto):
        anio, mes = int(m[2]), MESES[m[1]]
        return date(anio, mes, calendar.monthrange(anio, mes)[1] if final else 1)
    raise ValueError(f'Fecha no reconocida: "{texto}"')


def vigencia(texto: str):
    """(inicio, fin, aproximada) o None si no hay vigencia ("En proceso" o vacío)."""
    partes = re.split(r'\s+al?\s+', texto.strip(), maxsplit=1)
    if len(partes) != 2:
        return None
    inicio, fin = fecha(partes[0], False), fecha(partes[1], True)
    if inicio >= fin:
        raise ValueError(f'Vigencia invertida: "{texto}"')
    return inicio, fin, not CON_DIA.match(partes[0].strip().lower())


def sql_texto(valor: str) -> str:
    return "'" + valor.replace("'", "''") + "'"


def main(ruta: str):
    hoja = openpyxl.load_workbook(ruta, read_only=True).worksheets[0]
    ciclos, sin_ciclo = [], []
    for fila in hoja.iter_rows(min_row=2, values_only=True):
        programa, texto, organismo = [str(v).strip() if v is not None else '' for v in fila[:3]]
        if not programa:
            continue
        if programa not in CLAVES:
            raise ValueError(f'Licenciatura que no está en el catálogo: "{programa}"')
        datos = vigencia(texto) if texto else None
        if not datos:
            sin_ciclo.append(f'{programa}: {texto or "sin dato"}{f" ({organismo})" if organismo else ""}')
            continue
        if not organismo:
            raise ValueError(f'{programa} tiene vigencia pero no organismo.')
        inicio, fin, aproximada = datos
        ciclos.append((CLAVES[programa], organismo.upper(), f'{inicio.year}-{fin.year}', inicio, fin, aproximada, texto))

    lineas = [
        '-- =====================================================================',
        '-- SSM · Ciclos de acreditación vigentes (datos reales de la FES Acatlán).',
        '-- GENERADO por db/catalogos/generar_ciclos.py a partir de "CICLOS VIGENTES.xlsx". No editar a mano.',
        '-- Lo carga `npm run seed` cuando SEED_CICLOS_REALES=true. Solo crea el ciclo de una licenciatura que aún no',
        '-- tiene ninguno: nunca modifica ni duplica los que ya registró la Administradora.',
        '-- La fecha de emisión no viene en el Excel: se usa el inicio de la vigencia.',
        '-- =====================================================================',
        '',
    ]
    aproximadas = [c for c in ciclos if c[5]]
    if aproximadas:
        lineas.append('-- Sin día en el Excel (se usó del día 1 al último día del mes; confirmar con la constancia):')
        lineas += [f'--   {c[0]}: "{c[6]}"' for c in aproximadas]
    if sin_ciclo:
        lineas.append('-- Sin ciclo (se registra en /admin/ciclos cuando haya constancia):')
        lineas += [f'--   {s}' for s in sin_ciclo]
    lineas += [
        '',
        'INSERT INTO ciclo_acreditacion (licenciatura_id, organismo_id, nombre, fecha_emision, vigencia_inicio, vigencia_fin, estado)',
        "SELECT l.licenciatura_id, o.organismo_id, d.nombre, d.inicio, d.inicio, d.fin, IF(d.fin < CURDATE(), 'HISTORICO', 'VIGENTE')",
        'FROM (',
    ]
    for i, (clave, siglas, nombre, inicio, fin, _, _) in enumerate(ciclos):
        prefijo = '  SELECT' if i == 0 else '  UNION ALL SELECT'
        alias = (' AS clave', ' AS siglas', ' AS nombre', ' AS inicio', ' AS fin') if i == 0 else ('',) * 5
        valores = [sql_texto(clave), sql_texto(siglas), sql_texto(nombre), sql_texto(inicio.isoformat()), sql_texto(fin.isoformat())]
        lineas.append(f'{prefijo} ' + ', '.join(v + a for v, a in zip(valores, alias)))
    lineas += [
        ') d',
        'JOIN licenciatura l ON l.clave = d.clave',
        'JOIN organismo_acreditador o ON o.siglas = d.siglas',
        'WHERE NOT EXISTS (SELECT 1 FROM ciclo_acreditacion c WHERE c.licenciatura_id = l.licenciatura_id);',
        '',
    ]
    destino = RAIZ / 'db' / 'ciclos_vigentes.sql'
    destino.write_text('\n'.join(lineas), encoding='utf-8')
    print(f'{destino.relative_to(RAIZ)}: {len(ciclos)} ciclos, {len(sin_ciclo)} licenciaturas sin ciclo.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
