-- =====================================================================
-- Migración · Bloque Informe de Seguimiento (HU-07, HU-08, HU-11)
-- Aplica sobre una base ya creada con la versión anterior de db/ssm_mariadb.sql.
-- Una base nueva ya trae este cambio: no la ejecutes ahí.
-- Ejecútala como root (ssm_app no tiene permiso de ALTER):
--   podman compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ssm' < db/migraciones/2026-11-27_informe_evidencias.sql
-- Falla en el paso 2 si algún avance ya guardado tiene decimales: redondéalo antes.
-- =====================================================================

-- 1. Evidencias de dos orígenes: archivo convertido a PDF (en la carpeta del ciclo) o enlace externo (Plan B de HU-07).
--    Un enlace no tiene archivo guardado ni tamaño. url_vista guarda el enlace de Drive cuando exista ese proveedor.
ALTER TABLE evidencia
    ADD COLUMN origen VARCHAR(10) NOT NULL DEFAULT 'ARCHIVO' AFTER avance_id,
    ADD COLUMN url_vista VARCHAR(500) NULL AFTER ubicacion,
    MODIFY nombre_guardado VARCHAR(255) NULL,
    MODIFY tamano_bytes BIGINT NULL,
    DROP CONSTRAINT ck_evidencia_tamano,
    ADD CONSTRAINT ck_evidencia_origen CHECK (origen IN ('ARCHIVO', 'URL')),
    ADD CONSTRAINT ck_evidencia_archivo CHECK (origen = 'URL' OR (tamano_bytes > 0 AND nombre_guardado IS NOT NULL));

-- 2. El % de avance se escribe con teclado y solo admite enteros de 0 a 100 (decisión del 25/11/2026).
ALTER TABLE avance_recomendacion
    ADD CONSTRAINT ck_avance_entero CHECK (porcentaje = FLOOR(porcentaje));
