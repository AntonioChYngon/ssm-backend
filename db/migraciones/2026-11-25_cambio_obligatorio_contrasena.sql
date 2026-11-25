-- =====================================================================
-- Migración · Cambio obligatorio de contraseña temporal (HU-01 / HU-02)
-- Aplica sobre una base ya creada con la versión anterior de db/ssm_mariadb.sql.
-- Una base nueva (podman compose down -v && up) ya trae este cambio: no la ejecutes ahí.
-- Ejecútala como root (ssm_app no tiene permiso de ALTER):
--   podman compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ssm' < db/migraciones/2026-11-25_cambio_obligatorio_contrasena.sql
-- =====================================================================

-- TRUE mientras la cuenta tenga una contraseña temporal (alta, restablecimiento del Administrador o cuenta del seed).
ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE AFTER hash_contrasena;
