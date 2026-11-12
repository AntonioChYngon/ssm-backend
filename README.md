# SSM · Backend

API del **Sistema de Seguimiento de Mejora (SSM)** de la FES Acatlán, UNAM. Proyecto de Algorix.

- **Stack:** NestJS, TypeORM, MariaDB, Node.js y TypeScript.
- **Frontend:** [`ssm-frontend`](https://github.com/AntonioChYngon/ssm-frontend), hecho en Next.js.
- **Despliegue:** Podman (`Containerfile` y `compose.yaml`).

## Arranque local

```bash
cp .env.example .env              # ajusta contraseñas y JWT_SECRET
podman-compose up -d db           # MariaDB 11.4 en el puerto 3306
npm install
npm run start:dev                 # http://localhost:3001/api  ·  Swagger en /api/docs
npm run seed                      # licenciaturas + usuario Administrador
npm test                          # pruebas unitarias (validación de dominio y contraseña)
```

Con `DB_SYNC=true`, TypeORM crea las tablas a partir de las entidades, y solo lo hace fuera de producción. Para producción hay que generar migraciones con `typeorm migration:generate`.

## Módulos y endpoints

Todas las rutas usan el prefijo `/api` y piden `Authorization: Bearer <token>`, salvo las marcadas como públicas.

| Módulo | Endpoints principales | Roles | HU |
|---|---|---|---|
| auth | `POST /auth/login` (pública), `POST /auth/recuperar` (pública), `POST /auth/restablecer` (pública), `GET /auth/me`, `POST /auth/cambiar-contrasena` | todos | HU-01, HU-02 |
| usuarios | `GET/POST /usuarios`, `PATCH /usuarios/:id`, `POST /usuarios/:id/restablecer`, `PATCH /usuarios/yo/preferencias` | Admin (preferencias: todos) | HU-02 |
| licenciaturas | `GET/POST /licenciaturas` | Admin para crear | — |
| planes | `GET /planes`, `GET /planes/:id`, `POST /planes`, `POST /planes/:id/recomendaciones`, `PUT /recomendaciones/:id`, `PUT /recomendaciones/:id/hitos`, `POST /planes/:id/enviar`, `POST /planes/:id/validar`, `POST /planes/:id/devolver`, `PATCH /recomendaciones/:id/etiquetas` | ver controlador | HU-04, HU-05, HU-12, HU-17 |
| informes | `GET /informes`, `GET /informes/:id`, `POST /informes`, `PUT /informes/:id/avances`, `POST /informes/:id/enviar`, `/validar`, `/devolver`, `GET /informes/:id/pdf` (pendiente) | ver controlador | HU-07, HU-08, HU-09 |
| evidencias | `GET /evidencias?hitoId=`, `POST /evidencias` (multipart: `hitoId`, `archivo`), `GET /evidencias/:id`, `GET /evidencias/:id/pdf`, `DELETE /evidencias/:id` | Capturista, Auxiliar (lectura también Admin) | HU-07 |
| observaciones | `GET /observaciones`, `GET /observaciones/licenciatura/:id`, `PATCH /observaciones/items/:id/atender` | ver controlador | HU-05, HU-08 |
| notificaciones | `GET /notificaciones`, `PATCH /notificaciones/:id/leida`, `PATCH /notificaciones/:id/no-leida`, `PATCH /notificaciones/leer-todas` | todos | HU-10, HU-11 |
| reportes | `GET /reportes/dashboard`, `/incumplimiento?fechaCorte&brechaMinima&licenciaturaId`, `/atencion`, `/historico`, `/transversales` | Admin (dashboard: todos) | HU-13 a HU-17 |
| bitácora | `GET /bitacora?desde&hasta&rol` | Admin | HU-03 |

## Reglas de negocio implementadas

- **Correo institucional:** login y altas solo aceptan `@acatlan.unam.mx` o `@unam.mx` (`DOMINIOS_PERMITIDOS`).
- **Alcance por rol:**
  - Capturista y Auxiliar solo ven su licenciatura (`verificarLicenciatura`).
  - El Auxiliar no configura hitos.
- **Flujo del plan:** `BORRADOR` → `EN_REVISION` → `VALIDADO`, o `DEVUELTO` con observaciones por recomendación.
  - Al validar, el plan ya no se puede editar.
  - Solo se reenvía cuando todas las observaciones están atendidas.
- **Hitos:**
  - El % esperado debe estar entre 1 y 99.
  - Las fechas deben quedar dentro de la recomendación y en orden ascendente, y el % debe ir creciendo.
  - Las fechas de la recomendación deben quedar dentro del ciclo de acreditación.
- **Informes:** al validar, se copia el % real reportado a cada hito.
- **Evidencias:**
  - Se aceptan PDF, Word, Excel, PowerPoint e imágenes, con un máximo de `MAX_UPLOAD_MB`.
  - El servidor las convierte a PDF con LibreOffice headless y en segundo plano; el estado se consulta en `GET /evidencias/:id`.
- **Notificaciones:**
  - Un cron diario a las 7:00 (hora de CDMX) avisa de hitos próximos (`DIAS_AVISO_HITO`) y de hitos vencidos con rezago.
  - Respeta el canal que eligió cada usuario: Correo, In-App o Ambos.
- **Bitácora:** solo admite inserciones. Registra usuario, rol, acción, entidad y detalle de cada cambio.
- **Seguridad (lineamientos DGTIC):**
  - Usa helmet, CORS restringido, rate limit en login y recuperación, y bcrypt con costo 12.
  - Los mensajes de login no revelan si una cuenta existe.
  - Los tokens de recuperación se guardan hasheados y vencen en 30 minutos.

## Pendientes (TODO en el código)

- Envío de correos (contraseña temporal, enlace de recuperación y avisos). Se necesita el SMTP institucional.
- Generación de los Anexos 1 y 2 en Word y PDF, y el PDF del informe para el visor (HU-06, HU-09).
- Migraciones de TypeORM para producción.
- Por definir con el cliente:
  - El tamaño máximo de las evidencias.
  - Si los avisos de hitos cuentan días naturales o hábiles.
  - La carga masiva de ciclos anteriores desde Excel (HU-16).
