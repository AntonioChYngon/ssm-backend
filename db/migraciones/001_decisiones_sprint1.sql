-- =====================================================================
-- SSM · Migración 001 (16/11/2026): decisiones D4.1, D4.2 y D4.3 de docs/decisiones.md.
-- Solo para bases creadas ANTES de este cambio. Las nuevas ya lo traen en db/ssm_mariadb.sql.
-- En desarrollo es más fácil recrear la base: podman compose down -v && podman compose up -d db correo && npm run seed
-- Ejecutar una sola vez:  mysql -u root -p ssm < db/migraciones/001_decisiones_sprint1.sql
-- =====================================================================

-- D4.3 · Preferencia de canal por usuario y canal resuelto por aviso.
ALTER TABLE usuario
  ADD COLUMN canal_notificacion VARCHAR(10) NOT NULL DEFAULT 'AMBOS' AFTER activo,
  ADD CONSTRAINT ck_usuario_canal CHECK (canal_notificacion IN ('CORREO', 'IN_APP', 'AMBOS'));

ALTER TABLE notificacion
  ADD COLUMN canal VARCHAR(10) NOT NULL DEFAULT 'AMBOS' AFTER leida_en,
  ADD CONSTRAINT ck_notificacion_canal CHECK (canal IN ('CORREO', 'IN_APP', 'AMBOS'));

-- D4.1 · Descripción del hito. Las filas existentes reciben un texto provisional que se debe corregir.
ALTER TABLE hito_avance
  ADD COLUMN descripcion VARCHAR(255) NOT NULL DEFAULT 'Hito sin descripción' AFTER recomendacion_id;
ALTER TABLE hito_avance ALTER COLUMN descripcion DROP DEFAULT;

-- D4.2 · Observaciones atendidas (plan e informe).
ALTER TABLE observacion_plan
  ADD COLUMN atendida_en DATETIME NULL,
  ADD COLUMN atendida_por BIGINT NULL,
  ADD COLUMN respuesta TEXT NULL,
  ADD CONSTRAINT fk_obsplan_atendida_por FOREIGN KEY (atendida_por) REFERENCES usuario(usuario_id),
  ADD CONSTRAINT ck_obsplan_atendida CHECK ((atendida_en IS NULL AND atendida_por IS NULL AND respuesta IS NULL)
                                         OR (atendida_en IS NOT NULL AND atendida_por IS NOT NULL AND respuesta IS NOT NULL));

ALTER TABLE observacion_informe
  ADD COLUMN atendida_en DATETIME NULL,
  ADD COLUMN atendida_por BIGINT NULL,
  ADD COLUMN respuesta TEXT NULL,
  ADD CONSTRAINT fk_obsinf_atendida_por FOREIGN KEY (atendida_por) REFERENCES usuario(usuario_id),
  ADD CONSTRAINT ck_obsinf_atendida CHECK ((atendida_en IS NULL AND atendida_por IS NULL AND respuesta IS NULL)
                                        OR (atendida_en IS NOT NULL AND atendida_por IS NOT NULL AND respuesta IS NOT NULL));
