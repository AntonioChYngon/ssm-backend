-- =====================================================================
-- SSM · Catálogos base (datos REALES, no de prueba). Los carga `npm run seed` siempre, en todos los entornos.
-- Se puede ejecutar varias veces: INSERT IGNORE no duplica (los nombres y claves son UNIQUE).
-- Las 10 categorías y los roles ya vienen en db/ssm_mariadb.sql.
--
-- Fuentes:
--   Licenciaturas: oferta académica de la FES Acatlán publicada por la DGOAE-UNAM.
--   Áreas: las que nombra el cliente en el Anexo 1 (Secretaría General, División del SUAyED,
--          Coordinaciones de programa), la Unidad de Planeación y las que aparecen en los informes
--          de actividades y memorias UNAM de la FES Acatlán.
--   Organismos: organismos acreditadores reconocidos por COPAES para estas disciplinas, más CIEES.
-- PENDIENTE: que la Unidad de Planeación valide nombres de áreas y organismos (docs/decisiones.md, D6).
-- =====================================================================

-- ---------- Licenciaturas (una coordinación por licenciatura y modalidad) ----------
INSERT IGNORE INTO licenciatura (clave, nombre, modalidad) VALUES
  ('ACT',     'Actuaría',                                         'Escolarizada'),
  ('ARQ',     'Arquitectura',                                     'Escolarizada'),
  ('CDA',     'Ciencia de Datos',                                 'Escolarizada'),
  ('CPAP',    'Ciencias Políticas y Administración Pública',      'Escolarizada'),
  ('COM',     'Comunicación',                                     'Escolarizada'),
  ('DER',     'Derecho',                                          'Escolarizada'),
  ('DER-SUA', 'Derecho (Sistema de Universidad Abierta)',         'Abierta'),
  ('DG',      'Diseño Gráfico',                                   'Escolarizada'),
  ('ECO',     'Economía',                                         'Escolarizada'),
  ('EIN',     'Enseñanza de Inglés',                              'Escolarizada'),
  ('EILE',    'Enseñanza de Idioma como Lengua Extranjera',       'A Distancia'),
  ('FIL',     'Filosofía',                                        'Escolarizada'),
  ('HIS',     'Historia',                                         'Escolarizada'),
  ('IC',      'Ingeniería Civil',                                 'Escolarizada'),
  ('LLH',     'Lengua y Literatura Hispánicas',                   'Escolarizada'),
  ('MAC',     'Matemáticas Aplicadas y Computación',              'Escolarizada'),
  ('PED',     'Pedagogía',                                        'Escolarizada'),
  ('RI',      'Relaciones Internacionales',                       'Escolarizada'),
  ('RI-SUA',  'Relaciones Internacionales (Sistema de Universidad Abierta)', 'Abierta'),
  ('SOC',     'Sociología',                                       'Escolarizada');

INSERT IGNORE INTO coordinacion (licenciatura_id, nombre)
SELECT licenciatura_id, CONCAT('Coordinación de ', nombre) FROM licenciatura;

-- ---------- Organismos acreditadores o IEVA ----------
INSERT IGNORE INTO organismo_acreditador (nombre, siglas) VALUES
  ('Consejo para la Acreditación de la Enseñanza del Derecho, A.C.', 'CONAED'),
  ('Asociación para la Acreditación y Certificación de Ciencias Sociales, A.C.', 'ACCECISO'),
  ('Comité para la Evaluación de Programas de Pedagogía y Educación, A.C.', 'CEPPE'),
  ('Consejo para la Acreditación de Programas Educativos en Humanidades, A.C.', 'COAPEHUM'),
  ('Consejo de Acreditación de la Comunicación, A.C.', 'CONAC'),
  ('Consejo Nacional para la Acreditación de la Ciencia Económica, A.C.', 'CONACE'),
  ('Consejo Nacional de Acreditación en Informática y Computación, A.C.', 'CONAIC'),
  ('Consejo de Acreditación de la Enseñanza de la Ingeniería, A.C.', 'CACEI'),
  ('Acreditadora Nacional de Programas de Arquitectura y Disciplinas del Espacio Habitable, A.C.', 'ANPADEH'),
  ('Consejo Mexicano para la Acreditación de Programas de Diseño, A.C.', 'COMAPROD'),
  ('Comités Interinstitucionales para la Evaluación de la Educación Superior, A.C.', 'CIEES');

-- ---------- Áreas responsables ----------
INSERT IGNORE INTO area_responsable (nombre) VALUES
  ('Secretaría General'),
  ('Secretaría Administrativa'),
  ('Unidad de Planeación'),
  ('Coordinación de Servicios Académicos'),
  ('Coordinación de Posgrado'),
  ('Unidad de Investigación Multidisciplinaria Aplicada'),
  ('División del SUAyED'),
  ('División de Ciencias Jurídicas'),
  ('División de Ciencias Socioeconómicas'),
  ('División de Diseño y Edificación'),
  ('División de Matemáticas e Ingeniería');

-- Cada Coordinación de programa también puede ser área responsable (Anexo 1 del cliente).
INSERT IGNORE INTO area_responsable (nombre)
SELECT nombre FROM coordinacion;
