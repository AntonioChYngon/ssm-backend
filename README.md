# SSM · Backend

API del **Sistema de Seguimiento de Mejora (SSM)** de la FES Acatlán, UNAM. Proyecto de Algorix.

- **Stack:** NestJS, TypeORM, MariaDB, Node.js y TypeScript.
- **Frontend:** [`ssm-frontend`](https://github.com/AntonioChYngon/ssm-frontend), hecho en Next.js.
- **Base de datos:** esquema del equipo en `db/ssm_mariadb.sql`. TypeORM **no** crea ni modifica tablas (`synchronize: false`).
- **Despliegue:** Podman (`Containerfile` y `compose.yaml`).

> **¿Eres del equipo?** Empieza por [`CONTRIBUTING.md`](CONTRIBUTING.md): reparto de historias, base de datos con Podman en un comando, pruebas y CI.

## Arranque local

1. Crea la base con `db/ssm_mariadb.sql` y el usuario de la aplicación con `db/ssm_usuario_app.sql` (DBeaver o cliente `mariadb`).
2. Configura y arranca:

```bash
cp .env.example .env     # DB_PASSWORD de ssm_app, JWT_SECRET y contraseñas SEED_*
npm install
npm run seed             # catálogos reales, un Administrador, un Captura y (opcional) las cuentas de coordinación
npm run start:dev        # http://localhost:3001/api  ·  Swagger en /api/docs
npm test                 # validación de dominio y contraseña
```

## Catálogos y cuentas de coordinación

- `db/catalogos_base.sql` trae las 19 licenciaturas (con su coordinación), 10 categorías, 9 organismos y 216 áreas responsables de **Catálogos.xlsx**. El seed lo carga siempre y se puede repetir sin duplicar.
- Cuando cambie el Excel: `python -m pip install openpyxl` y `python db/catalogos/generar_catalogos.py "ruta/Catálogos.xlsx"`. Regenera el SQL y `src/database/cuentas-coordinaciones.ts`; sube ambos en un PR.
- Con `SEED_CUENTAS_COORDINACIONES=true` y `SEED_CUENTAS_PASSWORD` en el `.env`, el seed crea una cuenta **Captura** por coordinación con su correo institucional y contraseña temporal. Actuaría usa la cuenta `SEED_CAPTURA_*` (por defecto actuaria@). Las licenciaturas que comparten correo en el Excel (progpol@, prohum@) solo reciben una cuenta: el seed lista cuáles quedaron pendientes para que el Administrador las dé de alta con un correo propio.

## Ciclos de acreditación (HU-18)

Cada licenciatura tiene su ciclo con su organismo y una vigencia de hasta 5 años; solo uno activo a la vez. Al crearlo se genera la carpeta `/Evidencias/[Licenciatura]/[20XX-20XX]/` (proveedor `local`, en `CARPETAS_DIR`; Google Drive llegará con `CARPETAS_PROVEEDOR=drive`). Al pasar la fecha de fin, la captura del plan queda bloqueada. Detalle y razones en [`docs/decisiones.md`](docs/decisiones.md) (D7). En una base existente aplica `db/migraciones/2026-11-26_ciclos_hu18.sql`.

## Contraseñas temporales

Las cuentas creadas por el Administrador, las que él restablece y las de coordinación del seed nacen con `debe_cambiar_contrasena = TRUE`. Mientras siga así, el token solo sirve para `GET /auth/me` y `POST /auth/cambiar-contrasena` (lo demás responde 403) y el frontend lleva a la persona a `/cambiar-contrasena`. Al cambiarla, la respuesta trae un token nuevo y la sesión continúa. En una base existente aplica `db/migraciones/2026-11-25_cambio_obligatorio_contrasena.sql`.

## Avisos (HU-05, HU-08, HU-11)

Cada aviso del flujo del plan se guarda para la campana de la aplicación y se envía por correo al mismo tiempo, con un enlace a la pantalla donde se atiende. Sin `SMTP_HOST` el correo solo se escribe en la consola; con Mailpit (`SMTP_HOST=localhost`, `SMTP_PORT=1025`) se ve en http://localhost:8025. Si el correo falla, el aviso de la campana queda igual con estado `FALLIDA`.

## Endpoints disponibles

Prefijo `/api`. Todas piden `Authorization: Bearer <token>`, salvo las públicas.

| Endpoint | Acceso | HU |
|---|---|---|
| `POST /auth/login` | pública, 5 intentos/min | HU-01 |
| `POST /auth/recuperar` | pública, 3 intentos/min | HU-02 |
| `POST /auth/restablecer` | pública | HU-02 |
| `GET /auth/me` | cualquier sesión | HU-01 |
| `POST /auth/cambiar-contrasena` | cualquier sesión | HU-02 |
| `GET /auditoria?entidad&desde&hasta&limite` | Administrador | HU-03 |
| `GET /catalogos` | cualquier sesión | HU-04 |
| `GET /planes` | Administrador: todos · Captura/Auxiliar: su licenciatura | HU-04 |
| `GET /planes/mio` | Captura, Auxiliar | HU-04 |
| `GET /planes/:id` | Administrador o la licenciatura del plan | HU-04 |
| `POST /ciclos/:cicloId/plan/recomendaciones` (Guardar borrador) | Captura, Auxiliar | HU-04 |
| `PUT /recomendaciones/:id` · `DELETE /recomendaciones/:id` | Captura, Auxiliar | HU-04 |
| `PUT /recomendaciones/:id/metas` (Configuración de Metas) | Captura, Auxiliar | HU-12 |
| `POST /planes/:id/enviar` | Captura, Auxiliar | HU-04 |
| `POST /planes/:id/validar` · `POST /planes/:id/devolver` | Administrador | HU-05 |
| `GET /ciclos` · `POST /ciclos` · `PATCH /ciclos/:cicloId` | Administrador | HU-18 |
| `POST /ciclos/:cicloId/carpeta` (crear la carpeta de un ciclo que no la tiene) | Administrador | HU-18 |
| `GET /planes/:id/pdf` · `GET /planes/:id/docx` (Plan de Mejora Continua con membrete) | Administrador, Captura y Auxiliar de su licenciatura | HU-06 |
| `GET /informes/:id/pdf` · `GET /informes/:id/docx` (Informe de Seguimiento con membrete y evidencias como hipervínculos) | Administrador, Captura y Auxiliar de su licenciatura | HU-09 |
| `GET /recordatorios` (banner al iniciar sesión: fechas límite próximas, vencidas y rezagos) | Captura, Auxiliar | HU-10 |
| `POST /recordatorios/ejecutar` (corre ya la revisión diaria; no repite avisos) | Administrador | HU-10 |
| `GET /transversales/recomendaciones?licenciaturaIds&ciclos=vigentes\|historicos\|todos&soloTransversales&grupoId&q` (consulta con el filtro "sólo transversales") | Administrador | HU-17 |
| `GET /transversales/grupos` (vista agrupada con avance consolidado) · `POST /transversales/grupos` · `PATCH`/`DELETE /transversales/grupos/:id` | Administrador | HU-17 |
| `POST /transversales/marcar` · `POST /transversales/desmarcar` (etiquetado manual de una o varias recomendaciones) | Administrador | HU-17 |
| `GET /transversales/reporte/pdf` · `GET /transversales/reporte/docx` (reporte consolidado) | Administrador | HU-17 |
| `GET /historico/ciclos?licenciaturaIds&fecha` (ciclos vigentes e históricos para elegir por vigencia) | Administrador, Captura, Auxiliar (su licenciatura) | HU-16 |
| `GET /historico/ciclos/:id` (plan, informes y resumen de atención del ciclo) | Administrador, Captura, Auxiliar (su licenciatura) | HU-16 |
| `cicloId` en `/reportes/atencion`, `/reportes/incumplimiento` y `/transversales/*` (consulta sobre un ciclo histórico) | Administrador | HU-16 |
| `GET /notificaciones` · `PATCH /notificaciones/:id/leida` | cualquier sesión | HU-10 |

El Informe de Seguimiento (HU-07, HU-08, HU-11) vive en `src/modules/informes/` (decisiones en `docs/decisiones.md`, D9); la auditoría por campo y la bitácora (HU-03) en `src/modules/auditoria/` (D10); el filtro de varias licenciaturas (HU-13) en `src/common/licenciaturas.ts` (D11). En una base existente aplica `db/migraciones/2026-11-27_informe_evidencias.sql`.
El resto de los módulos (reportes) se está migrando al esquema del equipo; ver `src/modules/_por-migrar/LEEME.md`.

## Reglas del Plan de Mejora

- **Estados** (`version_plan.estado`): `BORRADOR` → `EN_REVISION` (En validación) → `APROBADO` (Validado) o `DEVUELTO`. Solo se edita en Borrador o Devuelto; al devolver se corrige la misma versión.
- **Guardar borrador:** exige Categoría, Indicador y Recomendación. **Enviar a validación:** cada recomendación necesita acciones, al menos una meta, área responsable y fecha de cumplimiento dentro de la vigencia del ciclo.
- **Indicador y Área responsable** son texto abierto. El indicador se reutiliza si en el plan ya existe uno con la misma categoría y texto.
- **Metas** (antes "hitos"): se capturan con la recomendación y se configuran con fecha compromiso y % esperado (1–99, fechas ascendentes, sin pasar la fecha de cumplimiento). `hito_avance` queda como tabla heredada.
- **Avisos:** al enviar se notifica a los Administradores; al validar o devolver, a Captura y Auxiliar de la licenciatura.
- Cambios de esquema sobre una base existente: `db/migraciones/2026-11-17_plan_mejora.sql`.

## Reglas del inicio de sesión

- **Correo institucional:** solo `@acatlan.unam.mx` y `@pcpuma.acatlan.unam.mx`, igual que el CHECK de la tabla `usuario` (`DOMINIOS_PERMITIDOS`).
- **Rol:** sale de la asignación activa en `asignacion_usuario`. Sin asignación activa no se puede entrar.
- **Alcance:** Captura y Auxiliar solo ven su coordinación (`verificarCoordinacion`); el Administrador ve todo.
- **Auditoría:** cada inicio de sesión, intento fallido y cambio de contraseña queda en `registro_auditoria` (la base impide editarlo o borrarlo).
- **Seguridad (lineamientos DGTIC):**
  - helmet, CORS restringido, límite de intentos y bcrypt con costo 12.
  - El mismo mensaje y un tiempo de respuesta similar exista o no la cuenta.
  - Los tokens de recuperación se guardan como SHA-256 y vencen en 30 minutos.

## Pendientes

- Envío de correos (enlace de recuperación y avisos). Se necesita el SMTP institucional.
- Migrar los módulos de `_por-migrar` al esquema del equipo.
- Decisiones abiertas del equipo: aceptar o no `@unam.mx`, cómo se marca una observación como atendida y preferencia de canal de notificación.
