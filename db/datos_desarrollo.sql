-- =====================================================================
-- SSM · Datos de DESARROLLO (ficticios). Nunca cargar en producción.
-- Los ejecuta `npm run seed` cuando SEED_DATOS_DESARROLLO=true y la tabla version_plan está vacía.
-- Requiere: esquema (ssm_mariadb.sql) + usuarios del seed (Administrador y Captura de Actuaría).
--
-- Qué deja listo para cada historia:
--   HU-02  Varias coordinaciones sin cuentas, para dar de alta Captura y Auxiliar.
--   HU-04  Actuaría con su plan en BORRADOR y 2 recomendaciones, listo para seguir capturando.
--          Arquitectura con ciclo vigente y SIN plan (el primer guardado crea la versión 1).
--   HU-15  Derecho y Economía con plan APROBADO e informe APROBADO:
--          recomendaciones al 100%, en proceso, al 0% y sin avance registrado.
-- =====================================================================

SET @admin := (
  SELECT a.usuario_id FROM asignacion_usuario a
  WHERE a.rol_codigo = 'ADMINISTRADOR' AND a.activa = TRUE
  ORDER BY a.asignacion_id LIMIT 1
);

-- ---------- Catálogos ----------
INSERT IGNORE INTO licenciatura (clave, nombre, modalidad) VALUES
  ('ACT', 'Actuaría', 'Escolarizada'),
  ('DER', 'Derecho', 'Escolarizada'),
  ('ECO', 'Economía', 'Escolarizada'),
  ('ARQ', 'Arquitectura', 'Escolarizada'),
  ('PED', 'Pedagogía', 'Abierta y a Distancia');

INSERT IGNORE INTO coordinacion (licenciatura_id, nombre)
SELECT licenciatura_id, CONCAT('Coordinación de ', nombre) FROM licenciatura;

INSERT IGNORE INTO organismo_acreditador (nombre, siglas) VALUES
  ('Organismo Acreditador de Prueba A', 'OAP-A'),
  ('Organismo Acreditador de Prueba B', 'OAP-B');

INSERT IGNORE INTO area_responsable (nombre) VALUES
  ('Secretaría General'),
  ('Secretaría Académica'),
  ('Departamento de Servicios Escolares'),
  ('Biblioteca'),
  ('Centro de Cómputo'),
  ('Unidad de Planeación');

-- ---------- Ciclos de acreditación vigentes (28/11/2024 – 28/11/2029) ----------
INSERT INTO ciclo_acreditacion (licenciatura_id, organismo_id, fecha_emision, vigencia_inicio, vigencia_fin, referencia_constancia)
SELECT l.licenciatura_id, o.organismo_id, '2024-11-28', '2024-11-28', '2029-11-28', CONCAT('Constancia de prueba ', l.clave)
FROM licenciatura l
JOIN organismo_acreditador o ON o.siglas = IF(l.clave = 'DER', 'OAP-B', 'OAP-A')
WHERE l.clave IN ('ACT', 'DER', 'ECO', 'ARQ');

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
JOIN area_responsable a ON a.nombre = 'Secretaría Académica';

-- ---------- Hitos intermedios (HU-12) para los planes aprobados ----------
INSERT INTO hito_avance (recomendacion_id, descripcion, fecha_hito, porcentaje_esperado, creado_por)
SELECT r.recomendacion_id, 'Avance intermedio de ejemplo: mitad de las actividades concluidas', '2026-06-30', 50.00, @admin
FROM recomendacion r
JOIN indicador i ON i.indicador_id = r.indicador_id
JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
WHERE vp.estado = 'APROBADO';

-- ---------- Informe de seguimiento aprobado (DER y ECO) ----------
INSERT INTO informe (ciclo_id, nombre_periodo, fecha_inicio, fecha_fin, fecha_corte)
SELECT vp.ciclo_id, 'Informe 2025-2026', '2025-01-01', '2026-12-31', '2026-10-31'
FROM version_plan vp WHERE vp.estado = 'APROBADO';

INSERT INTO version_informe (informe_id, version_plan_id, numero_version, estado, creado_por, enviado_en, aprobado_en)
SELECT inf.informe_id, vp.version_plan_id, 1, 'APROBADO', @admin, '2026-11-01 09:00:00', '2026-11-05 13:00:00'
FROM informe inf
JOIN version_plan vp ON vp.ciclo_id = inf.ciclo_id AND vp.estado = 'APROBADO';

-- Avances: (licenciatura, indicador, recomendación, %). Las que no aparecen quedan SIN avance registrado.
--   DER: 100 · 40 · 0 · (sin avance)      ECO: 100 · 100 · 75
--   Resultado esperado de HU-15 → DER: 1 atendida, 1 en proceso, 2 no atendidas · ECO: 2 atendidas, 1 en proceso.
INSERT INTO avance_recomendacion (version_informe_id, recomendacion_id, porcentaje, observaciones, actualizado_por)
SELECT vi.version_informe_id, r.recomendacion_id, d.porcentaje, 'Avance de ejemplo', @admin
FROM (
  SELECT 'DER' AS clave, 1 AS ind, 1 AS rec, 100.00 AS porcentaje
  UNION ALL SELECT 'DER', 1, 2, 40.00
  UNION ALL SELECT 'DER', 2, 1, 0.00
  UNION ALL SELECT 'ECO', 1, 1, 100.00
  UNION ALL SELECT 'ECO', 1, 2, 100.00
  UNION ALL SELECT 'ECO', 2, 1, 75.00
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN ciclo_acreditacion c ON c.licenciatura_id = l.licenciatura_id
JOIN version_plan vp ON vp.ciclo_id = c.ciclo_id
JOIN indicador i ON i.version_plan_id = vp.version_plan_id AND i.orden = d.ind
JOIN recomendacion r ON r.indicador_id = i.indicador_id AND r.orden = d.rec
JOIN informe inf ON inf.ciclo_id = c.ciclo_id
JOIN version_informe vi ON vi.informe_id = inf.informe_id;
