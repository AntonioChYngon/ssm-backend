// Arranca la API completa contra la base de pruebas, con la misma configuración que src/main.ts.
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';

export const crearApp = async (): Promise<INestApplication> => {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
};

/** Inicia sesión con una cuenta del seed y regresa el token. */
export const tokenDe = async (app: INestApplication, cuenta: 'ADMIN' | 'CAPTURA') => {
  const respuesta = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ correo: process.env[`SEED_${cuenta}_CORREO`], contrasena: process.env[`SEED_${cuenta}_PASSWORD`] })
    .expect(200);
  return respuesta.body.token as string;
};

/**
 * Token de la cuenta Captura de una licenciatura del seed (SEED_CUENTAS_COORDINACIONES=true), firmado como lo hace
 * el login. Evita cambiar su contraseña temporal y no depende del orden de las pruebas. `rol` permite probar
 * como Auxiliar con la misma persona (HU-03 distingue el rol en la bitácora).
 */
export const tokenDeCoordinacion = async (app: INestApplication, clave: string, rol: 'CAPTURA' | 'AUXILIAR' = 'CAPTURA') => {
  const [fila] = await app.get(DataSource).query(
    `SELECT u.usuario_id AS id, u.correo, a.coordinacion_id AS coordinacion, co.licenciatura_id AS licenciatura
     FROM asignacion_usuario a
     JOIN usuario u ON u.usuario_id = a.usuario_id
     JOIN coordinacion co ON co.coordinacion_id = a.coordinacion_id
     JOIN licenciatura l ON l.licenciatura_id = co.licenciatura_id
     WHERE l.clave = ? AND a.rol_codigo = 'CAPTURA' AND a.activa = TRUE AND u.activo = TRUE
     LIMIT 1`,
    [clave],
  );
  if (!fila) throw new Error(`No hay cuenta Captura de ${clave}: corre el seed con SEED_CUENTAS_COORDINACIONES=true.`);
  return app.get(JwtService).signAsync({
    sub: String(fila.id),
    correo: fila.correo,
    rol,
    coordinacionId: String(fila.coordinacion),
    licenciaturaId: String(fila.licenciatura),
  });
};
