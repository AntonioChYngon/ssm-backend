-- =====================================================================
-- SSM · Ciclos de acreditación vigentes (datos reales de la FES Acatlán).
-- GENERADO por db/catalogos/generar_ciclos.py a partir de "CICLOS VIGENTES.xlsx". No editar a mano.
-- Lo carga `npm run seed` cuando SEED_CICLOS_REALES=true. Solo crea el ciclo de una licenciatura que aún no
-- tiene ninguno: nunca modifica ni duplica los que ya registró la Administradora.
-- La fecha de emisión no viene en el Excel: se usa el inicio de la vigencia.
-- =====================================================================

-- Sin día en el Excel (se usó del día 1 al último día del mes; confirmar con la constancia):
--   ACT: "Julio de 2025 a agosto de 2030"
-- Sin ciclo (se registra en /admin/ciclos cuando haya constancia):
--   Arquitectura: En proceso (ANPADEH)
--   Ciencias Políticas y Administración Pública: En proceso (ACCECISO)
--   Relaciones Internacionales: En proceso (ACCECISO)
--   Relaciones Internacionales del Sistema de Universidad Abierta y Educación a Distancia: En proceso (ACCECISO)
--   Economía: En proceso (CIEES)
--   Filosofía: sin dato
--   Historia: sin dato
--   Lengua y Literatura Hispánicas: sin dato

INSERT INTO ciclo_acreditacion (licenciatura_id, organismo_id, nombre, fecha_emision, vigencia_inicio, vigencia_fin, estado)
SELECT l.licenciatura_id, o.organismo_id, d.nombre, d.inicio, d.inicio, d.fin, IF(d.fin < CURDATE(), 'HISTORICO', 'VIGENTE')
FROM (
  SELECT 'ACT' AS clave, 'CIEES' AS siglas, '2025-2030' AS nombre, '2025-07-01' AS inicio, '2030-08-31' AS fin
  UNION ALL SELECT 'COM', 'ACCECISO', '2026-2031', '2026-03-02', '2031-03-02'
  UNION ALL SELECT 'SOC', 'ACCECISO', '2026-2031', '2026-03-02', '2031-03-02'
  UNION ALL SELECT 'DER', 'CONAED', '2024-2029', '2024-11-28', '2029-11-28'
  UNION ALL SELECT 'DER-SUA', 'CONAED', '2024-2029', '2024-11-28', '2029-11-28'
  UNION ALL SELECT 'DG', 'COMAPROD', '2026-2031', '2026-08-19', '2031-08-19'
  UNION ALL SELECT 'LEI', 'COAPEHUM', '2023-2028', '2023-10-31', '2028-10-31'
  UNION ALL SELECT 'IC', 'CACEI', '2024-2027', '2024-08-01', '2027-07-31'
  UNION ALL SELECT 'MAC', 'CONAIC', '2022-2027', '2022-10-24', '2027-10-23'
  UNION ALL SELECT 'PED', 'CEPPE', '2023-2028', '2023-04-26', '2028-04-26'
  UNION ALL SELECT 'LICEL-SUA', 'CEPPE', '2025-2030', '2025-06-26', '2030-06-26'
) d
JOIN licenciatura l ON l.clave = d.clave
JOIN organismo_acreditador o ON o.siglas = d.siglas
WHERE NOT EXISTS (SELECT 1 FROM ciclo_acreditacion c WHERE c.licenciatura_id = l.licenciatura_id);
