// Carga inicial: licenciaturas con su organismo acreditador y un usuario Administrador.
// Uso: SEED_ADMIN_CORREO=... SEED_ADMIN_PASSWORD=... npm run seed
import 'reflect-metadata';
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Rol } from '../common/enums';
import { esContrasenaSegura } from '../modules/auth/dominio';
import { Licenciatura, Usuario } from '../modules/usuarios/entities';

const LICENCIATURAS: [string, string][] = [
  ['Actuaría', 'CONAC'],
  ['Arquitectura', 'ANPADEH'],
  ['Derecho', 'CONAED'],
  ['Economía', 'CONACE'],
  ['Ingeniería Civil', 'CACEI'],
  ['Matemáticas Aplicadas y Computación', 'CONAIC'],
  ['Pedagogía', 'CEPPE'],
  ['Relaciones Internacionales', 'ACCECISO'],
];

const main = async () => {
  const correo = process.env.SEED_ADMIN_CORREO?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!correo || !password || !esContrasenaSegura(password)) {
    throw new Error('Define SEED_ADMIN_CORREO y SEED_ADMIN_PASSWORD (8+ caracteres, una mayúscula y un número).');
  }

  const ds = new DataSource({
    type: 'mariadb',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'ssm',
    entities: [Licenciatura, Usuario],
    synchronize: false,
  });
  await ds.initialize();

  const licRepo = ds.getRepository(Licenciatura);
  for (const [nombre, organismo] of LICENCIATURAS) {
    if (!(await licRepo.existsBy({ nombre }))) await licRepo.insert({ nombre, organismo });
  }

  const usuarios = ds.getRepository(Usuario);
  if (!(await usuarios.existsBy({ correo }))) {
    await usuarios.insert({ nombre: 'Administración SSM', correo, rol: Rol.ADMINISTRADOR, passwordHash: await bcrypt.hash(password, 12), debeCambiarPassword: true });
  }

  await ds.destroy();
  console.log(`Seed listo: ${LICENCIATURAS.length} licenciaturas y administrador ${correo}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
