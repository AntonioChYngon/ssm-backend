// Dashboards con datos reales. Derecho (plan aprobado; último informe capturado 2027-1: 100 · 60 · 20 · 0, metas al 50 %
// para el 30/06/2026) da avance real 45 % y dos rezagos. El esperado sube con el tiempo (50 % hoy), así que solo se acota. Solo consulta.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

describe('Dashboards con datos reales', () => {
  let app: INestApplication;
  let admin: string;
  let derecho: string;
  let derechoId: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await crearApp();
    admin = await tokenDe(app, 'ADMIN');
    derecho = await tokenDeCoordinacion(app, 'DER');
    const [fila] = await app.get(DataSource).query("SELECT licenciatura_id AS id FROM licenciatura WHERE clave = 'DER'");
    derechoId = String(fila.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('el Administrador ve los indicadores y el avance real contra esperado', async () => {
    await api().get('/api/dashboard/admin').set('Authorization', `Bearer ${derecho}`).expect(403);
    const { body } = await api().get('/api/dashboard/admin').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(body.licenciaturas).toBeGreaterThanOrEqual(19);
    expect(body.planesValidados).toBeGreaterThanOrEqual(2);
    const fila = body.avance.find((a: { licenciatura: string }) => a.licenciatura === 'Derecho');
    expect(fila.real).toBe(45);
    expect(fila.esperado).toBeGreaterThanOrEqual(50);
    expect(body.vencimientos.some((v: { licenciatura: string; tipo: string }) => v.licenciatura === 'Derecho' && v.tipo === 'REZAGO')).toBe(true);
  });

  it('filtra por licenciatura (HU-13)', async () => {
    const { body } = await api().get(`/api/dashboard/admin?licenciaturaIds=${derechoId}`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(body).toMatchObject({ licenciaturas: 1, conPlan: 1, planesValidados: 1 });
    expect(body.avance).toEqual([expect.objectContaining({ licenciatura: 'Derecho', real: 45 })]);
  });

  it('la coordinación ve su ciclo vigente, sus metas y sus alertas', async () => {
    await api().get('/api/dashboard/licenciatura').set('Authorization', `Bearer ${admin}`).expect(403);
    const { body } = await api().get('/api/dashboard/licenciatura').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(body.ciclo).toMatchObject({ nombre: '2024-2029', licenciatura: 'Derecho', organismo: 'CONAED' });
    expect(body).toMatchObject({ planEstado: 'APROBADO', recomendaciones: 4, atendidas: 1, avance: { real: 45 } });
    expect(body.vencidas).toBeGreaterThanOrEqual(2);
    expect(body.metas[0]).toMatchObject({ estado: 'VENCIDA', esperado: 50 });
  });
});
