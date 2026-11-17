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

    // Con db/datos_desarrollo.sql, Actuaría tiene su plan en BORRADOR.
    let cicloId: string;
    let categoriaId: string;
    let areaId: string;
    const nueva = () => ({
      categoriaId,
      indicador: 'Indicador de prueba e2e',
      descripcion: 'Recomendación de prueba e2e',
      acciones: ['Acción 1', '  ', 'Acción 2'],
      metas: ['Capacitar al 80% de la planta docente'],
      areaIds: [areaId],
      fechaCumplimiento: '2027-12-15',
      etiquetaFecha: 'Semestre 2028-1',
    });

    beforeAll(async () => {
      const plan = await api().get('/api/mi-plan').set('Authorization', `Bearer ${captura}`).expect(200);
      cicloId = plan.body.cicloId;
      const catalogos = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
      categoriaId = catalogos.body.categorias[0].id;
      areaId = catalogos.body.areas[0].id;
    });

    it('GET /mi-plan devuelve el plan de Actuaría en BORRADOR y editable', async () => {
      const r = await api().get('/api/mi-plan').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(r.body.licenciatura).toBe('Actuaría');
      expect(r.body.version).toMatchObject({ estado: 'BORRADOR', editable: true });
      expect(r.body.indicadores.length).toBeGreaterThanOrEqual(2);
    });

    it('POST /ciclos/:id/plan/recomendaciones guarda una recomendación completa', async () => {
      const r = await api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`).send(nueva()).expect(201);
      expect(r.body.acciones).toEqual(['Acción 1', 'Acción 2']);
      expect(r.body.areas).toHaveLength(1);

      const plan = await api().get(`/api/ciclos/${cicloId}/plan`).set('Authorization', `Bearer ${captura}`).expect(200);
      const guardada = plan.body.indicadores.flatMap((i: { recomendaciones: { id: string }[] }) => i.recomendaciones).find((x: { id: string }) => x.id === r.body.id);
      expect(guardada).toMatchObject({ descripcion: 'Recomendación de prueba e2e', fechaCumplimiento: '2027-12-15' });
    });

    it('permite varias recomendaciones en un mismo indicador', async () => {
      const plan = await api().get('/api/mi-plan').set('Authorization', `Bearer ${captura}`).expect(200);
      const indicador = plan.body.indicadores[0];
      const antes = indicador.recomendaciones.length;
      const datos = { ...nueva(), categoriaId: indicador.categoria.id, indicadorId: indicador.id, indicador: undefined };
      await api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`).send(datos).expect(201);

      const despues = await api().get('/api/mi-plan').set('Authorization', `Bearer ${captura}`).expect(200);
      const mismo = despues.body.indicadores.find((i: { id: string }) => i.id === indicador.id);
      expect(mismo.recomendaciones).toHaveLength(antes + 1);
    });

    it('rechaza fecha fuera de vigencia, categoría fuera del catálogo, listas vacías y metas sin porcentaje', async () => {
      const enviar = (datos: object) => api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`).send(datos);
      await enviar({ ...nueva(), fechaCumplimiento: '2031-01-01' }).expect(400);
      await enviar({ ...nueva(), categoriaId: '999999' }).expect(400);
      await enviar({ ...nueva(), metas: [] }).expect(400);
      await enviar({ ...nueva(), metas: ['Mejorar la titulación'] }).expect(400);
      await enviar({ ...nueva(), areaIds: ['999999'] }).expect(400);
    });

    it('el Administrador no captura y nadie entra a un ciclo inexistente', async () => {
      await api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${admin}`).send(nueva()).expect(403);
      await api().get('/api/ciclos/999999/plan').set('Authorization', `Bearer ${captura}`).expect(404);
      await api().get('/api/ciclos/abc/plan').set('Authorization', `Bearer ${captura}`).expect(400);
    });
  });

  describe('HU-04 · ciclos de acreditación (vigencia manual)', () => {
    type Ciclo = { id: string; licenciatura: { id: string }; estado: string; plan: unknown };
    const vigencia = { fechaEmision: '2025-01-15', vigenciaInicio: '2025-01-15', vigenciaFin: '2030-01-15' };
    let organismoId: string;
    let libre: string | undefined;

    beforeAll(async () => {
      const catalogos = await api().get('/api/catalogos').set('Authorization', `Bearer ${admin}`).expect(200);
      organismoId = catalogos.body.organismos[0].id;
      const ciclos = await api().get('/api/ciclos').set('Authorization', `Bearer ${admin}`).expect(200);
      const ocupadas = new Set((ciclos.body as Ciclo[]).filter((c) => c.estado === 'VIGENTE').map((c) => c.licenciatura.id));
      libre = (catalogos.body.licenciaturas as { id: string }[]).map((l) => l.id).find((id) => !ocupadas.has(id));
    });

    it('solo la Administradora ve y registra ciclos', async () => {
      await api().get('/api/ciclos').set('Authorization', `Bearer ${captura}`).expect(403);
      await api().post('/api/ciclos').set('Authorization', `Bearer ${captura}`).send({ ...vigencia, licenciaturaId: '1', organismoId }).expect(403);
    });

    it('rechaza vigencias inválidas o mayores a 5 años', async () => {
      const enviar = (datos: object) => api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send({ licenciaturaId: libre ?? '1', organismoId, ...datos });
      await enviar({ ...vigencia, vigenciaFin: '2025-01-15' }).expect(400);
      await enviar({ ...vigencia, vigenciaFin: '2030-01-16' }).expect(400);
      await enviar({ ...vigencia, vigenciaInicio: undefined }).expect(400);
    });

    it('registra la vigencia escrita por la Administradora, sin valores por defecto, y la deja corregir', async () => {
      if (!libre) return; // Todas las licenciaturas ya tienen ciclo en esta base local.
      const creado = await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send({ ...vigencia, licenciaturaId: libre, organismoId }).expect(201);
      expect(creado.body).toMatchObject({ ...vigencia, estado: 'VIGENTE', plan: null });

      await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send({ ...vigencia, licenciaturaId: libre, organismoId }).expect(409);

      const corregido = await api().patch(`/api/ciclos/${creado.body.id}`).set('Authorization', `Bearer ${admin}`)
        .send({ ...vigencia, vigenciaFin: '2029-12-31', licenciaturaId: libre, organismoId }).expect(200);
      expect(corregido.body.vigenciaFin).toBe('2029-12-31');
    });

    it('no deja cambiar la vigencia de un ciclo que ya tiene plan capturado', async () => {
      const plan = await api().get('/api/mi-plan').set('Authorization', `Bearer ${captura}`).expect(200);
      const ciclos = await api().get('/api/ciclos').set('Authorization', `Bearer ${admin}`).expect(200);
      const actuaria = (ciclos.body as Ciclo[]).find((c) => c.id === plan.body.cicloId)!;
      await api().patch(`/api/ciclos/${actuaria.id}`).set('Authorization', `Bearer ${admin}`)
        .send({ ...vigencia, licenciaturaId: actuaria.licenciatura.id, organismoId }).expect(409);
    });
  });

  describe('HU-15 · resumen de atención', () => {
    it('solo el Administrador puede consultarlo', async () => {
      await api().get('/api/reportes/atencion').set('Authorization', `Bearer ${captura}`).expect(403);
    });

    // Con db/datos_desarrollo.sql → DER: 1 atendida, 1 en proceso, 2 no atendidas · ECO: 2 atendidas, 1 en proceso.
    it.todo('cuenta las recomendaciones de Derecho y Economía según los datos de desarrollo');
  });
});
