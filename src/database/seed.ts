// Usuarios de prueba y datos de desarrollo, respetando las reglas del esquema del equipo.
// 1. Crea (si no existen): licenciatura Actuaría + su coordinación, un Administrador y un Captura.
// 2. Si SEED_DATOS_DESARROLLO=true y aún no hay planes, carga db/datos_desarrollo.sql.
// Uso:  npm run seed   (lee SEED_* del archivo .env). Se puede correr varias veces sin duplicar.
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Rol } from '../common/enums';
import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from '../modules/auth/dominio';
import { AsignacionUsuario, Coordinacion, ENTIDADES_ACCESO, Licenciatura, Usuario } from './entities';

type UsuarioSemilla = { correo: string; contrasena: string; nombre: string; apellido: string; rol: Rol };

const leerUsuario = (prefijo: string, rol: Rol, nombre: string, apellido: string): UsuarioSemilla => {
  const correo = process.env[`${prefijo}_CORREO`]?.trim().toLowerCase();
  const contrasena = process.env[`${prefijo}_PASSWORD`];
  if (!correo || !contrasena) throw new Error(`Define ${prefijo}_CORREO y ${prefijo}_PASSWORD en el .env`);
  if (!esCorreoInstitucional(correo, leerDominios(process.env.DOMINIOS_PERMITIDOS))) throw new Error(`${correo} no es un correo institucional válido.`);
  if (!esContrasenaSegura(contrasena)) throw new Error(`${prefijo}_PASSWORD debe tener 8+ caracteres, una mayúscula y un número.`);
  return { correo, contrasena, nombre, apellido, rol };
};

const main = async () => {
  const admin = leerUsuario('SEED_ADMIN', Rol.ADMINISTRADOR, 'Administración', 'SSM');
  const captura = leerUsuario('SEED_CAPTURA', Rol.CAPTURA, 'Captura', 'Actuaría');

  const ds = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'ssm',
    entities: ENTIDADES_ACCESO,
    synchronize: false,
    // Necesario para ejecutar el archivo de datos de desarrollo en una sola llamada.
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  await ds.initialize();

  await ds.transaction(async (tx) => {
    let licenciatura = await tx.findOneBy(Licenciatura, { clave: 'ACT' });
    if (!licenciatura) licenciatura = await tx.save(tx.create(Licenciatura, { clave: 'ACT', nombre: 'Actuaría', modalidad: 'Escolarizada', activa: true }));

    let coordinacion = await tx.findOneBy(Coordinacion, { licenciaturaId: licenciatura.id });
    if (!coordinacion) coordinacion = await tx.save(tx.create(Coordinacion, { licenciaturaId: licenciatura.id, nombre: 'Coordinación de Actuaría', activa: true }));

    for (const semilla of [admin, captura]) {
      let usuario = await tx.findOneBy(Usuario, { correo: semilla.correo });
      if (!usuario) {
        usuario = await tx.save(
          tx.create(Usuario, { nombre: semilla.nombre, apellido: semilla.apellido, correo: semilla.correo, hashContrasena: await bcrypt.hash(semilla.contrasena, 12), activo: true }),
        );
      }
      const yaAsignado = await tx.findOneBy(AsignacionUsuario, { usuarioId: usuario.id, activa: true });
      if (!yaAsignado) {
        await tx.insert(AsignacionUsuario, {
          usuarioId: usuario.id,
          rolCodigo: semilla.rol,
          coordinacionId: semilla.rol === Rol.ADMINISTRADOR ? null : coordinacion.id,
          activa: true,
        });
      }
      console.log(`✔ ${semilla.rol.padEnd(13)} ${semilla.correo}`);
    }
  });

  if (process.env.SEED_DATOS_DESARROLLO === 'true') {
    const [{ total }] = await ds.query('SELECT COUNT(*) AS total FROM version_plan');
    if (Number(total) > 0) {
      console.log('• Datos de desarrollo: ya existen planes, no se cargan de nuevo.');
    } else {
      const sql = readFileSync(join(__dirname, '..', '..', 'db', 'datos_desarrollo.sql'), 'utf8');
      await ds.transaction((tx) => tx.query(sql));
      console.log('✔ Datos de desarrollo cargados (planes, recomendaciones y avances de prueba).');
    }
  }

  await ds.destroy();
  console.log('Seed listo.');
};

main().catch((error) => {
  console.error('✖ Seed falló:', error instanceof Error ? error.message : error);
  process.exit(1);
});
