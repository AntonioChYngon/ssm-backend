// HU-10 · Recordatorios automáticos. Usa el plan aprobado de Derecho de los datos de desarrollo: metas al 50 % para el
// 30/06/2026 y, en el informe 2027-1, avances de 100 · 60 · 20 · 0. Al terminar borra los avisos que generó.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { RecordatoriosService } from '../src/modules/recordatorios/recordatorios.module';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type Recordatorio = { tipo: string; recomendacion: string; comprometido: number; actual: number; clave: string };

describe('HU-10 · recordatorios automáticos', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let servicio: RecordatoriosService;
  let admin: string;
  let derecho: string;
  let licenciaturaDerecho: string;
  const api = () => request(app.getHttpServer());

  const limpiar = async () => {
    await dataSource.query('DELETE FROM recordatorio_enviado WHERE licenciatura_id = ?', [licenciaturaDerecho]);
    await dataSource.query(
      `DELETE n FROM notificacion n
       JOIN asignacion_usuario a ON a.usuario_id = n.usuario_id AND a.activa = TRUE
       JOIN coordinacion co ON co.coordinacion_id = a.coordinacion_id
       WHERE co.licenciatura_id = ? AND n.tipo IN ('RECORDATORIO_FECHA_LIMITE', 'REZAGO_DETECTADO')`,
      [licenciaturaDerecho],
    );
  };

  beforeAll(async () => {
    app = await crearApp();
    dataSource = app.get(DataSource);
    servicio = app.get(RecordatoriosService);
    admin = await tokenDe(app, 'ADMIN');
    derecho = await tokenDeCoordinacion(app, 'DER');
    const [fila] = await dataSource.query("SELECT licenciatura_id AS id FROM licenciatura WHERE clave = 'DER'");
    licenciaturaDerecho = String(fila.id);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  it('el banner es de la coordinación; el Administrador no lo consulta', async () => {
    await api().get('/api/recordatorios').set('Authorization', `Bearer ${admin}`).expect(403);
    const { body } = await api().get('/api/recordatorios').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(body).toMatchObject({ cicloActivo: true, diasAntes: 7 });
    expect(Array.isArray(body.recordatorios)).toBe(true);
  });

  it('detecta rezago contra el hito y lo muestra en el banner con % comprometido vs actual', async () => {
    const { recordatorios } = await servicio.deLicenciatura(licenciaturaDerecho, '2026-12-10');
    const rezagos = recordatorios.filter((r) => r.tipo === 'REZAGO') as Recordatorio[];
    expect(rezagos.map((r) => r.actual).sort()).toEqual([0, 20]);
    expect(rezagos.every((r) => r.comprometido === 50)).toBe(true);
    // La recomendación al 100 % no genera nada aunque su fecha límite (15/12/2026) esté a 5 días.
    expect(recordatorios.some((r) => r.tipo === 'FECHA_LIMITE')).toBe(false);
  });

  it('envía el aviso por correo e In-App una sola vez', async () => {
    const primera = await servicio.ejecutar({ hoy: '2026-12-10', licenciaturaIds: [licenciaturaDerecho] });
    expect(primera).toMatchObject({ licenciaturas: 1, avisosNuevos: 1 });
    const avisos = await api().get('/api/notificaciones').set('Authorization', `Bearer ${derecho}`).expect(200);
    expect(avisos.body[0]).toMatchObject({ tipo: 'META', titulo: 'Rezago detectado (2)', enlace: '/licenciatura/informe' });
    for (const texto of ['Indicador:', 'Recomendación: Adquirir bibliografía especializada en derecho digital', 'Meta pendiente:', '% comprometido: 50 % · % actual: 20 %', 'Fecha límite: 30/06/2027']) {
      expect(avisos.body[0].descripcion).toContain(texto);
    }

    const segunda = await servicio.ejecutar({ hoy: '2026-12-11', licenciaturaIds: [licenciaturaDerecho] });
    expect(segunda.avisosNuevos).toBe(0);
  });

  it('no avisa si el ciclo de acreditación ya terminó', async () => {
    await limpiar();
    const resultado = await servicio.ejecutar({ hoy: '2030-01-15', licenciaturaIds: [licenciaturaDerecho] });
    expect(resultado).toMatchObject({ licenciaturas: 0, avisosNuevos: 0 });
    expect((await servicio.deLicenciatura(licenciaturaDerecho, '2030-01-15')).cicloActivo).toBe(false);
  });

  it('solo el Administrador puede correr la revisión a mano', async () => {
    await api().post('/api/recordatorios/ejecutar').set('Authorization', `Bearer ${derecho}`).expect(403);
  });
});
