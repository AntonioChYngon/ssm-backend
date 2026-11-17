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
npm run seed             # Actuaría + su coordinación, un Administrador y un usuario Captura
npm run start:dev        # http://localhost:3001/api  ·  Swagger en /api/docs
npm test                 # validación de dominio y contraseña
```

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
| `GET /notificaciones` · `PATCH /notificaciones/:id/leida` | cualquier sesión | HU-10 |

El resto de los módulos (informes, evidencias, reportes) se está migrando al esquema del equipo; ver `src/modules/_por-migrar/LEEME.md`.

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
