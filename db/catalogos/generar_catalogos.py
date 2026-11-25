"""Genera db/catalogos_base.sql y src/database/cuentas-coordinaciones.ts a partir de Catálogos.xlsx.

Uso (desde ssm-backend):  python db/catalogos/generar_catalogos.py "ruta/Catálogos.xlsx"
Requiere: python -m pip install openpyxl

Cuando cambie el Excel, se vuelve a correr y se sube el resultado en un PR.
"""
import re
import sys
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parents[2]

# Clave corta por licenciatura (columna licenciatura.clave). Las de desarrollo (ACT, DER, ECO, ARQ, PED) se conservan.
CLAVES = {
    'Ciencias Políticas y Administración Pública': 'CPAP',
    'Relaciones Internacionales': 'RI',
    'Sociología': 'SOC',
    'Comunicación': 'COM',
    'Pedagogía': 'PED',
    'Matemáticas Aplicadas y Computación': 'MAC',
    'Enseñanza de Inglés': 'LEI',
    'Ingeniería Civil': 'IC',
    'Historia': 'HIS',
    'Filosofía': 'FIL',
    'Lengua y Literatura Hispánicas': 'LLH',
    'Economía': 'ECO',
    'Diseño Gráfico': 'DG',
    'Derecho': 'DER',
    'Arquitectura': 'ARQ',
    'Actuaría': 'ACT',
    'Derecho del Sistema de Universidad Abierta y Educación a Distancia': 'DER-SUA',
    'LICEL Sistema de Universidad Abierta y Educación a Distancia': 'LICEL-SUA',
    'Relaciones Internacionales del Sistema de Universidad Abierta y Educación a Distancia': 'RI-SUA',
}

# Nombres de categoría en minúsculas acentuadas (el Excel las trae en mayúsculas y numeradas).
CATEGORIAS = [
    'Personal Académico', 'Estudiantes', 'Plan de Estudios', 'Evaluación del Aprendizaje', 'Formación Integral',
    'Servicios de Apoyo para el Aprendizaje', 'Vinculación y Extensión', 'Investigación', 'Infraestructura y Equipamiento',
    'Gestión Administrativa y Financiamiento',
]


def filas(hoja):
    for fila in hoja.iter_rows(min_row=2, values_only=True):
        valores = [str(v).strip() if v is not None else '' for v in fila]
        if any(valores):
            yield valores


def sql(texto):
    return "'" + texto.replace("\\", "\\\\").replace("'", "''") + "'"


def main(ruta_excel):
    libro = openpyxl.load_workbook(ruta_excel, data_only=True)
    hojas = {h.title.strip().upper(): h for h in libro.worksheets}

    licenciaturas = [(n, c.lower()) for n, c, *_ in filas(hojas['CATALOGO LICENCIATURAS'])]
    faltan = [n for n, _ in licenciaturas if n not in CLAVES]
    if faltan:
        sys.exit(f'Agrega una clave en CLAVES para: {faltan}')

    categorias = [re.sub(r'^\d+\.\s*', '', c) for c, *_ in filas(hojas['CATALOGO CATEGORIA'])]
    if len(categorias) != len(CATEGORIAS):
        sys.exit(f'El Excel trae {len(categorias)} categorías y el script espera {len(CATEGORIAS)}; actualiza CATEGORIAS.')

    areas = sorted({a for a, *_ in filas(hojas['CATALOGO ÁREA RESPONSABLE'])})
    organismos = [o for o, *_ in filas(hojas['CATALOGO ORGANISMOS'])]

    lineas = [
        '-- =====================================================================',
        '-- SSM · Catálogos base (datos reales de la FES Acatlán).',
        '-- GENERADO por db/catalogos/generar_catalogos.py a partir de "Catálogos.xlsx". No editar a mano.',
        '-- Lo carga `npm run seed` siempre; se puede ejecutar varias veces sin duplicar.',
        '-- =====================================================================',
        '',
        f'-- Licenciaturas ({len(licenciaturas)}) y su coordinación',
        'INSERT INTO licenciatura (clave, nombre, modalidad) VALUES',
    ]
    valores = []
    for nombre, _ in licenciaturas:
        modalidad = 'Abierta y a Distancia' if 'Universidad Abierta' in nombre else 'Escolarizada'
        valores.append(f'  ({sql(CLAVES[nombre])}, {sql(nombre)}, {sql(modalidad)})')
    lineas.append(',\n'.join(valores))
    lineas.append('ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), modalidad = VALUES(modalidad), activa = TRUE;')
    lineas += [
        '',
        'INSERT IGNORE INTO coordinacion (licenciatura_id, nombre)',
        "SELECT licenciatura_id, CONCAT('Coordinación de ', nombre) FROM licenciatura;",
        '',
        f'-- Categorías ({len(categorias)}): el esquema ya las inserta; aquí se alinean los nombres con el catálogo.',
    ]
    for orden, nombre in enumerate(CATEGORIAS, start=1):
        lineas.append(f'UPDATE categoria SET nombre = {sql(nombre)}, activa = TRUE WHERE orden = {orden};')

    lineas += ['', f'-- Organismos acreditadores e IEVA ({len(organismos)})', 'INSERT INTO organismo_acreditador (nombre, siglas) VALUES']
    valores = []
    for nombre in organismos:
        siglas = re.search(r'\(([^()]+)\)\s*$', nombre)
        valores.append(f"  ({sql(nombre)}, {sql(siglas.group(1)) if siglas else 'NULL'})")
    lineas.append(',\n'.join(valores))
    lineas.append('ON DUPLICATE KEY UPDATE siglas = VALUES(siglas), activo = TRUE;')

    lineas += ['', f'-- Áreas responsables ({len(areas)})', 'INSERT INTO area_responsable (nombre) VALUES']
    lineas.append(',\n'.join(f'  ({sql(a)})' for a in areas))
    lineas.append('ON DUPLICATE KEY UPDATE activa = TRUE;')
    (RAIZ / 'db' / 'catalogos_base.sql').write_text('\n'.join(lineas) + '\n', encoding='utf-8')

    ts = [
        '// GENERADO por db/catalogos/generar_catalogos.py a partir de "Catálogos.xlsx". No editar a mano.',
        '// Correo institucional de cada coordinación. Lo usa el seed para crear sus cuentas Captura.',
        'export const CUENTAS_COORDINACIONES: ReadonlyArray<{ clave: string; licenciatura: string; correo: string }> = [',
    ]
    for nombre, correo in licenciaturas:
        ts.append(f"  {{ clave: '{CLAVES[nombre]}', licenciatura: {sql(nombre)}, correo: '{correo}' }},")
    ts.append('];')
    (RAIZ / 'src' / 'database' / 'cuentas-coordinaciones.ts').write_text('\n'.join(ts) + '\n', encoding='utf-8')

    print(f'Listo: {len(licenciaturas)} licenciaturas, {len(categorias)} categorías, {len(organismos)} organismos, {len(areas)} áreas.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Uso: python db/catalogos/generar_catalogos.py "ruta/Catálogos.xlsx"')
    main(sys.argv[1])
