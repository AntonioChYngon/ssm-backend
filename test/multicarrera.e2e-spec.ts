// HU-13 · Visibilidad por licenciatura: el Administrador elige una, varias o todas; Captura y Auxiliar solo ven la suya.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type ConLicenciatura = { licenciatura: string | { nombre: string } };
const nombre = (x: ConLicenciatura) => (typeof x.licenciatura === 'string' ? x.licenciatura : x.licenciatura.nombre);

describe('HU-13 · filtro multicarrera', () => {
  let app: INestApplication;
  let admin: string;
  let economia: string;
  const id: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const como = (token: string, ruta: string) => api().get(`/api${ruta}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await crearApp();
    admin = await tokenDe(app, 'ADMIN');
    economia = await tokenDeCoordinacion(app, 'ECO');
    const filas: Array<{ clave: string; id: string }> = await app.get(DataSource).query("SELECT clave, licenciatura_id AS id FROM licenciatura WHERE clave IN ('DER', 'ECO')");
    filas.forEach((f) => (id[f.clave] = String(f.id)));
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('el Administrador filtra planes, informes y ciclos por varias licenciaturas', async () => {
    const varias = `${id.DER},${id.ECO}`;
    const planes = await como(admin, `/planes?licenciaturaIds=${varias}`).expect(200);
    expect(new Set(planes.body.map(nombre))).toEqual(new Set(['Derecho', 'Economía']));
    const informes = await como(admin, `/informes?licenciaturaIds=${id.DER}`).expect(200);
    expect(informes.body.length).toBeGreaterThan(0);
    expect(informes.body.every((i: ConLicenciatura) => nombre(i) === 'Derecho')).toBe(true);
    const ciclos = await como(admin, `/ciclos?licenciaturaIds=${id.ECO}`).expect(200);
    expect(ciclos.body.length).toBeGreaterThan(0);
    expect(ciclos.body.every((c: ConLicenciatura) => nombre(c) === 'Economía')).toBe(true);
    await como(admin, `/auditoria?licenciaturaIds=${varias}`).expect(200);
  });

  it('sin el parámetro devuelve todas', async () => {
    const todas = await como(admin, '/planes').expect(200);
    expect(todas.body.length).toBeGreaterThan(2);
  });

  it('rechaza listas mal formadas', async () => {
    for (const ruta of ['/planes', '/informes', '/ciclos', '/auditoria']) await como(admin, `${ruta}?licenciaturaIds=1;2`).expect(400);
  });

  it('la coordinación no puede ampliar su visibilidad con el filtro', async () => {
    const planes = await como(economia, `/planes?licenciaturaIds=${id.DER}`).expect(200);
    expect(planes.body).toEqual([]);
    const informes = await como(economia, `/informes?licenciaturaIds=${id.DER},${id.ECO}`).expect(200);
    expect(informes.body.every((i: ConLicenciatura) => nombre(i) === 'Economía')).toBe(true);
    await como(economia, '/ciclos').expect(403);
    await como(economia, '/auditoria').expect(403);
  });
});
