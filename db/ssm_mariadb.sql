-- =====================================================================
-- Sistema de Seguimiento a la Mejora Continua (SSM) · FES Acatlán
-- Esquema para MariaDB 10.6+ (probado como objetivo: MariaDB 11.4 LTS)
--
-- Traducción fiel de "base_de_datos_ingenieria.sql" (escrito para PostgreSQL).
-- Mismas tablas, columnas, relaciones, reglas y datos iniciales. Cambios de forma:
--   * GENERATED ... AS IDENTITY  -> AUTO_INCREMENT
--   * TIMESTAMPTZ                -> DATETIME (la aplicación guarda todo en UTC)
--   * NUMERIC                    -> DECIMAL
--   * Regex ~*                   -> REGEXP con (?i) (sin distinguir mayúsculas)
--   * Índices parciales (WHERE)  -> columnas generadas + índice UNIQUE
--   * Trigger plpgsql            -> dos triggers de MariaDB (UPDATE y DELETE)
-- Mejora menor: usuario.actualizado_en se actualiza solo (ON UPDATE).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS ssm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ssm;

-- ---------------------------------------------------------------------
-- 1. Cuentas y acceso
-- ---------------------------------------------------------------------
CREATE TABLE rol (
    rol_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo          VARCHAR(30) NOT NULL UNIQUE,
    nombre          VARCHAR(80) NOT NULL,
    descripcion     VARCHAR(250),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT ck_rol_codigo CHECK (codigo IN ('ADMINISTRADOR', 'CAPTURA', 'AUXILIAR'))
) ENGINE=InnoDB;

CREATE TABLE usuario (
    usuario_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    apellido        VARCHAR(120) NOT NULL,
    correo          VARCHAR(254) NOT NULL UNIQUE,
    hash_contrasena VARCHAR(255) NOT NULL,
    -- TRUE mientras la cuenta use una contraseña temporal: solo puede cambiarla hasta que lo haga.
    debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT ck_usuario_correo_institucional CHECK (
        correo REGEXP '(?i)^[a-z0-9._%+-]+@(acatlan[.]unam[.]mx|pcpuma[.]acatlan[.]unam[.]mx)$'
    )
) ENGINE=InnoDB;

