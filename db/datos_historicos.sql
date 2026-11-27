-- =====================================================================
-- SSM · Datos de DESARROLLO (ficticios) para el Archivo histórico (HU-16). Nunca cargar en producción.
-- Los ejecuta `npm run seed` cuando SEED_DATOS_DESARROLLO=true, DESPUÉS de db/datos_desarrollo.sql, y solo si Derecho
-- todavía no tiene un ciclo histórico. Así también llegan a una base que ya tenía los datos de desarrollo.
--
-- Deja listo: Derecho 2019-2024 (CONAED, HISTORICO) con su plan APROBADO de 3 recomendaciones y dos informes
-- APROBADOS (2024-1 y 2024-2), con evidencias de archivo y de enlace. El ciclo vigente 2024-2029 no cambia.
--   Avances 2024-2 (último): 100 · 100 · 70 → HU-15 sobre este ciclo: 2 atendidas, 1 en proceso, 0 no atendidas.
-- =====================================================================

SET @admin := (
  SELECT a.usuario_id FROM asignacion_usuario a
  WHERE a.rol_codigo = 'ADMINISTRADOR' AND a.activa = TRUE
  ORDER BY a.asignacion_id LIMIT 1
);
SET @captura_der := COALESCE((
  SELECT a.usuario_id FROM asignacion_usuario a
  JOIN coordinacion co ON co.coordinacion_id = a.coordinacion_id
  JOIN licenciatura l ON l.licenciatura_id = co.licenciatura_id
  WHERE l.clave = 'DER' AND a.rol_codigo = 'CAPTURA' AND a.activa = TRUE LIMIT 1), @admin);

INSERT INTO ciclo_acreditacion (licenciatura_id, organismo_id, nombre, fecha_emision, vigencia_inicio, vigencia_fin, estado, referencia_constancia)
SELECT l.licenciatura_id, o.organismo_id, '2019-2024', '2019-11-28', '2019-11-28', '2024-11-28', 'HISTORICO', 'Constancia de prueba DER 2019'
FROM licenciatura l
JOIN organismo_acreditador o ON o.siglas = 'CONAED'
WHERE l.clave = 'DER';
SET @ciclo := LAST_INSERT_ID();

INSERT INTO version_plan (ciclo_id, numero_version, estado, creado_por, enviado_en, aprobado_en)
VALUES (@ciclo, 1, 'APROBADO', @admin, '2020-02-10 10:00:00', '2020-02-20 12:00:00');
SET @plan := LAST_INSERT_ID();

INSERT INTO indicador (version_plan_id, categoria_id, clave, descripcion, orden)
SELECT @plan, cat.categoria_id, CONCAT(d.cat_orden, '.', d.ind), d.descripcion, d.ind
FROM (
  SELECT 1 AS ind, 3 AS cat_orden, 'Estructura del plan de estudios' AS descripcion
  UNION ALL SELECT 2, 9, 'Espacios para la práctica profesional'
) d
JOIN categoria cat ON cat.orden = d.cat_orden;

INSERT INTO recomendacion (indicador_id, descripcion, fecha_cumplimiento, etiqueta_fecha, orden, area_responsable)
SELECT i.indicador_id, d.descripcion, d.fecha, d.etiqueta, d.rec, 'Unidad de Planeación'
FROM (
  SELECT 1 AS ind, 1 AS rec, 'Reestructurar el plan de estudios con enfoque por competencias' AS descripcion, '2023-06-30' AS fecha, 'Semestre 2023-2' AS etiqueta
  UNION ALL SELECT 1, 2, 'Crear un programa de tutoría para estudiantes de primer ingreso', '2022-12-15', 'Semestre 2023-1'
  UNION ALL SELECT 2, 1, 'Habilitar una sala de juicios orales para prácticas', '2024-06-30', 'Semestre 2024-2'
) d
JOIN indicador i ON i.version_plan_id = @plan AND i.orden = d.ind;

INSERT INTO accion_recomendacion (recomendacion_id, descripcion, orden)
SELECT r.recomendacion_id, CONCAT('Acción de ejemplo: plan de trabajo para "', LEFT(r.descripcion, 60), '"'), 1
FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id WHERE i.version_plan_id = @plan;

INSERT INTO meta (recomendacion_id, descripcion, orden, fecha_compromiso, porcentaje_esperado)
SELECT r.recomendacion_id, 'Cumplir el 100% de las actividades programadas antes de la fecha comprometida', 1, '2021-06-30', 50.00
FROM recomendacion r JOIN indicador i ON i.indicador_id = r.indicador_id WHERE i.version_plan_id = @plan;

INSERT INTO recomendacion_area (recomendacion_id, area_id)
SELECT r.recomendacion_id, a.area_id
FROM recomendacion r
JOIN indicador i ON i.indicador_id = r.indicador_id
JOIN area_responsable a ON a.nombre = 'Unidad de Planeación'
WHERE i.version_plan_id = @plan;

