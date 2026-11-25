// Prepara la base: catálogos reales, cuentas de acceso y, solo si se pide, datos ficticios de desarrollo.
// 1. Siempre carga db/catalogos_base.sql (licenciaturas, coordinaciones, categorías, organismos y áreas de Catálogos.xlsx).
// 2. Crea (si no existen) el Administrador y el Captura de prueba definidos en el .env.
// 3. Si SEED_CUENTAS_COORDINACIONES=true, crea una cuenta Captura por coordinación con su correo institucional
//    (src/database/cuentas-coordinaciones.ts) y la contraseña SEED_CUENTAS_PASSWORD, marcada como temporal:
//    al primer inicio de sesión el sistema obliga a cambiarla.
// 4. Si SEED_DATOS_DESARROLLO=true y aún no hay planes, carga db/datos_desarrollo.sql.
// Uso:  npm run seed   (lee el .env). Se puede correr varias veces sin duplicar nada.
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { Rol } from '../common/enums';
import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from '../modules/auth/dominio';
import { CUENTAS_COORDINACIONES } from './cuentas-coordinaciones';
import { AsignacionUsuario, Coordinacion, ENTIDADES_ACCESO, Licenciatura, Usuario } from './entities';

type UsuarioSemilla = { correo: string; contrasena: string; nombre: string; apellido: string; rol: Rol; temporal?: boolean };

const COSTO_BCRYPT = 12;
const leerSql = (archivo: string) => readFileSync(join(__dirname, '..', '..', 'db', archivo), 'utf8');

const validarContrasena = (variable: string, contrasena: string | undefined) => {
  if (!contrasena) throw new Error(`Define ${variable} en el .env`);
  if (!esContrasenaSegura(contrasena)) throw new Error(`${variable} debe tener 8+ caracteres, una mayúscula y un número.`);
  return contrasena;
};

const leerUsuario = (prefijo: string, rol: Rol, nombre: string, apellido: string): UsuarioSemilla => {
  const correo = process.env[`${prefijo}_CORREO`]?.trim().toLowerCase();
  if (!correo) throw new Error(`Define ${prefijo}_CORREO en el .env`);
  if (!esCorreoInstitucional(correo, leerDominios(process.env.DOMINIOS_PERMITIDOS))) throw new Error(`${correo} no es un correo institucional válido.`);
  return { correo, contrasena: validarContrasena(`${prefijo}_PASSWORD`, process.env[`${prefijo}_PASSWORD`]), nombre, apellido, rol };
};

/** Crea la cuenta si no existe y le da el rol indicado si aún no tiene una asignación activa. */
const asegurarCuenta = async (tx: EntityManager, semilla: UsuarioSemilla, coordinacionId: string | null) => {
  let usuario = await tx.findOneBy(Usuario, { correo: semilla.correo });
  if (!usuario) {
    usuario = await tx.save(
      tx.create(Usuario, {
        nombre: semilla.nombre,
        apellido: semilla.apellido.slice(0, 120),
        correo: semilla.correo,
        hashContrasena: await bcrypt.hash(semilla.contrasena, COSTO_BCRYPT),
        debeCambiarContrasena: semilla.temporal ?? false,
        activo: true,
      }),
    );
  }
  const yaAsignado = await tx.findOneBy(AsignacionUsuario, { usuarioId: usuario.id, activa: true });
  if (!yaAsignado) await tx.insert(AsignacionUsuario, { usuarioId: usuario.id, rolCodigo: semilla.rol, coordinacionId, activa: true });
};

