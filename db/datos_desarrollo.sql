-- =====================================================================
-- SSM · Datos de DESARROLLO (ficticios). Nunca cargar en producción.
-- Los ejecuta `npm run seed` cuando SEED_DATOS_DESARROLLO=true y la tabla version_plan está vacía.
-- Requiere: esquema (ssm_mariadb.sql) + usuarios del seed (Administrador y Captura de Actuaría).
--
-- Qué deja listo para cada historia:
--   HU-02  Varias coordinaciones sin cuentas, para dar de alta Captura y Auxiliar.
--   HU-04  Actuaría con su plan en BORRADOR y 2 recomendaciones, listo para seguir capturando.
--          Arquitectura con ciclo vigente y SIN plan (el primer guardado crea la versión 1).
--   HU-15  Derecho y Economía con plan APROBADO e informe 2026-2 APROBADO:
--          recomendaciones al 100%, en proceso, al 0% y sin avance registrado.
--   Bloque Informe (HU-07, HU-08, HU-11), semestres con calendario UNAM (informes/reglas.ts · SEMESTRES):
--          2026-2 APROBADO (DER y ECO) con evidencias de archivo y de enlace y su validación.
--          2027-1 EN_REVISION (DER): ya se devolvió una vez y se reenvió; listo para validar o devolver.
--          2027-1 BORRADOR (ECO): una recomendación al 100 % sin evidencia (el envío debe fallar).
--          Los PDF de las evidencias de archivo los crea `npm run seed` en CARPETAS_DIR.
-- =====================================================================

SET @admin := (
  SELECT a.usuario_id FROM asignacion_usuario a
  WHERE a.rol_codigo = 'ADMINISTRADOR' AND a.activa = TRUE
  ORDER BY a.asignacion_id LIMIT 1
);

-- ---------- Catálogos ----------
-- Licenciaturas, coordinaciones, organismos y áreas vienen del catálogo real (db/catalogos_base.sql),
-- que el seed carga antes que este archivo. Aquí solo se usan.

-- ---------- Ciclos de acreditación vigentes (28/11/2024 – 28/11/2029) ----------
INSERT INTO ciclo_acreditacion (licenciatura_id, organismo_id, nombre, fecha_emision, vigencia_inicio, vigencia_fin, referencia_constancia)
SELECT l.licenciatura_id, o.organismo_id, '2024-2029', '2024-11-28', '2024-11-28', '2029-11-28', CONCAT('Constancia de prueba ', l.clave)
FROM licenciatura l
JOIN organismo_acreditador o ON o.siglas = CASE l.clave WHEN 'DER' THEN 'CONAED' WHEN 'ARQ' THEN 'ANPADEH' ELSE 'CIEES' END
WHERE l.clave IN ('ACT', 'DER', 'ECO', 'ARQ')
  -- Si ya se cargaron los ciclos reales (SEED_CICLOS_REALES), se usan esos.
  AND NOT EXISTS (SELECT 1 FROM ciclo_acreditacion x WHERE x.licenciatura_id = l.licenciatura_id AND x.estado = 'VIGENTE');

-- ---------- Planes (ARQ se queda sin plan a propósito) ----------
INSERT INTO version_plan (ciclo_id, numero_version, estado, creado_por, enviado_en, aprobado_en)
SELECT c.ciclo_id, 1,
       IF(l.clave = 'ACT', 'BORRADOR', 'APROBADO'),
       @admin,
       IF(l.clave = 'ACT', NULL, '2025-02-10 10:00:00'),
       IF(l.clave = 'ACT', NULL, '2025-02-20 12:00:00')
FROM ciclo_acreditacion c
JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
WHERE l.clave IN ('ACT', 'DER', 'ECO');

