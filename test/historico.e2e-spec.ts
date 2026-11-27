// HU-16 · Archivo histórico. Usa el ciclo 2019-2024 de Derecho de db/datos_historicos.sql: plan APROBADO con
// 3 recomendaciones e informes 2024-1 (80 · 100 · 40) y 2024-2 (100 · 100 · 70), ambos APROBADOS. Solo consulta.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp, tokenDe, tokenDeCoordinacion } from './app';

type Ciclo = { id: string; nombre: string; licenciatura: { nombre: string }; estado: string; activo: boolean; etiqueta: string };

describe('HU-16 · archivo histórico por ciclo de acreditación', () => {
  let app: INestApplication;
  let admin: string;
  let derecho: string;
  let economia: string;
  let historico: Ciclo;
  const api = () => request(app.getHttpServer());
  const como = (token: string, ruta: string) => api().get(`/api${ruta}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await crearApp();
    admin = await tokenDe(app, 'ADMIN');
    derecho = await tokenDeCoordinacion(app, 'DER');
    economia = await tokenDeCoordinacion(app, 'ECO');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lista los ciclos vigentes e históricos para elegir por su vigencia', async () => {
    const { body } = await como(derecho, '/historico/ciclos').expect(200);
    const ciclos = body as Ciclo[];
    expect(ciclos.every((c) => c.licenciatura.nombre === 'Derecho')).toBe(true);
    expect(ciclos.map((c) => c.nombre)).toEqual(['2024-2029', '2019-2024']);
    historico = ciclos[1];
    expect(historico).toMatchObject({
      estado: 'HISTORICO',
      activo: false,
      etiqueta: '28 de noviembre de 2019 al 28 de noviembre de 2024 · CONAED',
    });
    expect(ciclos[0].activo).toBe(true);
  });

  it('busca la constancia por una fecha dentro de su vigencia', async () => {
    const { body } = await como(admin, '/historico/ciclos?fecha=2021-05-10').expect(200);
    expect((body as Ciclo[]).map((c) => `${c.licenciatura.nombre} ${c.nombre}`)).toContain('Derecho 2019-2024');
    expect((body as Ciclo[]).some((c) => c.nombre === '2024-2029')).toBe(false);
    await como(admin, '/historico/ciclos?fecha=10-05-2021').expect(400);
  });

  it('muestra el plan, los informes y el resumen de atención del ciclo histórico', async () => {
    const { body } = await como(admin, `/historico/ciclos/${historico.id}`).expect(200);
    expect(body.ciclo).toMatchObject({ nombre: '2019-2024', activo: false });
    expect(body.plan).toMatchObject({ cicloId: historico.id, estado: 'APROBADO', recomendaciones: 3 });
    expect(body.informes.map((i: { periodo: string }) => i.periodo)).toEqual(['2024-2', '2024-1']);
    expect(body.informes.every((i: { estado: string }) => i.estado === 'APROBADO')).toBe(true);
    // Último informe capturado (2024-2): 100 · 100 · 70.
    expect(body.atencion).toEqual({ atendidas: 2, enProceso: 1, sinAtender: 0 });
  });

  it('la coordinación consulta solo los ciclos de su licenciatura', async () => {
    await como(derecho, `/historico/ciclos/${historico.id}`).expect(200);
    await como(economia, `/historico/ciclos/${historico.id}`).expect(403);
    const { body } = await como(economia, '/historico/ciclos').expect(200);
    expect((body as Ciclo[]).every((c) => c.licenciatura.nombre === 'Economía')).toBe(true);
  });

  it('las evidencias históricas se siguen abriendo y el informe se exporta', async () => {
    const { body } = await como(admin, `/historico/ciclos/${historico.id}`).expect(200);
    const informe = body.informes.find((i: { periodo: string }) => i.periodo === '2024-2');
    const detalle = await como(derecho, `/informes/${informe.id}`).expect(200);
    const archivo = detalle.body.avances[0].evidencias.find((e: { origen: string }) => e.origen === 'ARCHIVO');
    const pdf = await como(derecho, `/evidencias/${archivo.id}/archivo`).responseType('blob').expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const reporte = await como(admin, `/informes/${informe.id}/pdf`).responseType('blob').expect(200);
    expect((reporte.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('los reportes de resumen, incumplimiento y transversales corren sobre el ciclo histórico', async () => {
    const atencion = await como(admin, `/reportes/atencion?cicloId=${historico.id}`).expect(200);
    expect(atencion.body).toEqual([expect.objectContaining({ licenciatura: 'Derecho', atendidas: 2, enProceso: 1, sinAtender: 0 })]);

    // Al corte del 2024-1: 80 · 100 · 40 → por debajo del 90 %: la 1 y la 3.
    const incumplimiento = await como(admin, `/reportes/incumplimiento?cicloId=${historico.id}&fechaCorte=2024-01-31&porcentajeEsperado=90`).expect(200);
    expect(incumplimiento.body.map((f: { real: number }) => f.real).sort((a: number, b: number) => a - b)).toEqual([40, 80]);
    expect(incumplimiento.body.every((f: { ciclo: string }) => f.ciclo === '2019-2024')).toBe(true);

    const transversales = await como(admin, `/transversales/recomendaciones?cicloId=${historico.id}`).expect(200);
    expect(transversales.body).toHaveLength(3);
    expect(transversales.body.every((r: { ciclo: { vigente: boolean } }) => r.ciclo.vigente === false)).toBe(true);
  });

  it('en un ciclo cerrado la coordinación no puede modificar nada', async () => {
    await api()
      .post(`/api/ciclos/${historico.id}/plan/recomendaciones`)
      .set('Authorization', `Bearer ${derecho}`)
      .send({ categoriaId: '1', indicador: 'No debe guardarse', descripcion: 'No debe guardarse' })
      .expect(409);
    await api().post(`/api/ciclos/${historico.id}/informes`).set('Authorization', `Bearer ${derecho}`).expect(409);
  });
});
