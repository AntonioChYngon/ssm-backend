// HU-08 · Revisión del informe (validar, devolver, reabrir). Usa el informe 2027-1 de Derecho (EN_REVISION en los
// datos de desarrollo) y lo deja como estaba al terminar, para no depender del orden de las pruebas.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type Avance = { recomendacionId: string; numero: number; observacionRevision: string | null };

describe('HU-08 · revisión del informe de seguimiento', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: string;
  let derecho: string;
  let id: string;
  let cicloId: string;
  let vigenciaFin: string;
  let ultimaRevisionAntes: number;
  let avances: Avance[];
  const api = () => request(app.getHttpServer());
  const comoAdmin = (ruta: string, cuerpo: object = {}) => api().post(`/api/informes/${id}/${ruta}`).set('Authorization', `Bearer ${admin}`).send(cuerpo);
  /** Simula que la coordinación reenvió el informe (el envío real se prueba con HU-07). */
  const ponerEnRevision = () => dataSource.query("UPDATE version_informe SET estado = 'EN_REVISION', aprobado_en = NULL WHERE version_informe_id = ?", [id]);

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    admin = await tokenDe(app, 'ADMIN');
    derecho = await tokenDeCoordinacion(app, 'DER');
    const [fila] = await dataSource.query(
      `SELECT vi.version_informe_id AS id, c.ciclo_id AS ciclo, c.vigencia_fin AS fin
       FROM version_informe vi JOIN informe i ON i.informe_id = vi.informe_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = i.ciclo_id JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       WHERE l.clave = 'DER' AND i.nombre_periodo = '2027-1'`,
    );
    id = String(fila.id);
    cicloId = String(fila.ciclo);
    vigenciaFin = String(fila.fin).slice(0, 10);
    const [max] = await dataSource.query('SELECT COALESCE(MAX(revision_informe_id), 0) AS max FROM revision_informe');
    ultimaRevisionAntes = Number(max.max);
    avances = (await api().get(`/api/informes/${id}`).set('Authorization', `Bearer ${admin}`).expect(200)).body.avances;
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM observacion_informe WHERE revision_informe_id > ?', [ultimaRevisionAntes]);
      await dataSource.query('DELETE FROM revision_informe WHERE revision_informe_id > ?', [ultimaRevisionAntes]);
      await ponerEnRevision();
      await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', [vigenciaFin, cicloId]);
    }
    if (app) await app.close();
  });

  it('solo el Administrador revisa', async () => {
    await api().post(`/api/informes/${id}/validar`).set('Authorization', `Bearer ${derecho}`).send({}).expect(403);
    await api().post(`/api/informes/${id}/devolver`).set('Authorization', `Bearer ${derecho}`).send({ motivo: 'No debe poder' }).expect(403);
  });

  it('devolver exige motivo y solo acepta observaciones de recomendaciones del informe', async () => {
    await comoAdmin('devolver', {}).expect(400);
    await comoAdmin('devolver', { motivo: 'Faltan soportes', observaciones: [{ recomendacionId: '999999999', comentario: 'Ajena' }] }).expect(404);
  });

  it('devuelve con observaciones por recomendación y avisa a la coordinación con el detalle', async () => {
    const tercera = avances[2];
    const { body } = await comoAdmin('devolver', {
      motivo: 'Faltan soportes documentales',
      observaciones: [{ recomendacionId: tercera.recomendacionId, comentario: 'Sube las cotizaciones.' }],
    }).expect(200);
    expect(body).toMatchObject({ estado: 'DEVUELTO', editable: true, bloqueo: null });
    expect(body.ultimaRevision).toMatchObject({ decision: 'DEVUELTO', comentario: 'Faltan soportes documentales' });
    expect(body.avances[2].observacionRevision).toBe('Sube las cotizaciones.');

    const avisos = await api().get('/api/notificaciones').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(avisos.body[0]).toMatchObject({ tipo: 'DEVOLUCION', enlace: '/licenciatura/informe' });
    expect(avisos.body[0].descripcion).toContain(`Recomendación ${tercera.numero}: Sube las cotizaciones.`);

    // Ya no está en revisión: devolver otra vez es un conflicto de estado.
    await comoAdmin('devolver', { motivo: 'Segunda devolución' }).expect(409);
  });

  it('valida, bloquea la edición y avisa a la coordinación', async () => {
    await ponerEnRevision();
    const { body } = await comoAdmin('validar', { comentario: 'Informe completo.' }).expect(200);
    expect(body).toMatchObject({ estado: 'APROBADO', editable: false, bloqueo: 'APROBADO' });
    expect(body.aprobadoEn).toEqual(expect.any(String));
    const avisos = await api().get('/api/notificaciones').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(avisos.body[0]).toMatchObject({ titulo: 'Informe de seguimiento validado', enlace: '/licenciatura/informe' });
    expect(avisos.body[0].descripcion).toContain('Comentario: Informe completo.');
  });

  it('reabre un informe aprobado solo con motivo y borra la fecha de aprobación', async () => {
    await comoAdmin('reabrir', {}).expect(400);
    const { body } = await comoAdmin('reabrir', { motivo: 'La evidencia 2 no abre' }).expect(200);
    expect(body).toMatchObject({ estado: 'DEVUELTO', aprobadoEn: null, editable: true });
    expect(body.ultimaRevision.comentario).toBe('Reapertura: La evidencia 2 no abre');
    await comoAdmin('reabrir', { motivo: 'Ya no está aprobado' }).expect(409);
    const avisos = await api().get('/api/notificaciones').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(avisos.body[0]).toMatchObject({ titulo: 'Informe de seguimiento reabierto', tipo: 'DEVOLUCION' });
  });

  it('con el ciclo cerrado el Administrador sí puede validar y reabrir; la coordinación queda bloqueada', async () => {
    await ponerEnRevision();
    await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', ['2025-01-01', cicloId]);
    try {
      await comoAdmin('validar').expect(200);
      const { body } = await comoAdmin('reabrir', { motivo: 'Corrección tras el cierre' }).expect(200);
      expect(body).toMatchObject({ estado: 'DEVUELTO', editable: false, bloqueo: 'CICLO_CERRADO' });
    } finally {
      await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', [vigenciaFin, cicloId]);
    }
  });

  it('dos validaciones al mismo tiempo: una gana y la otra recibe 409', async () => {
    await ponerEnRevision();
    const respuestas = await Promise.all([comoAdmin('validar'), comoAdmin('validar')]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('la bitácora registra cada decisión con el rol del Administrador', async () => {
    const registros: Array<{ campo: string; valor_nuevo: string; rol_codigo: string }> = await dataSource.query(
      "SELECT campo, valor_nuevo, rol_codigo FROM registro_auditoria WHERE entidad = 'version_informe' AND entidad_id = ? ORDER BY auditoria_id",
      [id],
    );
    expect(registros.map((r) => `${r.campo}:${r.valor_nuevo}`)).toEqual(
      expect.arrayContaining(['estado:DEVUELTO', 'estado:APROBADO', 'reabierto:DEVUELTO']),
    );
    expect(registros.every((r) => r.rol_codigo === 'ADMINISTRADOR')).toBe(true);
  });
});