-- ---------- Indicadores: (licenciatura, orden, categoría, descripción) ----------
INSERT INTO indicador (version_plan_id, categoria_id, clave, descripcion, orden)
SELECT vp.version_plan_id, cat.categoria_id, CONCAT(d.cat_orden, '.', d.ind), d.descripcion, d.ind
FROM (
  SELECT 'ACT' AS clave, 1 AS ind, 1 AS cat_orden, 'Formación y actualización del personal académico' AS descripcion
  UNION ALL SELECT 'ACT', 2, 9, 'Condiciones de laboratorios de cómputo'
  UNION ALL SELECT 'DER', 1, 3, 'Pertinencia del plan de estudios'
  UNION ALL SELECT 'DER', 2, 6, 'Acervo bibliográfico especializado'
  UNION ALL SELECT 'ECO', 1, 2, 'Seguimiento de la trayectoria escolar'
  UNION ALL SELECT 'ECO', 2, 8, 'Productos de investigación de la planta docente'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id
JOIN categoria cat ON cat.orden = d.cat_orden;

-- ---------- Recomendaciones: (licenciatura, indicador, orden, texto, fecha) ----------
INSERT INTO recomendacion (indicador_id, descripcion, fecha_cumplimiento, etiqueta_fecha, orden)
SELECT i.indicador_id, d.descripcion, d.fecha, d.etiqueta, d.rec
FROM (
  SELECT 'ACT' AS clave, 1 AS ind, 1 AS rec, 'Implementar un programa anual de actualización disciplinar para profesores de asignatura' AS descripcion, '2027-06-30' AS fecha, 'Semestre 2027-2' AS etiqueta
  UNION ALL SELECT 'ACT', 2, 1, 'Renovar el equipo de cómputo de los laboratorios de modelación', '2028-06-30', 'Semestre 2028-2'
  UNION ALL SELECT 'DER', 1, 1, 'Actualizar los programas de asignatura del área procesal', '2026-12-15', 'Semestre 2027-1'
  UNION ALL SELECT 'DER', 1, 2, 'Incorporar prácticas de juicios orales en el plan de estudios', '2027-12-15', 'Semestre 2028-1'
  UNION ALL SELECT 'DER', 2, 1, 'Adquirir bibliografía especializada en derecho digital', '2027-06-30', 'Semestre 2027-2'
  UNION ALL SELECT 'DER', 2, 2, 'Suscribir bases de datos jurídicas en línea', '2028-06-30', 'Semestre 2028-2'
  UNION ALL SELECT 'ECO', 1, 1, 'Crear un sistema de seguimiento de egresados', '2026-12-15', 'Semestre 2027-1'
  UNION ALL SELECT 'ECO', 1, 2, 'Reducir el índice de reprobación en Matemáticas I', '2027-12-15', 'Semestre 2028-1'
  UNION ALL SELECT 'ECO', 2, 1, 'Publicar resultados de investigación en revistas arbitradas', '2028-12-15', 'Semestre 2029-1'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id
JOIN indicador i ON i.version_plan_id = vp.version_plan_id AND i.orden = d.ind;

-- Una acción, una meta y un área responsable de ejemplo para cada recomendación.
INSERT INTO accion_recomendacion (recomendacion_id, descripcion, orden)
SELECT recomendacion_id, CONCAT('Acción de ejemplo: plan de trabajo para "', LEFT(descripcion, 60), '"'), 1 FROM recomendacion;

INSERT INTO meta (recomendacion_id, descripcion, orden)
SELECT recomendacion_id, 'Cumplir el 100% de las actividades programadas antes de la fecha comprometida', 1 FROM recomendacion;

INSERT INTO recomendacion_area (recomendacion_id, area_id)
SELECT r.recomendacion_id, a.area_id FROM recomendacion r
JOIN area_responsable a ON a.nombre = 'Unidad de Planeación';

-- Área responsable como texto abierto (Plan de Mejora).
UPDATE recomendacion SET area_responsable = 'Unidad de Planeación' WHERE area_responsable IS NULL;

-- Metas configuradas (fecha compromiso y % esperado) para los planes aprobados.
UPDATE meta m
JOIN recomendacion r ON r.recomendacion_id = m.recomendacion_id
JOIN indicador i ON i.indicador_id = r.indicador_id
JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
SET m.fecha_compromiso = '2026-06-30', m.porcentaje_esperado = 50.00
WHERE vp.estado = 'APROBADO';

-- HU-12: el plan en borrador (Actuaría) también trae sus metas configuradas, para que se pueda enviar.
-- La fecha va después de la creación del plan (el día del seed) y antes de la fecha de cumplimiento.
UPDATE meta m
JOIN recomendacion r ON r.recomendacion_id = m.recomendacion_id
JOIN indicador i ON i.indicador_id = r.indicador_id
JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
SET m.fecha_compromiso = '2027-03-31', m.porcentaje_esperado = 50.00
WHERE vp.estado = 'BORRADOR';

-- ---------- Hitos intermedios (legado: hito_avance; el Plan de Mejora usa meta) ----------
INSERT INTO hito_avance (recomendacion_id, fecha_hito, porcentaje_esperado, creado_por)
SELECT r.recomendacion_id, '2026-06-30', 50.00, @admin
FROM recomendacion r
JOIN indicador i ON i.indicador_id = r.indicador_id
JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
WHERE vp.estado = 'APROBADO';

-- ---------- Informes de seguimiento (bloque Informe) ----------
SET @captura_der := COALESCE((
  SELECT a.usuario_id FROM asignacion_usuario a
  JOIN coordinacion co ON co.coordinacion_id = a.coordinacion_id
  JOIN licenciatura l ON l.licenciatura_id = co.licenciatura_id
  WHERE l.clave = 'DER' AND a.rol_codigo = 'CAPTURA' AND a.activa = TRUE LIMIT 1), @admin);
SET @captura_eco := COALESCE((
  SELECT a.usuario_id FROM asignacion_usuario a
  JOIN coordinacion co ON co.coordinacion_id = a.coordinacion_id
  JOIN licenciatura l ON l.licenciatura_id = co.licenciatura_id
  WHERE l.clave = 'ECO' AND a.rol_codigo = 'CAPTURA' AND a.activa = TRUE LIMIT 1), @admin);

-- Semestres: 2026-2 = 01/02/2026–31/07/2026 · 2027-1 = 01/08/2026–31/01/2027. El corte es el último día.
INSERT INTO informe (ciclo_id, nombre_periodo, fecha_inicio, fecha_fin, fecha_corte)
SELECT vp.ciclo_id, d.periodo, d.inicio, d.fin, d.fin
FROM (
  SELECT 'DER' AS clave, '2026-2' AS periodo, '2026-02-01' AS inicio, '2026-07-31' AS fin
  UNION ALL SELECT 'ECO', '2026-2', '2026-02-01', '2026-07-31'
  UNION ALL SELECT 'DER', '2027-1', '2026-08-01', '2027-01-31'
  UNION ALL SELECT 'ECO', '2027-1', '2026-08-01', '2027-01-31'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id AND vp.estado = 'APROBADO';

INSERT INTO version_informe (informe_id, version_plan_id, numero_version, estado, creado_por, enviado_en, aprobado_en)
SELECT inf.informe_id, vp.version_plan_id, 1, d.estado, IF(d.clave = 'DER', @captura_der, @captura_eco), d.enviado, d.aprobado
FROM (
  SELECT 'DER' AS clave, '2026-2' AS periodo, 'APROBADO' AS estado, '2026-08-05 09:00:00' AS enviado, '2026-08-12 13:00:00' AS aprobado
  UNION ALL SELECT 'ECO', '2026-2', 'APROBADO', '2026-08-04 11:00:00', '2026-08-12 13:30:00'
  UNION ALL SELECT 'DER', '2027-1', 'EN_REVISION', '2026-11-20 10:00:00', NULL
  UNION ALL SELECT 'ECO', '2027-1', 'BORRADOR', NULL, NULL
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id AND vp.estado = 'APROBADO'
JOIN informe inf ON inf.ciclo_id = c.ciclo_id AND inf.nombre_periodo = d.periodo;

-- Avances: (licenciatura, semestre, indicador, recomendación, %). Las que no aparecen quedan SIN avance registrado.
--   2026-2 · DER: 100 · 40 · 0 · (sin avance)      ECO: 100 · 100 · 75
--   Resultado esperado de HU-15 (informe aprobado) → DER: 1 atendida, 1 en proceso, 2 no atendidas · ECO: 2 atendidas, 1 en proceso.
--   2027-1 · DER (en revisión): 100 · 60 · 20 · 0        ECO (borrador): 100 (sin evidencia) · 50 · (sin avance)
INSERT INTO avance_recomendacion (version_informe_id, recomendacion_id, porcentaje, observaciones, actualizado_por)
SELECT vi.version_informe_id, r.recomendacion_id, d.porcentaje, d.observaciones, IF(d.clave = 'DER', @captura_der, @captura_eco)
FROM (
  SELECT 'DER' AS clave, '2026-2' AS periodo, 1 AS ind, 1 AS rec, 100.00 AS porcentaje, 'Programas del área procesal actualizados y aprobados por el Consejo Técnico.' AS observaciones
  UNION ALL SELECT 'DER', '2026-2', 1, 2, 40.00, 'Se diseñaron 2 de 5 prácticas de juicios orales.'
  UNION ALL SELECT 'DER', '2026-2', 2, 1, 0.00, 'En espera de presupuesto.'
  UNION ALL SELECT 'ECO', '2026-2', 1, 1, 100.00, 'Sistema de seguimiento de egresados en operación.'
  UNION ALL SELECT 'ECO', '2026-2', 1, 2, 100.00, 'Índice de reprobación reducido del 38% al 24%.'
  UNION ALL SELECT 'ECO', '2026-2', 2, 1, 75.00, 'Tres artículos aceptados de cuatro programados.'
  UNION ALL SELECT 'DER', '2027-1', 1, 1, 100.00, 'Programas publicados en el sitio de la licenciatura.'
  UNION ALL SELECT 'DER', '2027-1', 1, 2, 60.00, 'Se diseñaron 3 de 5 prácticas; se corrigió la evidencia que pidió la Administración.'
  UNION ALL SELECT 'DER', '2027-1', 2, 1, 20.00, 'Cotizaciones solicitadas a tres proveedores.'
  UNION ALL SELECT 'DER', '2027-1', 2, 2, 0.00, NULL
  UNION ALL SELECT 'ECO', '2027-1', 1, 1, 100.00, 'Falta subir el reporte del sistema.'
  UNION ALL SELECT 'ECO', '2027-1', 1, 2, 50.00, NULL
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id AND vp.estado = 'APROBADO'
JOIN indicador i ON i.version_plan_id = vp.version_plan_id AND i.orden = d.ind
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = d.rec
JOIN informe inf ON inf.ciclo_id = c.ciclo_id AND inf.nombre_periodo = d.periodo
JOIN version_informe vi ON vi.informe_id = inf.informe_id;

-- Evidencias: archivo (PDF en /Evidencias/[Lic]/[Ciclo]/Informe-[semestre]/Rec-[NN]/) o enlace externo (Plan B).
-- El tamaño y el checksum de los archivos los completa el seed al crear el PDF de ejemplo.
INSERT INTO evidencia (avance_id, origen, nombre_original, nombre_guardado, ubicacion, tamano_bytes, cargada_por, cargada_en)
SELECT a.avance_id, d.origen, d.nombre,
       IF(d.origen = 'ARCHIVO', CONCAT('ejemplo-', LOWER(d.clave), '-', d.periodo, '-rec', LPAD(d.numero, 2, '0'), '.pdf'), NULL),
       IF(d.origen = 'ARCHIVO',
          CONCAT('/Evidencias/', l.nombre, '/', c.nombre, '/Informe-', d.periodo, '/Rec-', LPAD(d.numero, 2, '0'),
                 '/ejemplo-', LOWER(d.clave), '-', d.periodo, '-rec', LPAD(d.numero, 2, '0'), '.pdf'),
          d.url),
       IF(d.origen = 'ARCHIVO', 1, NULL),
       IF(d.clave = 'DER', @captura_der, @captura_eco),
       d.fecha
FROM (
  -- numero = número de la recomendación en el informe (orden del plan: indicador y recomendación).
  SELECT 'DER' AS clave, '2026-2' AS periodo, 1 AS ind, 1 AS rec, 1 AS numero, 'ARCHIVO' AS origen, 'Acta del Consejo Técnico.docx' AS nombre, NULL AS url, '2026-07-20 12:00:00' AS fecha
  UNION ALL SELECT 'ECO', '2026-2', 1, 1, 1, 'URL', 'Tablero de egresados', 'https://www.acatlan.unam.mx/', '2026-07-22 10:00:00'
  UNION ALL SELECT 'ECO', '2026-2', 1, 2, 2, 'ARCHIVO', 'Reporte de reprobación 2026-2.xlsx', NULL, '2026-07-25 16:30:00'
  UNION ALL SELECT 'DER', '2027-1', 1, 1, 1, 'ARCHIVO', 'Programas publicados.pdf', NULL, '2026-11-10 09:15:00'
  UNION ALL SELECT 'DER', '2027-1', 1, 1, 1, 'URL', 'Sitio de la licenciatura', 'https://www.acatlan.unam.mx/', '2026-11-10 09:20:00'
  UNION ALL SELECT 'DER', '2027-1', 1, 2, 2, 'ARCHIVO', 'Guía de prácticas de juicios orales.pptx', NULL, '2026-11-18 13:00:00'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id AND vp.estado = 'APROBADO'
JOIN indicador i ON i.version_plan_id = vp.version_plan_id AND i.orden = d.ind
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = d.rec
JOIN informe inf ON inf.ciclo_id = c.ciclo_id AND inf.nombre_periodo = d.periodo
JOIN version_informe vi ON vi.informe_id = inf.informe_id
JOIN avance_recomendacion a ON a.version_informe_id = vi.version_informe_id AND a.recomendacion_id = r.recomendacion_id;

-- Revisiones: validación de los 2026-2 y una devolución previa del 2027-1 de Derecho (ya corregido y reenviado).
INSERT INTO revision_informe (version_informe_id, revisor_id, decision, comentario_general, revisado_en)
SELECT vi.version_informe_id, @admin, d.decision, d.comentario, d.fecha
FROM (
  SELECT 'DER' AS clave, '2026-2' AS periodo, 'APROBADO' AS decision, 'Informe completo.' AS comentario, '2026-08-12 13:00:00' AS fecha
  UNION ALL SELECT 'ECO', '2026-2', 'APROBADO', NULL, '2026-08-12 13:30:00'
  UNION ALL SELECT 'DER', '2027-1', 'DEVUELTO', 'Falta soporte documental en una recomendación.', '2026-11-15 11:00:00'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN informe inf ON inf.ciclo_id = c.ciclo_id AND inf.nombre_periodo = d.periodo
JOIN version_informe vi ON vi.informe_id = inf.informe_id;

INSERT INTO observacion_informe (revision_informe_id, recomendacion_id, comentario)
SELECT ri.revision_informe_id, r.recomendacion_id, 'Sube la guía de las prácticas diseñadas.'
FROM revision_informe ri
JOIN version_informe vi ON vi.version_informe_id = ri.version_informe_id
JOIN informe inf ON inf.informe_id = vi.informe_id AND inf.nombre_periodo = '2027-1'
JOIN ciclo_acreditacion c ON c.ciclo_id = inf.ciclo_id
JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id AND l.clave = 'DER'
JOIN version_plan vp ON vp.version_plan_id = vi.version_plan_id
JOIN indicador i ON i.version_plan_id = vp.version_plan_id AND i.orden = 1
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = 2
WHERE ri.decision = 'DEVUELTO';
