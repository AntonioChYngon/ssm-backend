// HU-07 · Captura del informe y HU-11 · aviso de entrega. Usa el informe 2027-1 de Economía (BORRADOR en los datos de
// desarrollo) y lo deja como estaba al terminar, para no depender del orden de las pruebas.
import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { pdfDeEjemplo } from '../src/database/evidencias-ejemplo';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type Evidencia = { id: string; origen: string; nombre: string; enlace: string };
type Avance = { recomendacionId: string; numero: number; porcentaje: number | null; evidencias: Evidencia[] };

describe('HU-07 · captura del informe de seguimiento', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: string;
  let economia: string;
  let auxiliar: string;
  let derecho: string;
  let id: string;
  let cicloId: string;
  let vigenciaFin: string;
  let avances: Avance[];
  const ids = { evidencia: 0, revision: 0, avances: [] as Array<{ id: string; porcentaje: string; observaciones: string | null }> };
  const api = () => request(app.getHttpServer());
  const como = (token: string) => ({
    put: (ruta: string, cuerpo: object) => api().put(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo),
    post: (ruta: string, cuerpo: object = {}) => api().post(`/api${ruta}`).set('Authorization', `Bearer ${token}`).send(cuerpo),
    del: (ruta: string) => api().delete(`/api${ruta}`).set('Authorization', `Bearer ${token}`),
    get: (ruta: string) => api().get(`/api${ruta}`).set('Authorization', `Bearer ${token}`),
  });
  const avance = (n: number) => avances[n - 1]!;
  const ruta = (n: number, resto = '') => `/informes/${id}/avances/${avance(n).recomendacionId}${resto}`;
  const subir = (token: string, n: number, nombre: string, contenido: Buffer) =>
    api().post(`/api${ruta(n, '/evidencias')}`).set('Authorization', `Bearer ${token}`).attach('archivo', contenido, nombre);

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    admin = await tokenDe(app, 'ADMIN');
    economia = await tokenDeCoordinacion(app, 'ECO');
    auxiliar = await tokenDeCoordinacion(app, 'ECO', 'AUXILIAR');
    derecho = await tokenDeCoordinacion(app, 'DER');
    const [fila] = await dataSource.query(
      `SELECT vi.version_informe_id AS id, c.ciclo_id AS ciclo, c.vigencia_fin AS fin
       FROM version_informe vi JOIN informe i ON i.informe_id = vi.informe_id
       JOIN ciclo_acreditacion c ON c.ciclo_id = i.ciclo_id JOIN licenciatura l ON l.licenciatura_id = c.licenciatura_id
       WHERE l.clave = 'ECO' AND i.nombre_periodo = '2027-1'`,
    );
    id = String(fila.id);
    cicloId = String(fila.ciclo);
    vigenciaFin = String(fila.fin).slice(0, 10);
    const [ev] = await dataSource.query('SELECT COALESCE(MAX(evidencia_id), 0) AS max FROM evidencia');
    const [rev] = await dataSource.query('SELECT COALESCE(MAX(revision_informe_id), 0) AS max FROM revision_informe');
    ids.evidencia = Number(ev.max);
    ids.revision = Number(rev.max);
    ids.avances = await dataSource.query('SELECT avance_id AS id, porcentaje, observaciones FROM avance_recomendacion WHERE version_informe_id = ?', [id]);
    avances = (await como(economia).get(`/informes/${id}`).expect(200)).body.avances;
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM evidencia WHERE evidencia_id > ?', [ids.evidencia]);
      await dataSource.query('DELETE FROM observacion_informe WHERE revision_informe_id > ?', [ids.revision]);
      await dataSource.query('DELETE FROM revision_informe WHERE revision_informe_id > ?', [ids.revision]);
      // Avances: se borran los nuevos y se regresan los originales a su % y observaciones.
      const originales = ids.avances.map((a) => a.id);
      if (originales.length) await dataSource.query('DELETE FROM avance_recomendacion WHERE version_informe_id = ? AND avance_id NOT IN (?)', [id, originales]);
      for (const a of ids.avances) await dataSource.query('UPDATE avance_recomendacion SET porcentaje = ?, observaciones = ? WHERE avance_id = ?', [a.porcentaje, a.observaciones, a.id]);
      await dataSource.query("UPDATE version_informe SET estado = 'BORRADOR', enviado_en = NULL, aprobado_en = NULL WHERE version_informe_id = ?", [id]);
      await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', [vigenciaFin, cicloId]);
    }
    if (app) await app.close();
  });

  it('"Iniciar informe del semestre" devuelve el del semestre en curso si ya existe', async () => {
    const { body: mio } = await como(economia).get('/informes/mio').expect(200);
    expect(mio).toMatchObject({ planAprobado: true, periodo: { nombre: '2027-1' } });
    expect(mio.informe.id).toBe(id);
    const { body } = await como(economia).post(`/ciclos/${cicloId}/informes`).expect(201);
    expect(body.id).toBe(id);
    // Otra licenciatura no puede iniciar en este ciclo; el Administrador no captura.
    await como(derecho).post(`/ciclos/${cicloId}/informes`).expect(404);
    await como(admin).post(`/ciclos/${cicloId}/informes`).expect(403);
  });

  it('el % se escribe con teclado: solo enteros de 0 a 100', async () => {
    for (const porcentaje of [50.5, -1, 101, '50']) await como(economia).put(ruta(3), { porcentaje }).expect(400);
    await como(economia).put(`/informes/${id}/avances/999999999`, { porcentaje: 10 }).expect(404);
    await como(derecho).put(ruta(3), { porcentaje: 10 }).expect(404);
  });

  it('una evidencia necesita primero el % de su recomendación', async () => {
    const r = await como(economia).post(ruta(3, '/enlaces'), { url: 'https://www.acatlan.unam.mx/' }).expect(400);
    expect(r.body.message).toContain('Captura primero el % de avance de la recomendación 3');
  });

  it('guarda % y observaciones (también la Auxiliar) y lo registra campo por campo', async () => {
    const { body } = await como(auxiliar).put(ruta(3), { porcentaje: 30, observaciones: 'Dos artículos en dictamen.' }).expect(200);
    expect(body.avances[2]).toMatchObject({ porcentaje: 30, observaciones: 'Dos artículos en dictamen.', evidenciaObligatoria: false });
    expect(body.conAvance).toBe(3);
    const registros: Array<{ campo: string; valor_nuevo: string; rol_codigo: string }> = await dataSource.query(
      "SELECT campo, valor_nuevo, rol_codigo FROM registro_auditoria WHERE entidad = 'avance_recomendacion' AND entidad_id = ? ORDER BY auditoria_id DESC LIMIT 2",
      [avance(3).recomendacionId],
    );
    expect(registros.map((r) => r.campo).sort()).toEqual(['observaciones · Informe 2027-1', 'porcentaje · Informe 2027-1']);
    expect(registros.every((r) => r.rol_codigo === 'AUXILIAR')).toBe(true);
  });

  it('no deja enviar si una recomendación al 100 % no tiene evidencia', async () => {
    const r = await como(economia).post(`/informes/${id}/enviar`).expect(400);
    expect(r.body.message).toContain('Recomendación 1: falta al menos una evidencia (está al 100 %)');
  });

  it('acepta enlaces http(s) y archivos PDF; rechaza tipos y contenidos no permitidos', async () => {
    await como(economia).post(ruta(1, '/enlaces'), { url: 'ftp://servidor/acta.pdf' }).expect(400);
    const enlace = await como(economia).post(ruta(1, '/enlaces'), { url: 'https://www.acatlan.unam.mx/egresados', nombre: 'Tablero de egresados' }).expect(201);
    expect(enlace.body.avances[0].evidencias).toEqual([expect.objectContaining({ origen: 'URL', nombre: 'Tablero de egresados', externo: true })]);

    const pdf = await subir(economia, 1, 'Reporte del sistema.pdf', pdfDeEjemplo('Reporte del sistema')).expect(201);
    const archivo = pdf.body.avances[0].evidencias.find((e: Evidencia) => e.origen === 'ARCHIVO');
    expect(archivo).toMatchObject({ nombre: 'Reporte del sistema.pdf', externo: false });
    const descarga = await como(admin).get(archivo.enlace).responseType('blob').expect(200);
    expect((descarga.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await subir(economia, 1, 'programa.exe', Buffer.from('MZ ejecutable')).expect(415);
    await subir(economia, 1, 'disfrazado.pdf', Buffer.from([0x50, 0x4b, 0x03, 0x04])).expect(415);
    await api().post(`/api${ruta(1, '/evidencias')}`).set('Authorization', `Bearer ${economia}`).expect(400);
  });

  it('un archivo de Office se convierte a PDF, o responde 503 si el servidor no tiene LibreOffice', async () => {
    // .docx mínimo: es un ZIP (firma PK); sin LibreOffice la API pide reintentar o usar un enlace.
    const r = await subir(economia, 2, 'acta.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    expect([201, 503]).toContain(r.status);
    if (r.status === 503) expect(r.body.message).toContain('enlace');
  });

  it('quitar una evidencia borra el registro pero conserva el archivo en la carpeta', async () => {
    const { body } = await como(economia).get(`/informes/${id}`).expect(200);
    const archivo = body.avances[0].evidencias.find((e: Evidencia) => e.origen === 'ARCHIVO');
    const [fila] = await dataSource.query('SELECT ubicacion FROM evidencia WHERE evidencia_id = ?', [archivo.id]);
    const quitada = await como(economia).del(`/evidencias/${archivo.id}`).expect(200);
    expect(quitada.body.avances[0].evidencias.some((e: Evidencia) => e.id === archivo.id)).toBe(false);
    expect(existsSync(join(process.env.CARPETAS_DIR ?? 'storage', ...String(fila.ubicacion).split('/').filter(Boolean)))).toBe(true);
    await como(derecho).del(`/evidencias/${archivo.id}`).expect(404);
  });

  it('envía a revisión, avisa a los Administradores (HU-11) y bloquea la edición', async () => {
    const { body } = await como(economia).post(`/informes/${id}/enviar`).expect(200);
    expect(body).toMatchObject({ estado: 'EN_REVISION', editable: false, bloqueo: 'EN_REVISION' });
    expect(body.enviadoEn).toEqual(expect.any(String));
    const avisos = await como(admin).get('/notificaciones').expect(200);
    expect(avisos.body[0]).toMatchObject({ titulo: 'Informe de seguimiento por revisar', enlace: '/admin/informes' });
    expect(avisos.body[0].descripcion).toContain('Economía envió su informe de seguimiento 2027-1');
    await como(economia).put(ruta(2), { porcentaje: 60 }).expect(409);
    await como(economia).post(ruta(2, '/enlaces'), { url: 'https://www.acatlan.unam.mx/' }).expect(409);
  });

  it('devuelto, la coordinación corrige y reenvía; aprobado, ya no puede editar', async () => {
    await como(admin).post(`/informes/${id}/devolver`, { motivo: 'Precisa el avance 2', observaciones: [{ recomendacionId: avance(2).recomendacionId, comentario: 'Sube el acta.' }] }).expect(200);
    const corregido = await como(economia).put(ruta(2), { porcentaje: 60 }).expect(200);
    expect(corregido.body.avances[1]).toMatchObject({ porcentaje: 60, observacionRevision: 'Sube el acta.' });
    await como(economia).post(`/informes/${id}/enviar`).expect(200);
    await como(admin).post(`/informes/${id}/validar`).expect(200);
    const r = await como(economia).put(ruta(2), { porcentaje: 70 }).expect(409);
    expect(r.body.message).toContain('aprobado');
  });

  it('con el ciclo cerrado la coordinación no puede guardar, subir ni enviar', async () => {
    await como(admin).post(`/informes/${id}/reabrir`, { motivo: 'Prueba de ciclo cerrado' }).expect(200);
    await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', ['2025-01-01', cicloId]);
    try {
      const r = await como(economia).put(ruta(2), { porcentaje: 80 }).expect(409);
      expect(r.body.message).toContain('El ciclo de acreditación ha finalizado');
      await como(economia).post(ruta(2, '/enlaces'), { url: 'https://www.acatlan.unam.mx/' }).expect(409);
      await como(economia).post(`/informes/${id}/enviar`).expect(409);
      await como(economia).post(`/ciclos/${cicloId}/informes`).expect(409);
    } finally {
      await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', [vigenciaFin, cicloId]);
    }
  });
});
