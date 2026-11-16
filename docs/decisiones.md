# Decisiones funcionales del SSM

Registro corto de lo que decidió el equipo y cómo se implementa. Fecha de esta versión: 16/11/2026.
Si una decisión cambia, edita su sección y anota la nueva fecha; no borres el historial de Git.

| # | Tema | Estado | Historia |
|---|---|---|---|
| D1 | Correos `@unam.mx` | Pendiente (fuera de esta iteración) | HU-01, HU-02 |
| D2 | Metas medibles | Decidida e implementada | HU-04 |
| D3 | Avance que cuenta el resumen | Decidida | HU-15 |
| D4.1 | Descripción del hito | Decidida; esquema listo | HU-12 |
| D4.2 | Observación "atendida" | Decidida; esquema listo | HU-05, HU-08 |
| D4.3 | Canal de notificación | Decidida; esquema listo | HU-10, HU-11, HU-05 |
| D5 | Corregir un plan DEVUELTO | Decidida | HU-04, HU-05 |

## D1 · Correos `@unam.mx`
Se mantienen solo `@acatlan.unam.mx` y `@pcpuma.acatlan.unam.mx`. Se revisará en otra iteración.

## D2 · Metas medibles (HU-04)
- Cada meta expresa su objetivo **en porcentaje**, de 0% a 100% (0% sirve para metas de reducción).
  Ejemplo válido: "Capacitar al 80% de la planta docente". Inválido: "Capacitar a 30 profesores".
- El plazo del objetivo es la **fecha de cumplimiento** de la recomendación, que debe estar dentro de la vigencia de 5 años.
- Los porcentajes intermedios se fijan con los hitos (HU-12): `% esperado` entre 1 y 99 y fecha del hito anterior a la fecha de cumplimiento.
- Código: `validarMetaMedible()` en `src/modules/planes/reglas.ts` y `src/lib/reglas.ts` del frontend (misma regla en los dos lados).

## D3 · Avance que cuenta el resumen (HU-15)
Cuenta el **último informe capturado**, no el último aprobado: la `version_informe` más reciente del informe más reciente
del ciclo, en cualquier estado. Así el resumen refleja lo último que reportó la licenciatura.
Con `db/datos_desarrollo.sql` los resultados esperados no cambian (DER 1/1/2, ECO 2/1/0).

## D4.1 · Descripción del hito (HU-12)
- `hito_avance.descripcion` (obligatoria, hasta 255 caracteres): el **entregable verificable** que demuestra el avance.
  Ejemplo: "Programa de actualización aprobado por el Comité de Carrera".
- En la interfaz de Hitos: una fila por hito con *Descripción*, *Fecha hito* y *% esperado*.

## D4.2 · Observación "atendida" (HU-05 y HU-08)
- Columnas nuevas en `observacion_plan` y `observacion_informe`: `atendida_en`, `atendida_por`, `respuesta`.
  Un CHECK obliga a llenar las tres juntas o ninguna.
- **Quién y cómo:** Captura o Auxiliar marca cada observación como atendida escribiendo una **respuesta obligatoria**
  (qué corrigió). Puede desmarcarla mientras el documento siga DEVUELTO.
- **Regla de envío:** el documento no se puede reenviar a revisión mientras tenga observaciones sin atender.
- **Revisión:** el Administrador ve la respuesta junto a cada observación; si no la acepta, devuelve otra vez con una observación nueva.
  El historial completo queda en la base y en la auditoría (HU-03).
- **Interfaz:** en `/licenciatura/observaciones`, cada observación muestra la casilla "Atendida" y, al marcarla, un campo de respuesta.
  El botón "Enviar a validación" muestra cuántas faltan.

## D4.3 · Canal de notificación (HU-10, HU-11, HU-05)
- `usuario.canal_notificacion`: `CORREO`, `IN_APP` o `AMBOS` (por defecto `AMBOS`). Se elige en `/perfil`.
- `notificacion.canal`: el canal que se usó para cada aviso, decidido al crearlo:
  - **Avisos críticos → siempre `AMBOS`**, sin importar la preferencia: devolución con observaciones, validación,
    vencimiento de la fecha de cumplimiento y "entrega completa" al Administrador (HU-05 y HU-11 exigen correo).
  - **Avisos no críticos** (recordatorios de hitos) → la preferencia del usuario.
- La campana muestra los avisos con canal `IN_APP` o `AMBOS`; el correo se envía para `CORREO` o `AMBOS`.
- Un solo servicio decide el canal (`resolverCanal(tipo, preferencia)`), así agregar un canal nuevo no toca a quien envía el aviso.

## D5 · Corregir un plan DEVUELTO (HU-04, HU-05)
Se corrige **sobre la misma versión** (sin crear una nueva). Así los ids de las recomendaciones no cambian y cada observación
sigue apuntando a la recomendación que corrige. La trazabilidad queda en `revision_plan`, `observacion_plan` y la auditoría.

## Bases de datos existentes
Las columnas nuevas ya están en `db/ssm_mariadb.sql`. Si tu base es anterior al 16/11/2026, recréala
(`podman compose down -v`, `podman compose up -d db correo`, `npm run seed`) o aplica `db/migraciones/001_decisiones_sprint1.sql`.
