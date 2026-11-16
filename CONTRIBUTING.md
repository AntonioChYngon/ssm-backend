# Cómo trabajamos en el SSM

Guía para el equipo de desarrollo (Algorix). Repos: [`ssm-backend`](https://github.com/AntonioChYngon/ssm-backend) y [`ssm-frontend`](https://github.com/AntonioChYngon/ssm-frontend).

## 1. Reparto actual

| Historia | Responsable | Backend | Frontend |
|---|---|---|---|
| **HU-02** Cuentas, auxiliares y contraseñas | Christian  | `src/modules/usuarios/` | `/admin/usuarios`, `/recuperar` |
| **HU-04** Captura del Plan de Mejora | Jesus | `src/modules/planes/` | `/licenciatura/plan` |
| **HU-15** Resumen por estatus de cumplimiento | Antonio | `src/modules/reportes/` | `/admin/reportes/atencion` |

Cada módulo ya trae su controlador, el contrato (DTO), un endpoint funcionando como ejemplo, reglas con pruebas y la lista de `TODO(HU-xx)`. Busca tus pendientes con:

```bash
git grep "TODO(HU-02)"     # o HU-04, HU-15
```

### Tareas por historia

**HU-02 · Christian**
- [ ] `POST /usuarios`: alta de Captura o Auxiliar con contraseña temporal enviada por correo.
- [ ] `PATCH /usuarios/:id/asignacion`: cambio de titular; el historial queda en la coordinación.
- [ ] `POST /usuarios/:id/restablecer` y `PATCH /usuarios/:id/estado`.
- [ ] Mensaje claro si ya hay un Captura activo en la coordinación.
- [ ] Frontend: conectar `/admin/usuarios` a `crearUsuario`, `cambiarAsignacion`, etc. (`src/lib/api.ts`).
- [ ] Frontend: `/recuperar?token=…` debe mostrar el formulario de nueva contraseña y llamar a `restablecerContrasena`.
- [ ] Pruebas: completar los `it.todo` de `reglas.spec.ts` y `test/acceso.e2e-spec.ts`.

**HU-04 · Jesus**
- [ ] `GET /ciclos/:cicloId/plan`: plan vigente con indicadores, recomendaciones, acciones, metas y áreas.
- [ ] `POST /ciclos/:cicloId/plan/recomendaciones`: guardar todo en una transacción y auditarlo.
- [ ] Solo se edita un plan en `BORRADOR` o `DEVUELTO`; si no existe, crear la versión 1.
- [ ] Frontend: formulario de `/licenciatura/plan` con los catálogos de `obtenerCatalogos()`.
- [ ] Frontend: tabla "Plan de Mejora Continua" (Anexo 1) al terminar la captura.
- [ ] Pruebas: completar los `it.todo`.

**HU-15 · Antonio**
- [ ] `GET /reportes/atencion?licenciaturaId=`: conteo por licenciatura con `contarPorEstatus()`.
- [ ] Confirmar con el equipo qué avance cuenta: el del último informe aprobado (recomendado) o el último capturado.
- [ ] Frontend: conectar `/admin/reportes/atencion` a `obtenerResumenAtencion()` y el filtro por licenciatura.
- [ ] Pruebas: con los datos de desarrollo, Derecho debe dar 1 / 1 / 2 y Economía 2 / 1 / 0.

## 2. Preparar tu computadora (una sola vez)

Necesitas **Node.js LTS**, **Git** y **Podman Desktop**. No instales MariaDB a mano: la base corre en Podman y se crea sola con el esquema del equipo.

```bash
git clone https://github.com/AntonioChYngon/ssm-backend.git
cd ssm-backend
cp .env.example .env                  # en Windows: copy .env.example .env
```

En `.env` pon las mismas contraseñas en `DB_PASSWORD` y `DB_ROOT_PASSWORD` que quieras usar localmente y un `JWT_SECRET` cualquiera. Luego:

```bash
podman compose up -d db correo        # MariaDB con el esquema + buzón de correo de prueba
npm install
npm run seed                          # usuarios de prueba y datos de desarrollo
npm run start:dev                     # API en http://localhost:3001/api · Swagger en /api/docs
```

- **Correos:** todo lo que envía el backend aparece en http://localhost:8025 (Mailpit). No sale nada a internet.
- **Empezar de cero:** `podman compose down -v`, luego `podman compose up -d db correo` y `npm run seed`.
- **Ver la base:** DBeaver a `localhost:3306`, usuario `ssm_app` con tu `DB_PASSWORD`.

### ¿Solo frontend?

No necesitas el backend. En `ssm-frontend`, crea `.env.local` con `NEXT_PUBLIC_USE_MOCKS=true` y corre `npm run dev`. Las funciones de `src/lib/api.ts` responden con datos de ejemplo.

## 3. Cómo saber si tu código funciona

| Comando | Qué prueba | ¿Necesita base? |
|---|---|---|
| `npm test` | Reglas de negocio (`*.spec.ts`) | No |
| `npm run typecheck` | Tipos de TypeScript | No |
| `npm run test:e2e` | Endpoints reales contra MariaDB (`test/*.e2e-spec.ts`) | Sí (local o en GitHub) |

**No es obligatorio tener MariaDB local para validar tu trabajo:** al abrir un Pull Request, GitHub Actions levanta su propia MariaDB, carga el esquema y los datos de desarrollo, y corre las tres pruebas. Si el PR sale en verde, funciona.

## 4. Flujo de Git

1. Actualiza `main` y crea tu rama: `git checkout main && git pull && git checkout -b hu-04-plan`.
2. Haz commits pequeños: `feat(hu-04): guardar acciones y metas`.
3. Sube la rama y abre un Pull Request hacia `main`.
4. Antes de unir: CI en verde + aprobación de otro integrante.
5. Une con **Squash and merge** y borra la rama.

Reglas para no pisarnos:
- Trabaja dentro de tu módulo. Si necesitas tocar archivos compartidos (`src/database/*.entities.ts`, `src/common/*`, `src/lib/types.ts`, `db/*.sql`), hazlo en un PR pequeño aparte y avisa al equipo.
- Si cambias un contrato (DTO), cambia también `ssm-frontend/src/lib/types.ts` en un PR del frontend con el mismo nombre de rama.
- Cambios al esquema de la base: primero en `db/ssm_mariadb.sql`, con acuerdo del equipo.
- Nunca subas `.env` ni contraseñas reales. Usa siempre datos ficticios.

### Dependencias (npm)

- **Nunca uses `npm audit fix --force`.** Sube versiones mayores sin avisar: lleva TypeORM a 1.x y baja `ts-jest` a una versión incompatible con TypeScript 5, y el proyecto deja de compilar.
- Tampoco uses `--force` ni `--legacy-peer-deps` para "destrabar" un `npm install`: esconden el conflicto en vez de resolverlo.
- Si `npm audit` reporta algo **high** o **critical** en una dependencia que corre en el servidor (sección `dependencies`), actualiza solo ese paquete: `npm install paquete@versión-corregida`, corre `npm run typecheck` y `npm test`, y súbelo en un PR propio.
- Los avisos en herramientas de desarrollo (`jest`, `ts-jest`, `@nestjs/cli`) no viajan al servidor: se revisan en equipo y se actualizan cuando haya versión compatible.
- Para agregar o cambiar una dependencia, sube siempre `package.json` y `package-lock.json` juntos. Sin el lock, el CI (`npm ci`) falla.
- ¿Algo se rompió tras instalar? Restaura con `git checkout -- package.json package-lock.json`, borra `node_modules` y vuelve a correr `npm install`.

## 5. Seguridad (lineamientos DGTIC)

- Todo endpoint nuevo pide sesión por defecto. Usa `@Roles(...)` para limitar por rol y `verificarCoordinacion()` para que Captura y Auxiliar solo vean su licenciatura.
- Valida toda entrada con DTO y `class-validator`; nunca concatenes texto del usuario en SQL.
- Registra los cambios importantes con `AuditoriaService.registrar()` (HU-03).
