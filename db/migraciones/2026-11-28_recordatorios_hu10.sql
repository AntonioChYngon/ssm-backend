-- =====================================================================
-- Migración · HU-10 Recordatorios automáticos (fechas límite e hitos intermedios)
-- Aplica sobre una base ya creada con la versión anterior de db/ssm_mariadb.sql.
-- Una base nueva ya trae este cambio: no la ejecutes ahí.
-- Ejecútala como root (ssm_app no tiene permiso de CREATE):
--   podman compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ssm' < db/migraciones/2026-11-28_recordatorios_hu10.sql
-- =====================================================================

-- Un recordatorio (fecha límite o rezago de un hito) se envía una sola vez. La clave dice qué se avisó.
CREATE TABLE IF NOT EXISTS recordatorio_enviado (
    clave           VARCHAR(160) PRIMARY KEY,
    licenciatura_id BIGINT NOT NULL,
    enviado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_recordatorio_licenciatura FOREIGN KEY (licenciatura_id) REFERENCES licenciatura(licenciatura_id)
) ENGINE=InnoDB;
