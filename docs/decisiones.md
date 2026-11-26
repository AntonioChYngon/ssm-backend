# Decisiones funcionales del SSM

Registro corto de lo que decidió el equipo y cómo se implementa. Fecha de esta versión: 26/11/2026.
Viene de la rama `hu-04-plan` (16/11/2026); se actualizó con lo que ya está en `main`.
Si una decisión cambia, edita su sección y anota la nueva fecha; no borres el historial de Git.

| # | Tema | Estado | Historia |
|---|---|---|---|
| D1 | Correos `@unam.mx` | Vigente: solo dominios de Acatlán | HU-01, HU-02 |
| D2 | Metas medibles | **Implementada con una regla más simple** (D8): cada meta incluye al menos una cifra | HU-04 |
| D3 | Avance que cuenta el resumen | Propuesta, sin implementar | HU-15 |
| D4.1 | Descripción del hito | Propuesta, sin implementar | HU-12 |
| D4.2 | Observación "atendida" | Propuesta, sin implementar | HU-05, HU-08 |
| D4.3 | Canal de notificación | **Descartada**: la HU-10 corregida exige canal dual (correo + aviso en el sistema) | HU-10, HU-11, HU-05 |
| D5 | Corregir un plan DEVUELTO | Implementada (se corrige sobre la misma versión) | HU-04, HU-05 |
| D6 | Catálogo base | Reemplazada: los catálogos salen de Catálogos.xlsx (`db/catalogos_base.sql`) | Todas |
| D7 | Ciclo de acreditación por licenciatura | Implementada en HU-18 | HU-04, HU-06, HU-16, HU-18 |
| D8 | Metas medibles y fecha/% en la captura del plan | Implementada | HU-04, HU-12 |

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

## D4.3 · Canal de notificación (descartada, 25/11/2026)
Se proponía que cada usuario eligiera en Mi perfil recibir avisos por correo, en el sistema o ambos. La HU-10 corregida
pide **canal dual** fijo (correo institucional + aviso en el sistema), así que todos los avisos salen por los dos canales
(así funciona desde el parche 10) y el selector se quitó de Mi perfil.

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

## D8 · Metas medibles y fecha/% en la captura del plan (HU-04, HU-12)
- **Metas medibles:** una meta es cuantitativa si expresa al menos una cifra ("Capacitar al 80% de la planta docente",
  "Abrir 3 optativas nuevas"). Se exige al **enviar** el plan, no al guardar el borrador. Reemplaza la propuesta D2,
  que solo aceptaba porcentajes. Es reversible: la regla vive en `esMetaCuantitativa()` (backend) y `esMedible()` (frontend).
- **Fecha compromiso y % esperado desde la pantalla del plan:** cada meta del formulario trae sus campos de fecha y %.
  Son opcionales en el borrador, pero van juntos (si se llena uno se pide el otro) y siguen las reglas de HU-12.
  La pestaña *Metas* sigue funcionando igual; las dos pantallas editan los mismos datos.
- API: `metas` en `POST /ciclos/:id/plan/recomendaciones` y `PUT /recomendaciones/:id` acepta `{ descripcion, fechaCompromiso, porcentajeEsperado }`
  (`null` vacía, ausente conserva lo configurado en Metas) y también el formato anterior de solo texto.
- En discusión con el equipo (25/11/2026): si la pestaña *Metas* se conserva o se retira.

## D9 · Bloque Informe de Seguimiento (HU-07, HU-08, HU-11) · 25/11/2026
Plan completo y lista de decisiones en el proyecto del equipo (`bloque-informe-plan.md` y `bloque-informe-decisiones.md`).
- **Un informe por semestre** (`2026-1`, `2026-2`…), con calendario UNAM: `AAAA-1` = agosto del año anterior a enero y
  `AAAA-2` = febrero a julio. El primer y el último semestre se recortan a la vigencia del ciclo; el corte es el último día.
  Las fechas viven **solo** en la constante `SEMESTRES` de `src/modules/informes/reglas.ts` (comentada para cambiarla).
- El informe se liga a la última versión **APROBADA** del plan; sin plan aprobado no se inicia.
- **% de avance escrito con teclado**, entero de 0 a 100 (HU-07 decía "catálogo"; va en minuta con el cliente).
  También hay un CHECK en la base (`ck_avance_entero`).
- **Evidencia obligatoria solo al 100 %**, y se revisa al enviar. Archivos `.pdf .docx .xlsx .pptx` de hasta 15 MB
  (`EVIDENCIA_MAX_MB`), revisando extensión y firma; los de Office se convierten a PDF con LibreOffice (`SOFFICE_BIN`).
  Sin LibreOffice o si falla la conversión, la interfaz ofrece el enlace (Plan B). La tabla `evidencia` distingue `origen`
  `ARCHIVO`/`URL` y guarda `url_vista` para Drive.