CREATE TABLE token_restauracion_contrasena (
    token_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id       BIGINT NOT NULL,
    token_hash       CHAR(64) NOT NULL UNIQUE,
    expira_en        DATETIME NOT NULL,
    usado_en         DATETIME NULL,
    creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(usuario_id),
    CONSTRAINT ck_token_expiracion CHECK (expira_en > creado_en)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. Estructura académica
-- ---------------------------------------------------------------------
CREATE TABLE licenciatura (
    licenciatura_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    clave           VARCHAR(30) NOT NULL UNIQUE,
    nombre          VARCHAR(180) NOT NULL,
    modalidad       VARCHAR(80),
    activa          BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Una coordinación operativa por licenciatura, según la respuesta del cliente.
CREATE TABLE coordinacion (
    coordinacion_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    licenciatura_id BIGINT NOT NULL UNIQUE,
    nombre          VARCHAR(180) NOT NULL,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_coordinacion_licenciatura FOREIGN KEY (licenciatura_id) REFERENCES licenciatura(licenciatura_id)
) ENGINE=InnoDB;

CREATE TABLE organismo_acreditador (
    organismo_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL UNIQUE,
    siglas          VARCHAR(40),
    activo          BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE ciclo_acreditacion (
    ciclo_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    licenciatura_id       BIGINT NOT NULL,
    organismo_id          BIGINT NOT NULL,
    fecha_emision         DATE NOT NULL,
    vigencia_inicio       DATE NOT NULL,
    vigencia_fin          DATE NOT NULL,
    estado                VARCHAR(20) NOT NULL DEFAULT 'VIGENTE',
    referencia_constancia VARCHAR(255),
    creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ciclo_licenciatura FOREIGN KEY (licenciatura_id) REFERENCES licenciatura(licenciatura_id),
    CONSTRAINT fk_ciclo_organismo FOREIGN KEY (organismo_id) REFERENCES organismo_acreditador(organismo_id),
    CONSTRAINT ck_ciclo_fechas CHECK (vigencia_inicio <= vigencia_fin AND fecha_emision <= vigencia_fin),
    CONSTRAINT ck_ciclo_estado CHECK (estado IN ('VIGENTE', 'CERRADO', 'HISTORICO')),
    CONSTRAINT uq_ciclo_lic_organismo_emision UNIQUE (licenciatura_id, organismo_id, fecha_emision)
) ENGINE=InnoDB;

-- Las cuentas de Captura/Auxiliar pertenecen a una coordinación exclusivamente.
-- Se conserva la asignación anterior como inactiva al cambiar al titular.
--
-- MariaDB no tiene índices parciales. Se emulan con columnas generadas que valen NULL
-- cuando la regla no aplica (UNIQUE permite varios NULL):
--   * usuario_activo:   una sola asignación activa por usuario.
--   * captura_activa:   un solo Captura activo por coordinación.
--   * auxiliar_activa:  un solo Auxiliar activo por coordinación.
CREATE TABLE asignacion_usuario (
    asignacion_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id      BIGINT NOT NULL,
    rol_codigo      VARCHAR(30) NOT NULL,
    coordinacion_id BIGINT NULL,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    asignada_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    desactivada_en  DATETIME NULL,
    usuario_activo  BIGINT AS (IF(activa, usuario_id, NULL)) STORED,
    captura_activa  BIGINT AS (IF(activa AND rol_codigo = 'CAPTURA', coordinacion_id, NULL)) STORED,
    auxiliar_activa BIGINT AS (IF(activa AND rol_codigo = 'AUXILIAR', coordinacion_id, NULL)) STORED,
    CONSTRAINT fk_asignacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(usuario_id),
    CONSTRAINT fk_asignacion_rol FOREIGN KEY (rol_codigo) REFERENCES rol(codigo),
    CONSTRAINT fk_asignacion_coordinacion FOREIGN KEY (coordinacion_id) REFERENCES coordinacion(coordinacion_id),
    CONSTRAINT ck_asignacion_coordinacion_por_rol CHECK (
        (rol_codigo = 'ADMINISTRADOR' AND coordinacion_id IS NULL)
        OR (rol_codigo IN ('CAPTURA', 'AUXILIAR') AND coordinacion_id IS NOT NULL)
    ),
    UNIQUE KEY uq_asignacion_usuario_activa (usuario_activo),
    UNIQUE KEY uq_asignacion_captura_activa (captura_activa),
    UNIQUE KEY uq_asignacion_auxiliar_activa (auxiliar_activa)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. Plan de mejora
-- ---------------------------------------------------------------------
CREATE TABLE area_responsable (
    area_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL UNIQUE,
    activa          BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE categoria (
    categoria_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre         VARCHAR(160) NOT NULL UNIQUE,
    orden          SMALLINT NOT NULL UNIQUE,
    activa         BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Cada fila es una versión del Plan. Una devolución se corrige creando otra versión.
CREATE TABLE version_plan (
    version_plan_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ciclo_id        BIGINT NOT NULL,
    numero_version  INT NOT NULL,
    estado          VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    creado_por      BIGINT NOT NULL,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enviado_en      DATETIME NULL,
    aprobado_en     DATETIME NULL,
    CONSTRAINT fk_plan_ciclo FOREIGN KEY (ciclo_id) REFERENCES ciclo_acreditacion(ciclo_id),
    CONSTRAINT fk_plan_creado_por FOREIGN KEY (creado_por) REFERENCES usuario(usuario_id),
    CONSTRAINT uq_plan_version UNIQUE (ciclo_id, numero_version),
    CONSTRAINT ck_plan_version_num CHECK (numero_version > 0),
    CONSTRAINT ck_plan_estado CHECK (estado IN ('BORRADOR', 'EN_REVISION', 'APROBADO', 'DEVUELTO'))
) ENGINE=InnoDB;

CREATE TABLE indicador (
    indicador_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    version_plan_id BIGINT NOT NULL,
    categoria_id    BIGINT NOT NULL,
    clave           VARCHAR(60),
    descripcion     TEXT NOT NULL,
    orden           INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_indicador_plan FOREIGN KEY (version_plan_id) REFERENCES version_plan(version_plan_id),
    CONSTRAINT fk_indicador_categoria FOREIGN KEY (categoria_id) REFERENCES categoria(categoria_id),
    CONSTRAINT ck_indicador_orden CHECK (orden > 0)
) ENGINE=InnoDB;

CREATE TABLE recomendacion (
    recomendacion_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    indicador_id       BIGINT NOT NULL,
    descripcion        TEXT NOT NULL,
    area_responsable   VARCHAR(250), -- Texto abierto (Plan de Mejora). recomendacion_area queda para el catálogo.
    fecha_cumplimiento DATE NULL,     -- Opcional en BORRADOR; obligatoria para enviar a validación.
    etiqueta_fecha     VARCHAR(80), -- Ej. "Semestre 2026-1"; la fecha real sirve para alertas.
    orden              INT NOT NULL DEFAULT 1,
    transversal        BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_recomendacion_indicador FOREIGN KEY (indicador_id) REFERENCES indicador(indicador_id),
    CONSTRAINT ck_recomendacion_orden CHECK (orden > 0)
) ENGINE=InnoDB;

CREATE TABLE accion_recomendacion (
    accion_id        BIGINT AUTO_INCREMENT PRIMARY KEY,
    recomendacion_id BIGINT NOT NULL,
    descripcion      TEXT NOT NULL,
    orden            INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_accion_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id),
    CONSTRAINT uq_accion_orden UNIQUE (recomendacion_id, orden),
    CONSTRAINT ck_accion_orden CHECK (orden > 0)
) ENGINE=InnoDB;

-- Metas similares pero no idénticas se conservan como registros independientes.
-- Las Metas (antes "hitos") se capturan con la recomendación y se configuran después
-- con su fecha compromiso y % esperado (sección Configuración de Metas).
CREATE TABLE meta (
    meta_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    recomendacion_id    BIGINT NOT NULL,
    descripcion         TEXT NOT NULL,
    fecha_compromiso    DATE NULL,
    porcentaje_esperado DECIMAL(5,2) NULL,
    orden               INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_meta_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id),
    CONSTRAINT uq_meta_orden UNIQUE (recomendacion_id, orden),
    CONSTRAINT uq_meta_fecha UNIQUE (recomendacion_id, fecha_compromiso),
    CONSTRAINT ck_meta_orden CHECK (orden > 0),
    CONSTRAINT ck_meta_porcentaje CHECK (porcentaje_esperado IS NULL OR (porcentaje_esperado > 0 AND porcentaje_esperado < 100))
) ENGINE=InnoDB;

CREATE TABLE recomendacion_area (
    recomendacion_id BIGINT NOT NULL,
    area_id          BIGINT NOT NULL,
    PRIMARY KEY (recomendacion_id, area_id),
    CONSTRAINT fk_recarea_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id),
    CONSTRAINT fk_recarea_area FOREIGN KEY (area_id) REFERENCES area_responsable(area_id)
) ENGINE=InnoDB;

-- Legado: el módulo de Plan de Mejora ahora usa meta.fecha_compromiso y meta.porcentaje_esperado.
CREATE TABLE hito_avance (
    hito_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    recomendacion_id    BIGINT NOT NULL,
    fecha_hito          DATE NOT NULL,
    porcentaje_esperado DECIMAL(5,2) NOT NULL,
    creado_por          BIGINT NOT NULL,
    creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hito_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id),
    CONSTRAINT fk_hito_creado_por FOREIGN KEY (creado_por) REFERENCES usuario(usuario_id),
    CONSTRAINT uq_hito_recomendacion_fecha UNIQUE (recomendacion_id, fecha_hito),
    CONSTRAINT ck_hito_porcentaje CHECK (porcentaje_esperado > 0 AND porcentaje_esperado < 100)
) ENGINE=InnoDB;

CREATE TABLE revision_plan (
    revision_plan_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    version_plan_id    BIGINT NOT NULL,
    revisor_id         BIGINT NOT NULL,
    decision           VARCHAR(20) NOT NULL,
    comentario_general TEXT,
    revisado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_revplan_plan FOREIGN KEY (version_plan_id) REFERENCES version_plan(version_plan_id),
    CONSTRAINT fk_revplan_revisor FOREIGN KEY (revisor_id) REFERENCES usuario(usuario_id),
    CONSTRAINT ck_revision_plan_decision CHECK (decision IN ('APROBADO', 'DEVUELTO'))
) ENGINE=InnoDB;

CREATE TABLE observacion_plan (
    observacion_plan_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    revision_plan_id    BIGINT NOT NULL,
    recomendacion_id    BIGINT NULL,
    comentario          TEXT NOT NULL,
    creada_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_obsplan_revision FOREIGN KEY (revision_plan_id) REFERENCES revision_plan(revision_plan_id),
    CONSTRAINT fk_obsplan_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. Seguimiento: informes y evidencias
-- ---------------------------------------------------------------------
-- Un informe representa un periodo/corte dentro del ciclo; permite varios por ciclo.
CREATE TABLE informe (
    informe_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
    ciclo_id        BIGINT NOT NULL,
    nombre_periodo  VARCHAR(120) NOT NULL,
    fecha_inicio    DATE NOT NULL,
    fecha_fin       DATE NOT NULL,
    fecha_corte     DATE NOT NULL,
    creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_informe_ciclo FOREIGN KEY (ciclo_id) REFERENCES ciclo_acreditacion(ciclo_id),
    CONSTRAINT uq_informe_periodo UNIQUE (ciclo_id, fecha_inicio, fecha_fin),
    CONSTRAINT ck_informe_fechas CHECK (fecha_inicio <= fecha_corte AND fecha_corte <= fecha_fin)
) ENGINE=InnoDB;

CREATE TABLE version_informe (
    version_informe_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    informe_id         BIGINT NOT NULL,
    version_plan_id    BIGINT NOT NULL,
    numero_version     INT NOT NULL,
    estado             VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    creado_por         BIGINT NOT NULL,
    creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enviado_en         DATETIME NULL,
    aprobado_en        DATETIME NULL,
    CONSTRAINT fk_verinf_informe FOREIGN KEY (informe_id) REFERENCES informe(informe_id),
    CONSTRAINT fk_verinf_plan FOREIGN KEY (version_plan_id) REFERENCES version_plan(version_plan_id),
    CONSTRAINT fk_verinf_creado_por FOREIGN KEY (creado_por) REFERENCES usuario(usuario_id),
    CONSTRAINT uq_informe_version UNIQUE (informe_id, numero_version),
    CONSTRAINT ck_informe_version_num CHECK (numero_version > 0),
    CONSTRAINT ck_version_informe_estado CHECK (estado IN ('BORRADOR', 'EN_REVISION', 'APROBADO', 'DEVUELTO'))
) ENGINE=InnoDB;

CREATE TABLE avance_recomendacion (
    avance_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    version_informe_id BIGINT NOT NULL,
    recomendacion_id   BIGINT NOT NULL,
    porcentaje         DECIMAL(5,2) NOT NULL,
    observaciones      TEXT,
    actualizado_por    BIGINT NOT NULL,
    actualizado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_avance_version FOREIGN KEY (version_informe_id) REFERENCES version_informe(version_informe_id),
    CONSTRAINT fk_avance_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id),
    CONSTRAINT fk_avance_actualizado_por FOREIGN KEY (actualizado_por) REFERENCES usuario(usuario_id),
    CONSTRAINT uq_avance_version_recomendacion UNIQUE (version_informe_id, recomendacion_id),
    CONSTRAINT ck_avance_porcentaje CHECK (porcentaje >= 0 AND porcentaje <= 100)
) ENGINE=InnoDB;

CREATE TABLE evidencia (
    evidencia_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    avance_id       BIGINT NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    nombre_guardado VARCHAR(255) NOT NULL,
    ubicacion       TEXT NOT NULL,
    tipo_mime       VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
    tamano_bytes    BIGINT NOT NULL,
    checksum_sha256 CHAR(64),
    cargada_por     BIGINT NOT NULL,
    cargada_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_evidencia_avance FOREIGN KEY (avance_id) REFERENCES avance_recomendacion(avance_id),
    CONSTRAINT fk_evidencia_cargada_por FOREIGN KEY (cargada_por) REFERENCES usuario(usuario_id),
    CONSTRAINT ck_evidencia_pdf CHECK (tipo_mime = 'application/pdf'),
    CONSTRAINT ck_evidencia_tamano CHECK (tamano_bytes > 0)
) ENGINE=InnoDB;

CREATE TABLE revision_informe (
    revision_informe_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    version_informe_id  BIGINT NOT NULL,
    revisor_id          BIGINT NOT NULL,
    decision            VARCHAR(20) NOT NULL,
    comentario_general  TEXT,
    revisado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_revinf_version FOREIGN KEY (version_informe_id) REFERENCES version_informe(version_informe_id),
    CONSTRAINT fk_revinf_revisor FOREIGN KEY (revisor_id) REFERENCES usuario(usuario_id),
    CONSTRAINT ck_revision_informe_decision CHECK (decision IN ('APROBADO', 'DEVUELTO'))
) ENGINE=InnoDB;

CREATE TABLE observacion_informe (
    observacion_informe_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    revision_informe_id    BIGINT NOT NULL,
    recomendacion_id       BIGINT NULL,
    comentario             TEXT NOT NULL,
    creada_en              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_obsinf_revision FOREIGN KEY (revision_informe_id) REFERENCES revision_informe(revision_informe_id),
    CONSTRAINT fk_obsinf_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. Transversales, notificaciones y auditoría
-- ---------------------------------------------------------------------
CREATE TABLE grupo_transversal (
    grupo_transversal_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre               VARCHAR(180) NOT NULL UNIQUE,
    descripcion          TEXT,
    creado_por           BIGINT NOT NULL,
    creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_grupo_creado_por FOREIGN KEY (creado_por) REFERENCES usuario(usuario_id)
) ENGINE=InnoDB;

CREATE TABLE recomendacion_transversal (
    grupo_transversal_id BIGINT NOT NULL,
    recomendacion_id     BIGINT NOT NULL,
    PRIMARY KEY (grupo_transversal_id, recomendacion_id),
    CONSTRAINT fk_rectrans_grupo FOREIGN KEY (grupo_transversal_id) REFERENCES grupo_transversal(grupo_transversal_id),
    CONSTRAINT fk_rectrans_recomendacion FOREIGN KEY (recomendacion_id) REFERENCES recomendacion(recomendacion_id)
) ENGINE=InnoDB;

CREATE TABLE notificacion (
    notificacion_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id      BIGINT NOT NULL,
    tipo            VARCHAR(40) NOT NULL,
    titulo          VARCHAR(180) NOT NULL,
    mensaje         TEXT NOT NULL,
    programada_en   DATETIME NULL,
    enviada_en      DATETIME NULL,
    leida_en        DATETIME NULL,
    estado          VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT fk_notificacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(usuario_id),
    CONSTRAINT ck_notificacion_estado CHECK (estado IN ('PENDIENTE', 'ENVIADA', 'FALLIDA'))
) ENGINE=InnoDB;

-- La bitácora guarda valores como texto para admitir distintos tipos de campo.
-- entidad/entidad_id permite auditar distintas tablas; la aplicación debe validar permisos.
CREATE TABLE registro_auditoria (
    auditoria_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id      BIGINT NOT NULL,
    rol_codigo      VARCHAR(30) NOT NULL,
    entidad         VARCHAR(80) NOT NULL,
    entidad_id      BIGINT NOT NULL,
    campo           VARCHAR(120) NOT NULL,
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    ocurrido_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(usuario_id)
) ENGINE=InnoDB;

-- Evita cambios o borrados ordinarios de la bitácora desde SQL.
CREATE TRIGGER trg_auditoria_sin_update
BEFORE UPDATE ON registro_auditoria FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El registro de auditoría es inmutable';

CREATE TRIGGER trg_auditoria_sin_delete
BEFORE DELETE ON registro_auditoria FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El registro de auditoría es inmutable';

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
CREATE INDEX ix_ciclo_licenciatura ON ciclo_acreditacion(licenciatura_id);
CREATE INDEX ix_plan_ciclo_estado ON version_plan(ciclo_id, estado);
CREATE INDEX ix_recomendacion_indicador ON recomendacion(indicador_id);
CREATE INDEX ix_recomendacion_fecha ON recomendacion(fecha_cumplimiento);
CREATE INDEX ix_hito_fecha ON hito_avance(fecha_hito);
CREATE INDEX ix_meta_fecha ON meta(fecha_compromiso);
CREATE INDEX ix_informe_ciclo_corte ON informe(ciclo_id, fecha_corte);
CREATE INDEX ix_avance_recomendacion ON avance_recomendacion(recomendacion_id);
CREATE INDEX ix_notificacion_usuario_estado ON notificacion(usuario_id, estado);
CREATE INDEX ix_auditoria_entidad ON registro_auditoria(entidad, entidad_id, ocurrido_en);

-- ---------------------------------------------------------------------
-- Datos iniciales (catálogos)
-- ---------------------------------------------------------------------
INSERT INTO rol (codigo, nombre, descripcion) VALUES
    ('ADMINISTRADOR', 'Administrador', 'Acceso global de la Unidad de Planeación'),
    ('CAPTURA', 'Captura', 'Captura información para su coordinación'),
    ('AUXILIAR', 'Auxiliar', 'Apoya la captura de su coordinación; se registra su identidad');

INSERT INTO categoria (nombre, orden) VALUES
    ('Personal Académico', 1),
    ('Estudiantes', 2),
    ('Plan de Estudios', 3),
    ('Evaluación del Aprendizaje', 4),
    ('Formación Integral', 5),
    ('Servicios de Apoyo para el Aprendizaje', 6),
    ('Vinculación y Extensión', 7),
    ('Investigación', 8),
    ('Infraestructura y Equipamiento', 9),
    ('Gestión Administrativa y Financiamiento', 10);
