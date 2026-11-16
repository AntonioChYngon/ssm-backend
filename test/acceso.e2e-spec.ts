// Pruebas de integración: usan la base real (local o la de GitHub Actions) ya cargada con `npm run seed`.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp, tokenDe } from './app';

describe('Acceso (HU-01) y endpoints base de HU-02, HU-04 y HU-15', () => {
  let app: INestApplication;
  let admin: string;
  let captura: string;

  beforeAll(async () => {
    app = await crearApp();
    admin = await tokenDe(app, 'ADMIN');
    captura = await tokenDe(app, 'CAPTURA');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  describe('HU-01 · login', () => {
    it('rechaza una contraseña incorrecta sin revelar si la cuenta existe', async () => {
      const r = await api().post('/api/auth/login').send({ correo: process.env.SEED_ADMIN_CORREO, contrasena: 'Incorrecta123' }).expect(401);
      expect(r.body.message).toBe('Correo o contraseña incorrectos.');
    });

    it('rechaza correos fuera del dominio institucional', async () => {
      await api().post('/api/auth/login').send({ correo: 'alguien@gmail.com', contrasena: 'Cualquiera123' }).expect(400);
    });

    it('GET /auth/me devuelve el rol de la asignación activa', async () => {
      const r = await api().get('/api/auth/me').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(r.body.rol).toBe('CAPTURA');
      expect(r.body.licenciatura).toBe('Actuaría');
    });
  });

  describe('HU-02 · usuarios', () => {
    it('el Administrador puede listar usuarios', async () => {
      const r = await api().get('/api/usuarios').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(r.body.length).toBeGreaterThanOrEqual(2);
    });

    it('Captura no puede entrar a la administración de usuarios', async () => {
      await api().get('/api/usuarios').set('Authorization', `Bearer ${captura}`).expect(403);
    });

    it.todo('POST /usuarios da de alta un Auxiliar y le envía sus credenciales');
  });

  describe('HU-04 · plan', () => {
    it('los catálogos traen las 10 categorías en orden', async () => {
      const r = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(r.body.categorias).toHaveLength(10);
      expect(r.body.categorias[0].nombre).toBe('Personal Académico');
    });

    it.todo('POST /ciclos/:id/plan/recomendaciones guarda una recomendación completa');
  });

  describe('HU-15 · resumen de atención', () => {
    it('solo el Administrador puede consultarlo', async () => {
      await api().get('/api/reportes/atencion').set('Authorization', `Bearer ${captura}`).expect(403);
    });

    // Con db/datos_desarrollo.sql → DER: 1 atendida, 1 en proceso, 2 no atendidas · ECO: 2 atendidas, 1 en proceso.
    it.todo('cuenta las recomendaciones de Derecho y Economía según los datos de desarrollo');
  });
});
