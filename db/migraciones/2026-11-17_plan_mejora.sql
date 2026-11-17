-- =====================================================================
-- Migración · Plan de Mejora (HU-04 / HU-05 / HU-12)
-- Aplica sobre una base ya creada con la versión anterior de db/ssm_mariadb.sql.
-- Una base nueva (podman compose down -v && up) ya trae estos cambios: no la ejecutes ahí.
-- Ejecútala como root (ssm_app no tiene permiso de ALTER):
--   podman compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ssm' < db/migraciones/2026-11-17_plan_mejora.sql
-- =====================================================================

-- 1. Recomendación: "Área responsable" como texto abierto y fecha de cumplimiento opcional en borrador.
ALTER TABLE recomendacion
    MODIFY fecha_cumplimiento DATE NULL,
    ADD COLUMN area_responsable VARCHAR(250) NULL AFTER descripcion;

-- Conserva las áreas ya capturadas con el catálogo.
UPDATE recomendacion r
SET r.area_responsable = (
    SELECT GROUP_CONCAT(a.nombre ORDER BY a.nombre SEPARATOR ', ')
    FROM recomendacion_area ra
    JOIN area_responsable a ON a.area_id = ra.area_id
    WHERE ra.recomendacion_id = r.recomendacion_id
)
WHERE r.area_responsable IS NULL;

-- 2. Metas (antes "hitos"): fecha compromiso y % esperado por meta.
ALTER TABLE meta
    ADD COLUMN fecha_compromiso DATE NULL AFTER descripcion,
    ADD COLUMN porcentaje_esperado DECIMAL(5,2) NULL AFTER fecha_compromiso,
    ADD CONSTRAINT uq_meta_fecha UNIQUE (recomendacion_id, fecha_compromiso),
    ADD CONSTRAINT ck_meta_porcentaje CHECK (porcentaje_esperado IS NULL OR (porcentaje_esperado > 0 AND porcentaje_esperado < 100));

CREATE INDEX ix_meta_fecha ON meta(fecha_compromiso);