/** Una cuenta Captura por coordinación. Un correo compartido por varias licenciaturas solo puede ser de una (regla del esquema). */
const crearCuentasCoordinaciones = async (tx: EntityManager, contrasena: string) => {
  const omitidas: string[] = [];
  let creadas = 0;
  for (const cuenta of CUENTAS_COORDINACIONES) {
    const licenciatura = await tx.findOneBy(Licenciatura, { clave: cuenta.clave });
    const coordinacion = licenciatura ? await tx.findOneBy(Coordinacion, { licenciaturaId: licenciatura.id }) : null;
    if (!coordinacion) {
      omitidas.push(`${cuenta.licenciatura}: no existe su coordinación en el catálogo`);
      continue;
    }
    const conCaptura = await tx.findOneBy(AsignacionUsuario, { coordinacionId: coordinacion.id, rolCodigo: Rol.CAPTURA, activa: true });
    if (conCaptura) {
      const titular = await tx.findOneBy(Usuario, { id: conCaptura.usuarioId });
      if (titular?.correo !== cuenta.correo) omitidas.push(`${cuenta.licenciatura}: ya tiene Captura (${titular?.correo})`);
      continue;
    }
    const existente = await tx.findOneBy(Usuario, { correo: cuenta.correo });
    if (existente) {
      omitidas.push(`${cuenta.licenciatura}: ${cuenta.correo} ya es la cuenta de otra licenciatura; necesita un correo propio`);
      continue;
    }
    await asegurarCuenta(tx, { correo: cuenta.correo, contrasena, nombre: 'Coordinación', apellido: cuenta.licenciatura, rol: Rol.CAPTURA, temporal: true }, coordinacion.id);
    creadas += 1;
  }
  console.log(`✔ Cuentas de coordinación creadas: ${creadas}`);
  omitidas.forEach((motivo) => console.log(`  • Sin cuenta nueva · ${motivo}`));
};

const main = async () => {
  const admin = leerUsuario('SEED_ADMIN', Rol.ADMINISTRADOR, 'Administración', 'SSM');
  const captura = leerUsuario('SEED_CAPTURA', Rol.CAPTURA, 'Coordinación', 'Actuaría');
  const conCuentas = process.env.SEED_CUENTAS_COORDINACIONES === 'true';
  const contrasenaCuentas = conCuentas ? validarContrasena('SEED_CUENTAS_PASSWORD', process.env.SEED_CUENTAS_PASSWORD) : '';

  const ds = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'ssm',
    entities: ENTIDADES_ACCESO,
    synchronize: false,
    timezone: 'Z',
    // Necesario para ejecutar los archivos .sql en una sola llamada.
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  await ds.initialize();

  await ds.transaction((tx) => tx.query(leerSql('catalogos_base.sql')));
  console.log('✔ Catálogos base cargados (Catálogos.xlsx).');

  await ds.transaction(async (tx) => {
    // Actuaría ya viene del catálogo; se crea aquí solo si alguien borró el archivo de catálogos.
    let actuaria = await tx.findOneBy(Licenciatura, { clave: 'ACT' });
    if (!actuaria) actuaria = await tx.save(tx.create(Licenciatura, { clave: 'ACT', nombre: 'Actuaría', modalidad: 'Escolarizada', activa: true }));
    let coordinacion = await tx.findOneBy(Coordinacion, { licenciaturaId: actuaria.id });
    if (!coordinacion) coordinacion = await tx.save(tx.create(Coordinacion, { licenciaturaId: actuaria.id, nombre: 'Coordinación de Actuaría', activa: true }));

    await asegurarCuenta(tx, admin, null);
    console.log(`✔ ${Rol.ADMINISTRADOR.padEnd(13)} ${admin.correo}`);
    await asegurarCuenta(tx, captura, coordinacion.id);
    console.log(`✔ ${Rol.CAPTURA.padEnd(13)} ${captura.correo}`);

    if (conCuentas) await crearCuentasCoordinaciones(tx, contrasenaCuentas);
  });

  if (process.env.SEED_DATOS_DESARROLLO === 'true') {
    const [{ total }] = await ds.query('SELECT COUNT(*) AS total FROM version_plan');
    if (Number(total) > 0) {
      console.log('• Datos de desarrollo: ya existen planes, no se cargan de nuevo.');
    } else {
      await ds.transaction((tx) => tx.query(leerSql('datos_desarrollo.sql')));
      console.log('✔ Datos de desarrollo cargados (planes, recomendaciones y avances de prueba).');
    }
  }

  await ds.destroy();
  console.log('Seed listo.');
};

main().catch((error: unknown) => {
  // Un error de conexión llega sin mensaje (AggregateError): se muestran el código y los errores internos.
  const detalle = (e: unknown): string => {
    if (!(e instanceof Error)) return String(e);
    const codigo = (e as { code?: string }).code;
    const internos = e instanceof AggregateError ? e.errors.map(detalle).join(' | ') : '';
    return [codigo, e.message, internos].filter(Boolean).join(' · ') || e.name;
  };
  const texto = detalle(error);
  console.error('✖ Seed falló:', texto);
  if (/ECONNREFUSED|ETIMEDOUT/.test(texto)) console.error('  ¿Está corriendo la base? Revisa `podman ps` y levántala con `podman compose up -d db correo`.');
  process.exit(1);
});
