# Módulos por migrar

Estos módulos se escribieron sobre un esquema provisional (tablas `usuarios`, `planes`, `hitos`… con UUID).
El equipo definió su propio esquema (`db/ssm_mariadb.sql`), así que se están migrando **uno por uno**.

- Están **excluidos de la compilación** (`tsconfig.json` y `tsconfig.build.json`) y no se cargan en `AppModule`.
- Sirven como referencia de la lógica de negocio: validaciones, permisos por rol y flujo de estados.

| Módulo | Tablas del esquema del equipo | Estado |
|---|---|---|
| auth / usuarios | `usuario`, `rol`, `asignacion_usuario`, `coordinacion`, `token_restauracion_contrasena` | ✅ migrado (login) |
| bitacora | `registro_auditoria` | ✅ migrado como `auditoria` |
| planes | `ciclo_acreditacion`, `version_plan`, `indicador`, `recomendacion`, `accion_recomendacion`, `meta`, `hito_avance`, `revision_plan`, `observacion_plan` | pendiente |
| informes | `informe`, `version_informe`, `avance_recomendacion`, `revision_informe`, `observacion_informe` | pendiente |
| evidencias | `evidencia` | pendiente |
| notificaciones | `notificacion` | pendiente |
| reportes | consultas sobre las anteriores | pendiente |
