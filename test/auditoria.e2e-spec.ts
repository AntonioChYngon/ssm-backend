// HU-03 · Auditoría de cambios y trazabilidad. Usa Arquitectura (ciclo vigente y sin plan en los datos de desarrollo),
// que ninguna otra prueba toca. Las pruebas del visor y la bitácora se agregan abajo.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type Registro = { campo: string; valor_anterior: string | null; valor_nuevo: string | null; rol_codigo: string };

describe('HU-03 · auditoría de cambios', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: string;
  let arquitectura: string;
  let auxiliar: string;
  let recomendacionId: string;
  const api = () => request(app.getHttpServer());
  const registrosDe = (id: string): Promise<Registro[]> =>
    dataSource.query(
      "SELECT campo, valor_anterior, valor_nuevo, rol_codigo FROM registro_auditoria WHERE entidad = 'recomendacion' AND entidad_id = ? ORDER BY auditoria_id",
      [id],
    );

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    admin = await tokenDe(app, 'ADMIN');
    arquitectura = await tokenDeCoordinacion(app, 'ARQ');
    auxiliar = await tokenDeCoordinacion(app, 'ARQ', 'AUXILIAR');
  });

  afterAll(async () => {
    if (recomendacionId) await api().delete(`/api/recomendaciones/${recomendacionId}`).set('Authorization', `Bearer ${arquitectura}`);
    if (app) await app.close();
  });

  it('registra cada campo que cambia, con su valor anterior, el nuevo y el rol de quien editó', async () => {
    const { body: mio } = await api().get('/api/planes/mio').set('Authorization', `Bearer ${arquitectura}`).expect(200);
    const { body: catalogos } = await api().get('/api/catalogos').set('Authorization', `Bearer ${arquitectura}`).expect(200);
    const base = { categoriaId: catalogos.categorias[0].id, indicador: 'Indicador HU-03', descripcion: 'Recomendación HU-03 original', acciones: ['Acción 1'] };
    const creada = await api().post(`/api/ciclos/${mio.ciclo.id}/plan/recomendaciones`).set('Authorization', `Bearer ${arquitectura}`).send(base).expect(201);
    recomendacionId = creada.body.recomendacionesDetalle.find((r: { descripcion: string }) => r.descripcion === base.descripcion).id;
    expect((await registrosDe(recomendacionId)).map((r) => r.campo)).toEqual(['creada (borrador)']);

    // La Auxiliar corrige la recomendación y la fecha: dos campos, dos registros.
    await api().put(`/api/recomendaciones/${recomendacionId}`).set('Authorization', `Bearer ${auxiliar}`)
      .send({ ...base, descripcion: 'Recomendación HU-03 corregida', fechaCumplimiento: '2028-06-30' }).expect(200);
    const cambios = (await registrosDe(recomendacionId)).slice(1);
    expect(cambios).toEqual([
      { campo: 'recomendación', valor_anterior: 'Recomendación HU-03 original', valor_nuevo: 'Recomendación HU-03 corregida', rol_codigo: 'AUXILIAR' },
      { campo: 'fecha de cumplimiento', valor_anterior: null, valor_nuevo: '2028-06-30', rol_codigo: 'AUXILIAR' },
    ]);

    // Guardar sin cambios no deja registros.
    await api().put(`/api/recomendaciones/${recomendacionId}`).set('Authorization', `Bearer ${arquitectura}`)
      .send({ ...base, descripcion: 'Recomendación HU-03 corregida', fechaCumplimiento: '2028-06-30' }).expect(200);
    expect(await registrosDe(recomendacionId)).toHaveLength(3);
  });

  it('registra el cambio de metas con su fecha y % esperado', async () => {
    const { body } = await api().put(`/api/recomendaciones/${recomendacionId}/metas`).set('Authorization', `Bearer ${arquitectura}`)
      .send({ metas: [{ descripcion: 'Abrir 3 optativas', fechaCompromiso: '2027-06-30', porcentajeEsperado: 50 }] }).expect(200);
    expect(body.estado).toBe('BORRADOR');
    const ultimo = (await registrosDe(recomendacionId)).at(-1);
    expect(ultimo).toMatchObject({ campo: 'metas', valor_anterior: null, valor_nuevo: 'Abrir 3 optativas (2027-06-30, 50%)', rol_codigo: 'CAPTURA' });
  });

  it('la bitácora no se puede editar ni borrar, ni siquiera directo en la base', async () => {
    const [registro] = await dataSource.query('SELECT auditoria_id AS id FROM registro_auditoria ORDER BY auditoria_id DESC LIMIT 1');
    await expect(dataSource.query("UPDATE registro_auditoria SET campo = 'alterado' WHERE auditoria_id = ?", [registro.id])).rejects.toThrow(/inmutable/);
    await expect(dataSource.query('DELETE FROM registro_auditoria WHERE auditoria_id = ?', [registro.id])).rejects.toThrow(/inmutable/);
    expect(admin).toBeTruthy();
  });
});