- Carpeta de cada recomendación: `/Evidencias/[Licenciatura]/[Ciclo]/Informe-[semestre]/Rec-[NN]/`, nombres generados por el sistema.
- Estados `BORRADOR → EN_REVISION → APROBADO / DEVUELTO`; las correcciones van sobre la misma versión (como D5).
  El Administrador puede **validar, devolver y reabrir aunque el ciclo haya cerrado**; la coordinación sigue bloqueada por HU-18.
  La reapertura se guarda en `revision_informe` como `DEVUELTO` con su motivo.
- `editable` y `bloqueo` los calcula solo el backend. Otra licenciatura responde 404 (no se revela que el informe exista).
- El Plan de Mejora no se toca: el informe tiene sus propias reglas (`informes/reglas.ts`).
- Para subir o enlazar una evidencia, primero se captura el % de su recomendación (la evidencia cuelga del avance).
- Endpoints (el `id` de un informe es su `version_informe_id`; toda acción responde el informe completo):
  - Consulta: `GET /informes` (filtros `estado`, `licenciaturaId`, `licenciaturaIds`, `cicloId`, `periodo`), `GET /informes/mio`,
    `GET /informes/:id`, `GET /evidencias/:id/archivo`.
  - Coordinación (HU-07): `POST /ciclos/:cicloId/informes`, `PUT /informes/:id/avances/:recomendacionId`,
    `POST /informes/:id/avances/:recomendacionId/evidencias` (multipart `archivo`), `POST …/enlaces`, `DELETE /evidencias/:id`,
    `POST /informes/:id/enviar` (avisa a los Administradores, HU-11).
  - Administrador (HU-08): `POST /informes/:id/validar`, `/devolver` (motivo + observaciones por recomendación), `/reabrir` (motivo).
- Errores: 400 validación, 403 rol, 404 otra licenciatura o recomendación ajena, 409 estado o ciclo cerrado,
  413 peso, 415 tipo, 503 conversión o carpeta (la interfaz ofrece reintentar o el enlace).

## D10 · Auditoría por campo y bitácora (HU-03) · 25/11/2026
- Cada guardado registra **una fila por campo que cambió** (`AuditoriaService.registrarCambios`), con valor anterior y nuevo
  y el rol de la sesión (Captura o Auxiliar). Si nada cambió no se registra nada. Crear y eliminar siguen siendo una fila.
- Plan: categoría, indicador, recomendación, acciones, metas (con fecha y %), área responsable y fecha de cumplimiento.
- Informe: `entidad = avance_recomendacion` con `entidad_id` = **id de la recomendación** y el semestre en el campo
  ("porcentaje · Informe 2027-1", "evidencia agregada · Informe 2027-1"). Así la línea de tiempo de una recomendación
  junta su captura en el plan y su avance en todos los informes. Los cambios de estado van en `version_informe`.
- `GET /auditoria` (Administrador): filtros `rol`, `area` (SESIONES, CUENTAS, PLAN, INFORME, CICLOS), `desde`/`hasta`
  (día de la Ciudad de México), `q`, `licenciaturaIds`, `pagina`, `limite`. La licenciatura de un registro es la de lo que
  se modificó, no la de quien lo hizo. `GET /auditoria/recomendaciones/:id`: línea de tiempo, de lo más antiguo a lo más reciente.
- La bitácora sigue siendo inmutable (triggers `trg_auditoria_sin_update` y `trg_auditoria_sin_delete`). Mi perfil agrupa las
  filas de un mismo guardado en un solo movimiento.

## D11 · Varias licenciaturas para el Administrador (HU-13) · 25/11/2026
- `licenciaturaIds=1,2,3` en `GET /planes`, `/informes`, `/ciclos` y `/auditoria`; sin el parámetro, todas.
- Captura y Auxiliar siguen limitados a su licenciatura: el filtro solo reduce, nunca amplía (pruebas en `test/multicarrera.e2e-spec.ts`).
- El dashboard, los reportes (HU-14, HU-15) y el histórico (HU-16) todavía usan datos de ejemplo; usarán el mismo parámetro.

## Bases de datos existentes
Cada cambio de esquema tiene su script en `db/migraciones/`. En desarrollo es más fácil recrear la base:
`podman compose down`, `podman volume rm ssm-backend_ssm-db`, `podman compose up -d db correo` y `npm run seed`.
