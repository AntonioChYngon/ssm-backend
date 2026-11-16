// Arranca la API completa contra la base de pruebas, con la misma configuración que src/main.ts.
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
