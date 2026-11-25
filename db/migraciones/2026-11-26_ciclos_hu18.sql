-- =====================================================================
-- Migración · HU-18 Ciclos de acreditación y carpetas de evidencias
-- Aplica sobre una base ya creada con la versión anterior de db/ssm_mariadb.sql.
-- Una base nueva ya trae este cambio: no la ejecutes ahí.
-- Ejecútala como root (ssm_app no tiene permiso de ALTER):
--   podman compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ssm' < db/migraciones/2026-11-26_ciclos_hu18.sql
-- Falla en el paso 3 si alguna licenciatura tiene más de un ciclo VIGENTE: deja uno y marca los demás como HISTORICO.
-- =====================================================================

-- 1. Nombre del ciclo ("2024-2029"); los existentes lo toman de los años de su vigencia.
ALTER TABLE ciclo_acreditacion ADD COLUMN nombre VARCHAR(40) NULL AFTER organismo_id;
UPDATE ciclo_acreditacion SET nombre = CONCAT(YEAR(vigencia_inicio), '-', YEAR(vigencia_fin)) WHERE nombre IS NULL;
ALTER TABLE ciclo_acreditacion MODIFY nombre VARCHAR(40) NOT NULL;

-- 2. Carpeta de evidencias del ciclo.
ALTER TABLE ciclo_acreditacion
    ADD COLUMN carpeta_ruta VARCHAR(500) NULL AFTER referencia_constancia,
    ADD COLUMN carpeta_url VARCHAR(500) NULL AFTER carpeta_ruta;

-- 3. Un solo ciclo VIGENTE por licenciatura.
ALTER TABLE ciclo_acreditacion
    ADD COLUMN licenciatura_vigente BIGINT AS (IF(estado = 'VIGENTE', licenciatura_id, NULL)) STORED,
    ADD UNIQUE KEY uq_ciclo_vigente_por_licenciatura (licenciatura_vigente);
