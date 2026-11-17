// Pruebas de integración: usan la base real (local o la de GitHub Actions) ya cargada con `npm run seed`.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe } from './app';

describe('Acceso (HU-01) y endpoints base de HU-02, HU-04 y HU-15', () => {
  let app: INestApplication;
  let admin: string;
  let captura: string;
  let dataSource: DataSource;
  let coordinacionActuaria: string;
  let coordinacionDerecho: string;
  let usuarioPruebaId: string | null = null;

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    admin = await tokenDe(app, 'ADMIN');
    captura = await tokenDe(app, 'CAPTURA');
    const actuaria = await dataSource.query('SELECT coordinacion_id AS id FROM coordinacion WHERE nombre = ? LIMIT 1', ['Coordinación de Actuaría']);
    const derecho = await dataSource.query('SELECT coordinacion_id AS id FROM coordinacion WHERE nombre = ? LIMIT 1', ['Coordinación de Derecho']);
    coordinacionActuaria = String(actuaria[0]?.id ?? '');
    coordinacionDerecho = String(derecho[0]?.id ?? '');
  });

  afterAll(async () => {
    if (usuarioPruebaId) {
      await dataSource.query('UPDATE asignacion_usuario SET activa = FALSE, desactivada_en = CURRENT_TIMESTAMP WHERE usuario_id = ? AND activa = TRUE', [usuarioPruebaId]);
      await dataSource.query('UPDATE usuario SET activo = FALSE WHERE usuario_id = ?', [usuarioPruebaId]);
    }
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

    it('el Administrador puede consultar coordinaciones activas para las asignaciones', async () => {
      const r = await api().get('/api/usuarios/coordinaciones').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(r.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: coordinacionActuaria, licenciatura: 'Actuaría' }),
        expect.objectContaining({ id: coordinacionDerecho, licenciatura: 'Derecho' }),
      ]));
      await api().get('/api/usuarios/coordinaciones').set('Authorization', `Bearer ${captura}`).expect(403);
    });

    it('Captura no puede entrar a la administración de usuarios', async () => {
      await api().get('/api/usuarios').set('Authorization', `Bearer ${captura}`).expect(403);
    });

    it('da de alta un Auxiliar, impide duplicar Captura, conserva el historial y permite administrar la cuenta', async () => {
      expect(coordinacionActuaria).toMatch(/^\d+$/);
      expect(coordinacionDerecho).toMatch(/^\d+$/);
      const correo = `hu02.${Date.now()}@acatlan.unam.mx`;
      const creada = await api().post('/api/usuarios').set('Authorization', `Bearer ${admin}`).send({
        nombre: 'Prueba',
        apellido: 'HU02',
        correo,
        rol: 'AUXILIAR',
        coordinacionId: coordinacionActuaria,
      }).expect(201);
      usuarioPruebaId = creada.body.id as string;
      expect(creada.body.rol).toBe('AUXILIAR');
      expect(creada.body.coordinacion).toBe('Coordinación de Actuaría');
      expect(creada.body).not.toHaveProperty('hashContrasena');
      expect(creada.body).not.toHaveProperty('contrasenaTemporal');

      const duplicada = await api().post('/api/usuarios').set('Authorization', `Bearer ${admin}`).send({
        nombre: 'Otra',
        apellido: 'Captura',
        correo: `hu02.captura.${Date.now()}@acatlan.unam.mx`,
        rol: 'CAPTURA',
        coordinacionId: coordinacionActuaria,
      }).expect(409);
      expect(duplicada.body.message).toContain('Captura activa');

      const cambio = await api().patch(`/api/usuarios/${usuarioPruebaId}/asignacion`).set('Authorization', `Bearer ${admin}`).send({
        rol: 'AUXILIAR',
        coordinacionId: coordinacionDerecho,
      }).expect(200);
      expect(cambio.body.coordinacion).toBe('Coordinación de Derecho');

      const historial: Array<{ coordinacion_id: string; activa: number | boolean; desactivada_en: Date | null }> = await dataSource.query(
        'SELECT coordinacion_id, activa, desactivada_en FROM asignacion_usuario WHERE usuario_id = ? ORDER BY asignacion_id',
        [usuarioPruebaId],
      );
      expect(historial).toHaveLength(2);
      expect(String(historial[0].coordinacion_id)).toBe(coordinacionActuaria);
      expect(Number(historial[0].activa)).toBe(0);
      expect(historial[0].desactivada_en).not.toBeNull();
      expect(String(historial[1].coordinacion_id)).toBe(coordinacionDerecho);
      expect(Number(historial[1].activa)).toBe(1);

      const restablecimiento = await api().post(`/api/usuarios/${usuarioPruebaId}/restablecer`).set('Authorization', `Bearer ${admin}`).expect(201);
      expect(restablecimiento.body.mensaje).toContain(correo);

      const desactivada = await api().patch(`/api/usuarios/${usuarioPruebaId}/estado`).set('Authorization', `Bearer ${admin}`).send({ activo: false, motivo: 'Prueba HU-02' }).expect(200);
      expect(desactivada.body.activo).toBe(false);
      const reactivada = await api().patch(`/api/usuarios/${usuarioPruebaId}/estado`).set('Authorization', `Bearer ${admin}`).send({ activo: true }).expect(200);
      expect(reactivada.body.activo).toBe(true);
    });
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