-- Semestres UNAM: 2024-1 = 01/08/2023–31/01/2024 · 2024-2 = 01/02/2024–31/07/2024.
INSERT INTO informe (ciclo_id, nombre_periodo, fecha_inicio, fecha_fin, fecha_corte) VALUES
  (@ciclo, '2024-1', '2023-08-01', '2024-01-31', '2024-01-31'),
  (@ciclo, '2024-2', '2024-02-01', '2024-07-31', '2024-07-31');

INSERT INTO version_informe (informe_id, version_plan_id, numero_version, estado, creado_por, enviado_en, aprobado_en)
SELECT inf.informe_id, @plan, 1, 'APROBADO', @captura_der, d.enviado, d.aprobado
FROM (
  SELECT '2024-1' AS periodo, '2024-02-05 10:00:00' AS enviado, '2024-02-15 12:00:00' AS aprobado
  UNION ALL SELECT '2024-2', '2024-08-05 10:00:00', '2024-08-14 12:00:00'
) d
JOIN informe inf ON inf.ciclo_id = @ciclo AND inf.nombre_periodo = d.periodo;

INSERT INTO avance_recomendacion (version_informe_id, recomendacion_id, porcentaje, observaciones, actualizado_por)
SELECT vi.version_informe_id, r.recomendacion_id, d.porcentaje, d.observaciones, @captura_der
FROM (
  SELECT '2024-1' AS periodo, 1 AS ind, 1 AS rec, 80.00 AS porcentaje, 'Propuesta del nuevo plan en revisión del Consejo Técnico.' AS observaciones
  UNION ALL SELECT '2024-1', 1, 2, 100.00, 'Programa de tutoría operando con 12 tutores.'
  UNION ALL SELECT '2024-1', 2, 1, 40.00, 'Proyecto ejecutivo de la sala aprobado.'
  UNION ALL SELECT '2024-2', 1, 1, 100.00, 'Plan de estudios aprobado por el Consejo Universitario.'
  UNION ALL SELECT '2024-2', 1, 2, 100.00, 'Segundo año del programa de tutoría.'
  UNION ALL SELECT '2024-2', 2, 1, 70.00, 'Sala en obra; equipamiento pendiente.'
) d
JOIN indicador i ON i.version_plan_id = @plan AND i.orden = d.ind
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = d.rec
JOIN informe inf ON inf.ciclo_id = @ciclo AND inf.nombre_periodo = d.periodo
JOIN version_informe vi ON vi.informe_id = inf.informe_id;

-- Evidencias del ciclo histórico: el PDF de ejemplo lo crea el seed en CARPETAS_DIR (/Evidencias/Derecho/2019-2024/...).
INSERT INTO evidencia (avance_id, origen, nombre_original, nombre_guardado, ubicacion, tamano_bytes, cargada_por, cargada_en)
SELECT a.avance_id, d.origen, d.nombre,
       IF(d.origen = 'ARCHIVO', CONCAT('ejemplo-der-', d.periodo, '-rec', LPAD(d.numero, 2, '0'), '.pdf'), NULL),
       IF(d.origen = 'ARCHIVO',
          CONCAT('/Evidencias/', l.nombre, '/2019-2024/Informe-', d.periodo, '/Rec-', LPAD(d.numero, 2, '0'),
                 '/ejemplo-der-', d.periodo, '-rec', LPAD(d.numero, 2, '0'), '.pdf'),
          d.url),
       IF(d.origen = 'ARCHIVO', 1, NULL),
       @captura_der,
       d.fecha
FROM (
  SELECT '2024-2' AS periodo, 1 AS ind, 1 AS rec, 1 AS numero, 'ARCHIVO' AS origen, 'Acuerdo de aprobación del plan de estudios.pdf' AS nombre, NULL AS url, '2024-07-15 12:00:00' AS fecha
  UNION ALL SELECT '2024-2', 1, 2, 2, 'URL', 'Programa de tutoría', 'https://www.acatlan.unam.mx/', '2024-07-16 10:00:00'
  UNION ALL SELECT '2024-1', 1, 2, 2, 'ARCHIVO', 'Lista de tutores 2024-1.pdf', NULL, '2024-01-20 09:00:00'
) d
JOIN licenciatura l ON l.clave = 'DER'
JOIN indicador i ON i.version_plan_id = @plan AND i.orden = d.ind
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = d.rec
JOIN informe inf ON inf.ciclo_id = @ciclo AND inf.nombre_periodo = d.periodo
JOIN version_informe vi ON vi.informe_id = inf.informe_id
JOIN avance_recomendacion a ON a.version_informe_id = vi.version_informe_id AND a.recomendacion_id = r.recomendacion_id;

INSERT INTO revision_informe (version_informe_id, revisor_id, decision, comentario_general, revisado_en)
SELECT vi.version_informe_id, @admin, 'APROBADO', 'Informe completo.', vi.aprobado_en
FROM version_informe vi
JOIN informe inf ON inf.informe_id = vi.informe_id
WHERE inf.ciclo_id = @ciclo;

INSERT INTO revision_plan (version_plan_id, revisor_id, decision, comentario_general, revisado_en)
VALUES (@plan, @admin, 'APROBADO', 'Plan aprobado.', '2020-02-20 12:00:00');
