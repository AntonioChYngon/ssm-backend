// HU-17 · Recomendaciones transversales. Usa una recomendación de Derecho y otra de Economía de los datos de desarrollo,
// las agrupa en un grupo nuevo y al terminar borra el grupo (las recomendaciones vuelven a no ser transversales).
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe } from './app';

type Rec = { id: string; licenciatura: { nombre: string }; transversal: boolean; grupo: { id: string; nombre: string } | null; avance: number | null; ciclo: { vigente: boolean } };
type Grupo = { id: string; nombre: string; licenciaturas: string[]; recomendaciones: Rec[]; avanceConsolidado: number | null };

describe('HU-17 · recomendaciones transversales', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: string;
  let captura: string;
  let derecho: string;
  let economia: string;
  let grupoId: string | null = null;
  const nombreGrupo = `Seguimiento institucional ${Date.now()}`;
  const api = () => request(app.getHttpServer());
  const comoAdmin = () => ({
    get: (ruta: string) => api().get(`/api/transversales${ruta}`).set('Authorization', `Bearer ${admin}`),
    post: (ruta: string, cuerpo: object) => api().post(`/api/transversales${ruta}`).set('Authorization', `Bearer ${admin}`).send(cuerpo),
  });

  const recomendacionDe = async (clave: string, descripcion: string) => {
    const [fila] = await dataSource.query(
      `SELECT r.recomendacion_id AS id FROM recomendacion r
       JOIN indicador i ON i.indicador_id = r.indicador_id
       JOIN version_plan vp ON vp.version_plan_id = i.version_plan_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = vp.ciclo_id
       JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       WHERE l.clave = ? AND r.descripcion = ? LIMIT 1`,
      [clave, descripcion],
    );
    return String(fila.id);
  };

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    admin = await tokenDe(app, 'ADMIN');
    captura = await tokenDe(app, 'CAPTURA');
    derecho = await recomendacionDe('DER', 'Adquirir bibliografía especializada en derecho digital');
    economia = await recomendacionDe('ECO', 'Crear un sistema de seguimiento de egresados');
  });

  afterAll(async () => {
    if (grupoId) await api().delete(`/api/transversales/grupos/${grupoId}`).set('Authorization', `Bearer ${admin}`);
    await app.close();
  });

  it('solo el Administrador consulta y etiqueta', async () => {
    await api().get('/api/transversales/recomendaciones').set('Authorization', `Bearer ${captura}`).expect(403);
    await api().post('/api/transversales/grupos').set('Authorization', `Bearer ${captura}`).send({ nombre: 'No permitido' }).expect(403);
  });

  it('crea el grupo de la recomendación similar; el nombre no se repite', async () => {
    const { body } = await comoAdmin().post('/grupos', { nombre: nombreGrupo, descripcion: 'Acciones conjuntas de seguimiento' }).expect(201);
    grupoId = String(body.id);
    await comoAdmin().post('/grupos', { nombre: nombreGrupo }).expect(409);
    await comoAdmin().post('/grupos', { nombre: 'x' }).expect(400);
  });

  it('marca varias recomendaciones como transversales con el selector', async () => {
    await comoAdmin().post('/marcar', { grupoId: '999999999', recomendacionIds: [derecho] }).expect(404);
    await comoAdmin().post('/marcar', { grupoId, recomendacionIds: [] }).expect(400);
    const { body } = await comoAdmin().post('/marcar', { grupoId, recomendacionIds: [derecho, economia] }).expect(200);
    expect(body).toMatchObject({ grupoId, marcadas: 2 });

    const [auditoria] = await dataSource.query(
      "SELECT valor_nuevo FROM registro_auditoria WHERE entidad = 'recomendacion' AND entidad_id = ? AND campo = 'transversal' ORDER BY auditoria_id DESC LIMIT 1",
      [derecho],
    );
    expect(auditoria.valor_nuevo).toBe(nombreGrupo);
  });

  it('filtra "Mostrar sólo recomendaciones transversales"', async () => {
    const todas = (await comoAdmin().get('/recomendaciones').expect(200)).body as Rec[];
    expect(todas.some((r) => !r.transversal)).toBe(true);
    const solo = (await comoAdmin().get('/recomendaciones?soloTransversales=true').expect(200)).body as Rec[];
    expect(solo.every((r) => r.transversal)).toBe(true);
    expect(solo.find((r) => r.id === derecho)?.grupo).toMatchObject({ id: grupoId, nombre: nombreGrupo });
    const delGrupo = (await comoAdmin().get(`/recomendaciones?grupoId=${grupoId}`).expect(200)).body as Rec[];
    expect(delGrupo.map((r) => r.id).sort()).toEqual([derecho, economia].sort());
  });

  it('muestra en una vista las licenciaturas que comparten la recomendación y su avance consolidado', async () => {
    const [grupo] = (await comoAdmin().get(`/grupos?grupoId=${grupoId}`).expect(200)).body as Grupo[];
    expect(grupo.licenciaturas).toEqual(['Derecho', 'Economía']);
    const promedio = Math.round(grupo.recomendaciones.reduce((s, r) => s + (r.avance ?? 0), 0) / grupo.recomendaciones.length);
    expect(grupo.avanceConsolidado).toBe(promedio);
    // Los ciclos de los datos de desarrollo están vigentes: en los históricos el grupo queda vacío.
    const [historico] = (await comoAdmin().get(`/grupos?grupoId=${grupoId}&ciclos=historicos`).expect(200)).body as Grupo[];
    expect(historico).toMatchObject({ licenciaturas: [], avanceConsolidado: null });
    await comoAdmin().get('/grupos?ciclos=otro').expect(400);
  });

  it('genera el reporte consolidado en PDF y en Word', async () => {
    const binario = (formato: 'pdf' | 'docx') =>
      comoAdmin().get(`/reporte/${formato}?ciclos=todos`).buffer(true).parse((res, callback) => {
        const partes: Buffer[] = [];
        res.on('data', (parte: Buffer) => partes.push(parte));
        res.on('end', () => callback(null, Buffer.concat(partes)));
      });
    const pdf = await binario('pdf').expect('Content-Type', /application\/pdf/).expect('Content-Disposition', /recomendaciones-transversales-todos\.pdf/).expect(200);
    expect((pdf.body as Buffer).toString('latin1').startsWith('%PDF-1.4')).toBe(true);
    const word = await binario('docx').expect('Content-Type', /wordprocessingml\.document/).expect(200);
    expect((word.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('quita la marca y al borrar el grupo ninguna recomendación queda transversal', async () => {
    await comoAdmin().post('/desmarcar', { recomendacionIds: [economia] }).expect(200);
    const [grupo] = (await comoAdmin().get(`/grupos?grupoId=${grupoId}`).expect(200)).body as Grupo[];
    expect(grupo.licenciaturas).toEqual(['Derecho']);

    const { body } = await api().delete(`/api/transversales/grupos/${grupoId}`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(body.recomendacionesQuitadas).toBe(1);
    grupoId = null;
    const filas = await dataSource.query('SELECT transversal FROM recomendacion WHERE recomendacion_id IN (?)', [[derecho, economia]]);
    expect(filas.every((f: { transversal: number }) => Number(f.transversal) === 0)).toBe(true);
  });
});
