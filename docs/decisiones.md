# Decisiones funcionales del SSM

Registro corto de lo que decidió el equipo y cómo se implementa. Fecha de esta versión: 26/11/2026.
Viene de la rama `hu-04-plan` (16/11/2026); se actualizó con lo que ya está en `main`.
Si una decisión cambia, edita su sección y anota la nueva fecha; no borres el historial de Git.

| # | Tema | Estado | Historia |
|---|---|---|---|
| D1 | Correos `@unam.mx` | Vigente: solo dominios de Acatlán | HU-01, HU-02 |
| D2 | Metas medibles | Propuesta, sin implementar | HU-04 |
| D3 | Avance que cuenta el resumen | Propuesta, sin implementar | HU-15 |
| D4.1 | Descripción del hito | Propuesta, sin implementar | HU-12 |
| D4.2 | Observación "atendida" | Propuesta, sin implementar | HU-05, HU-08 |
| D4.3 | Canal de notificación | Propuesta, sin implementar (hoy todo aviso va por correo e In-App) | HU-10, HU-11, HU-05 |
| D5 | Corregir un plan DEVUELTO | Implementada (se corrige sobre la misma versión) | HU-04, HU-05 |
| D6 | Catálogo base | Reemplazada: los catálogos salen de Catálogos.xlsx (`db/catalogos_base.sql`) | Todas |
| D7 | Ciclo de acreditación por licenciatura | Implementada en HU-18 | HU-04, HU-06, HU-16, HU-18 |

> Las propuestas D2–D4 se discutieron en el Sprint 1 pero su código quedó en la rama `hu-04-plan`, que no se unió.
> Antes de implementarlas, confírmenlas contra `Historias de usuario corregida.docx`.

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

## D6 · Catálogo base (reemplazada)
Los catálogos reales vienen de **Catálogos.xlsx**: `db/catalogos/generar_catalogos.py` genera `db/catalogos_base.sql`
(19 licenciaturas, 10 categorías, 9 organismos, 216 áreas) y el seed lo carga siempre. Los datos ficticios de
`db/datos_desarrollo.sql` solo se cargan con `SEED_DATOS_DESARROLLO=true`.

## D7 · Ciclo de acreditación por licenciatura (HU-18)
- HU-18 habla de "un ciclo" con nombre y fechas. Se decidió (26/11/2026) que **cada licenciatura tiene su propio ciclo**,
  porque cada una se acredita con su organismo o IEVA y en fechas distintas, y HU-06 y HU-16 necesitan esos datos por licenciatura.
- La Administradora inicia el ciclo en *Ciclos de acreditación*: licenciatura, organismo o IEVA, nombre (opcional; por defecto
  "AAAA-AAAA"), fecha de emisión de la constancia, inicio y fin de la vigencia y, opcional, la referencia de la constancia.
- Reglas: fechas reales, fin después del inicio, **máximo 5 años**, emisión antes del fin.
- **Un solo ciclo activo por licenciatura** (también como UNIQUE en la base). Mientras no pase su fecha de fin no se puede
  iniciar otro; al iniciar el siguiente, el anterior pasa a `HISTORICO`. Un ciclo con la vigencia ya vencida se registra
  directo como `HISTORICO` (para cargar el histórico de HU-16).
- **Bloqueo automático:** al pasar la fecha de fin, la coordinación no puede capturar ni enviar el plan (y, cuando existan,
  guardar avances ni subir evidencias). Mensaje: "El ciclo de acreditación ha finalizado. Contacte a la Unidad de Planeación
  para iniciar un nuevo ciclo." El día se calcula con la hora de la Ciudad de México.
- **Carpeta de evidencias:** al crear el ciclo se crea `/Evidencias/[Licenciatura]/[nombre]/`. Hoy con el proveedor `local`
  (disco, `CARPETAS_DIR`); Google Drive se conectará con `CARPETAS_PROVEEDOR=drive` cuando la FES dé una cuenta de servicio.
  Ninguna carpeta se borra: las de ciclos anteriores quedan para consulta.
- Se puede corregir el ciclo mientras la coordinación no haya capturado nada; la licenciatura no cambia.
- Endpoints (solo Administradora): `GET /ciclos`, `POST /ciclos`, `PATCH /ciclos/:cicloId`, `POST /ciclos/:cicloId/carpeta`.

## Bases de datos existentes
Cada cambio de esquema tiene su script en `db/migraciones/`. En desarrollo es más fácil recrear la base:
`podman compose down`, `podman volume rm ssm-backend_ssm-db`, `podman compose up -d db correo` y `npm run seed`.
