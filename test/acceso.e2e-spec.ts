// Pruebas de integración: usan la base real (local o la de GitHub Actions) ya cargada con `npm run seed`.
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
  const usuariosTemporales: string[] = [];
  const ciclosCreados: string[] = [];

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
    if (ciclosCreados.length) await dataSource.query('DELETE FROM ciclo_acreditacion WHERE ciclo_id IN (?)', [ciclosCreados]);
    for (const id of usuariosTemporales) {
      await dataSource.query('UPDATE asignacion_usuario SET activa = FALSE, desactivada_en = CURRENT_TIMESTAMP WHERE usuario_id = ? AND activa = TRUE', [id]);
      await dataSource.query('UPDATE usuario SET activo = FALSE WHERE usuario_id = ?', [id]);
    }
    if (usuarioPruebaId) {
      await dataSource.query('UPDATE asignacion_usuario SET activa = FALSE, desactivada_en = CURRENT_TIMESTAMP WHERE usuario_id = ? AND activa = TRUE', [usuarioPruebaId]);
      await dataSource.query('UPDATE usuario SET activo = FALSE WHERE usuario_id = ?', [usuarioPruebaId]);
    }
    if (app) await app.close();
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

    it('una cuenta con contraseña temporal solo puede cambiarla; al hacerlo recibe un token normal', async () => {
      const sociologia = await dataSource.query('SELECT coordinacion_id AS id FROM coordinacion WHERE nombre = ? LIMIT 1', ['Coordinación de Sociología']);
      const correo = `temporal.${Date.now()}@acatlan.unam.mx`;
      const creada = await api().post('/api/usuarios').set('Authorization', `Bearer ${admin}`).send({
        nombre: 'Prueba',
        apellido: 'Temporal',
        correo,
        rol: 'AUXILIAR',
        coordinacionId: String(sociologia[0].id),
      }).expect(201);
      usuariosTemporales.push(String(creada.body.id));
      // La temporal real va por correo; en la prueba se fija una conocida sin tocar la marca de cambio pendiente.
      await dataSource.query('UPDATE usuario SET hash_contrasena = ? WHERE usuario_id = ?', [await bcrypt.hash('Temporal2026', 4), creada.body.id]);

      const sesion = await api().post('/api/auth/login').send({ correo, contrasena: 'Temporal2026' }).expect(200);
      expect(sesion.body.usuario.debeCambiarContrasena).toBe(true);
      const temporal = sesion.body.token as string;
      await api().get('/api/notificaciones').set('Authorization', `Bearer ${temporal}`).expect(403);
      await api().get('/api/auth/me').set('Authorization', `Bearer ${temporal}`).expect(200);
      await api().post('/api/auth/cambiar-contrasena').set('Authorization', `Bearer ${temporal}`).send({ actual: 'Temporal2026', nueva: 'Temporal2026' }).expect(400);

      const cambio = await api().post('/api/auth/cambiar-contrasena').set('Authorization', `Bearer ${temporal}`).send({ actual: 'Temporal2026', nueva: 'Definitiva2026' }).expect(200);
      expect(cambio.body.usuario.debeCambiarContrasena).toBe(false);
      await api().get('/api/notificaciones').set('Authorization', `Bearer ${cambio.body.token}`).expect(200);
      // Sin otro login: el límite es de 5 por minuto y la suite ya usa los demás.
      const perfil = await api().get('/api/auth/me').set('Authorization', `Bearer ${cambio.body.token}`).expect(200);
      expect(perfil.body.debeCambiarContrasena).toBe(false);
    });
  });

  describe('HU-04 · plan', () => {
    it('los catálogos traen las 10 categorías en orden', async () => {
      const r = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(r.body.categorias).toHaveLength(10);
      expect(r.body.categorias[0].nombre).toBe('Personal Académico');
    });

    // Flujo completo sobre el plan de Actuaría (BORRADOR en db/datos_desarrollo.sql). Al final se restaura.
    describe('captura, envío y validación', () => {
      let planId: string;
      let cicloId: string;
      let recomendacionId: string;
      const notificacionIds: string[] = [];

      afterAll(async () => {
        if (recomendacionId) {
          await dataSource.query('UPDATE observacion_plan SET recomendacion_id = NULL WHERE recomendacion_id = ?', [recomendacionId]);
          await dataSource.query('DELETE FROM meta WHERE recomendacion_id = ?', [recomendacionId]);
          await dataSource.query('DELETE FROM accion_recomendacion WHERE recomendacion_id = ?', [recomendacionId]);
          const [rec] = await dataSource.query('SELECT indicador_id FROM recomendacion WHERE recomendacion_id = ?', [recomendacionId]);
          await dataSource.query('DELETE FROM recomendacion WHERE recomendacion_id = ?', [recomendacionId]);
          if (rec) await dataSource.query('DELETE FROM indicador WHERE indicador_id = ? AND NOT EXISTS (SELECT 1 FROM recomendacion r WHERE r.indicador_id = ?)', [rec.indicador_id, rec.indicador_id]);
        }
        if (planId) {
          await dataSource.query('DELETE o FROM observacion_plan o JOIN revision_plan r ON r.revision_plan_id = o.revision_plan_id WHERE r.version_plan_id = ?', [planId]);
          await dataSource.query('DELETE FROM revision_plan WHERE version_plan_id = ?', [planId]);
          await dataSource.query("UPDATE version_plan SET estado = 'BORRADOR', enviado_en = NULL, aprobado_en = NULL WHERE version_plan_id = ?", [planId]);
          if (notificacionIds.length) await dataSource.query('DELETE FROM notificacion WHERE notificacion_id IN (?)', [notificacionIds]);
        }
      });

      it('GET /planes/mio devuelve el ciclo vigente y el plan en borrador', async () => {
        const r = await api().get('/api/planes/mio').set('Authorization', `Bearer ${captura}`).expect(200);
        expect(r.body.ciclo.licenciatura).toBe('Actuaría');
        expect(r.body.plan.estado).toBe('BORRADOR');
        planId = r.body.plan.id;
        cicloId = r.body.ciclo.id;
        await api().get('/api/planes/mio').set('Authorization', `Bearer ${admin}`).expect(403);
      });

      it('Guardar borrador acepta solo Categoría, Indicador y Recomendación', async () => {
        const { body: catalogos } = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
        const r = await api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`).send({
          categoriaId: catalogos.categorias[2].id,
          indicador: 'Indicador de prueba e2e',
          descripcion: 'Recomendación de prueba e2e',
        }).expect(201);
        const nueva = r.body.recomendacionesDetalle.find((x: { descripcion: string }) => x.descripcion === 'Recomendación de prueba e2e');
        expect(nueva).toBeDefined();
        expect(nueva.indicador).toBe('Indicador de prueba e2e');
        recomendacionId = nueva.id;
        await api().get(`/api/planes/${planId}/pdf`).set('Authorization', `Bearer ${admin}`)
          .expect('Content-Type', /application\/pdf/)
          .expect('Content-Disposition', /attachment; filename=/)
          .expect(200);
      });

      it('Enviar a validación exige recomendaciones completas', async () => {
        const r = await api().post(`/api/planes/${planId}/enviar`).set('Authorization', `Bearer ${captura}`).expect(400);
        expect(r.body.message).toContain('área responsable');
      });

      it('completa la recomendación, configura sus metas y la envía', async () => {
        const { body: catalogos } = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
        await api().put(`/api/recomendaciones/${recomendacionId}`).set('Authorization', `Bearer ${captura}`).send({
          categoriaId: catalogos.categorias[2].id,
          indicador: 'Indicador de prueba e2e',
          descripcion: 'Recomendación de prueba e2e',
          areaResponsable: 'Área inventada fuera del catálogo',
        }).expect(400);
        const r = await api().put(`/api/recomendaciones/${recomendacionId}`).set('Authorization', `Bearer ${captura}`).send({
          categoriaId: catalogos.categorias[2].id,
          indicador: 'Indicador de prueba e2e',
          descripcion: 'Recomendación de prueba e2e',
          acciones: ['Acción de prueba'],
          metas: ['Meta 1', 'Meta 2'],
          areaResponsable: catalogos.areas[0].nombre,
          fechaCumplimiento: '2028-06-30',
        }).expect(200);
        const rec = r.body.recomendacionesDetalle.find((x: { id: string }) => x.id === recomendacionId);
        expect(rec.metas).toHaveLength(2);

        // HU-12: con metas escritas pero sin fecha ni % todavía no se puede enviar.
        const sinHitos = await api().post(`/api/planes/${planId}/enviar`).set('Authorization', `Bearer ${captura}`).expect(400);
        expect(sinHitos.body.message).toContain('al menos una meta con fecha y % esperado');

        // HU-12: un hito no puede quedar antes de la creación del plan.
        await api().put(`/api/recomendaciones/${recomendacionId}/metas`).set('Authorization', `Bearer ${captura}`).send({
          metas: [{ id: rec.metas[0].id, descripcion: 'Meta 1', fechaCompromiso: '2025-01-15', porcentajeEsperado: 50 }],
        }).expect(400);

        await api().put(`/api/recomendaciones/${recomendacionId}/metas`).set('Authorization', `Bearer ${captura}`).send({
          metas: [
            { id: rec.metas[0].id, descripcion: 'Meta 1', fechaCompromiso: '2027-06-30', porcentajeEsperado: 50 },
            { id: rec.metas[1].id, descripcion: 'Meta 2', fechaCompromiso: '2029-01-01', porcentajeEsperado: 80 },
          ],
        }).expect(400); // posterior a la fecha de cumplimiento

        const metas = await api().put(`/api/recomendaciones/${recomendacionId}/metas`).set('Authorization', `Bearer ${captura}`).send({
          metas: [
            { id: rec.metas[0].id, descripcion: 'Meta 1', fechaCompromiso: '2027-06-30', porcentajeEsperado: 50 },
            { id: rec.metas[1].id, descripcion: 'Meta 2', fechaCompromiso: '2028-01-15', porcentajeEsperado: 80 },
          ],
        }).expect(200);
        const configurada = metas.body.recomendacionesDetalle.find((x: { id: string }) => x.id === recomendacionId);
        expect(configurada.metas.map((m: { porcentajeEsperado: number }) => m.porcentajeEsperado)).toEqual([50, 80]);

        const enviado = await api().post(`/api/planes/${planId}/enviar`).set('Authorization', `Bearer ${captura}`).expect(200);
        expect(enviado.body.estado).toBe('EN_REVISION');
        await api().post(`/api/ciclos/${cicloId}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`).send({
          categoriaId: catalogos.categorias[0].id, indicador: 'No debe guardarse', descripcion: 'No debe guardarse',
        }).expect(409);
      });

      it('el Administrador lo ve, lo devuelve con observaciones y luego lo valida', async () => {
        const lista = await api().get('/api/planes').set('Authorization', `Bearer ${admin}`).expect(200);
        expect(lista.body.find((p: { id: string }) => p.id === planId).estado).toBe('EN_REVISION');
        await api().post(`/api/planes/${planId}/validar`).set('Authorization', `Bearer ${captura}`).expect(403);

        const devuelto = await api().post(`/api/planes/${planId}/devolver`).set('Authorization', `Bearer ${admin}`).send({
          motivo: 'Revisar la redacción',
          observaciones: [{ recomendacionId, comentario: 'Precisa la meta 2' }],
        }).expect(200);
        expect(devuelto.body.estado).toBe('DEVUELTO');

        const mio = await api().get('/api/planes/mio').set('Authorization', `Bearer ${captura}`).expect(200);
        expect(mio.body.plan.ultimaRevision.comentario).toBe('Revisar la redacción');
        expect(mio.body.plan.revisiones).toHaveLength(1);
        expect(mio.body.plan.revisiones[0].decision).toBe('DEVUELTO');
        expect(mio.body.plan.recomendacionesDetalle.find((x: { id: string }) => x.id === recomendacionId).observacion).toBe('Precisa la meta 2');

        const avisos = await api().get('/api/notificaciones').set('Authorization', `Bearer ${captura}`).expect(200);
        expect(avisos.body[0].tipo).toBe('DEVOLUCION');
        // HU-05: el aviso detalla la observación de cada recomendación.
        expect(avisos.body[0].descripcion).toMatch(/Recomendación \d+: Precisa la meta 2/);
        notificacionIds.push(String(avisos.body[0].id));
        await api().patch(`/api/notificaciones/${avisos.body[0].id}/leida`).set('Authorization', `Bearer ${captura}`).expect(200);
        const leida = await api().get('/api/notificaciones').set('Authorization', `Bearer ${captura}`).expect(200);
        expect(leida.body.find((n: { id: string }) => n.id === avisos.body[0].id).leida).toBe(true);

        await api().post(`/api/planes/${planId}/enviar`).set('Authorization', `Bearer ${captura}`).expect(200);
        const validado = await api().post(`/api/planes/${planId}/validar`).set('Authorization', `Bearer ${admin}`).send({}).expect(200);
        expect(validado.body.estado).toBe('APROBADO');
        expect(validado.body.editable).toBe(false);
        expect(validado.body.revisiones).toHaveLength(2);
        expect(validado.body.revisiones.map((r: { decision: string }) => r.decision)).toEqual(['DEVUELTO', 'APROBADO']);
        const avisosFinales = await api().get('/api/notificaciones').set('Authorization', `Bearer ${captura}`).expect(200);
        const avisoValidacion = avisosFinales.body.find((n: { titulo: string }) => n.titulo === 'Plan de mejora validado');
        expect(avisoValidacion).toBeDefined();
        notificacionIds.push(String(avisoValidacion.id));
      });
    });
  });

  describe('HU-18 · ciclos de acreditación', () => {
    const idDe = async (tabla: 'licenciatura' | 'organismo_acreditador', columna: string, valor: string) => {
      const filas = await dataSource.query(`SELECT ${tabla === 'licenciatura' ? 'licenciatura_id' : 'organismo_id'} AS id FROM ${tabla} WHERE ${columna} = ? LIMIT 1`, [valor]);
      return String(filas[0].id);
    };

    it('solo el Administrador administra los ciclos', async () => {
      await api().get('/api/ciclos').set('Authorization', `Bearer ${captura}`).expect(403);
      const r = await api().get('/api/ciclos').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(r.body.find((c: { licenciatura: { nombre: string } }) => c.licenciatura.nombre === 'Actuaría')).toMatchObject({ nombre: '2024-2029', activo: true });
    });

    it('inicia un ciclo con su carpeta, impide otro activo y valida la vigencia', async () => {
      const licenciaturaId = await idDe('licenciatura', 'clave', 'SOC');
      const organismoId = await idDe('organismo_acreditador', 'siglas', 'CIEES');
      const datos = { licenciaturaId, organismoId, fechaEmision: '2026-01-10', vigenciaInicio: '2026-01-15', vigenciaFin: '2031-01-15' };

      await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send({ ...datos, vigenciaFin: '2031-01-16' }).expect(400);
      const creado = await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send(datos).expect(201);
      ciclosCreados.push(String(creado.body.id));
      expect(creado.body).toMatchObject({ nombre: '2026-2031', estado: 'VIGENTE', activo: true, plan: null });
      expect(creado.body.carpeta.ruta).toBe('/Evidencias/Sociología/2026-2031');

      const otro = await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`).send({ ...datos, fechaEmision: '2026-02-01' }).expect(409);
      expect(otro.body.message).toContain('Podrás iniciar uno nuevo cuando termine');

      const corregido = await api().patch(`/api/ciclos/${creado.body.id}`).set('Authorization', `Bearer ${admin}`).send({ ...datos, nombre: 'Reacreditación 2026' }).expect(200);
      expect(corregido.body.carpeta.ruta).toBe('/Evidencias/Sociología/Reacreditación 2026');
    });

    it('un ciclo con la vigencia ya vencida se registra como histórico', async () => {
      const licenciaturaId = await idDe('licenciatura', 'clave', 'SOC');
      const organismoId = await idDe('organismo_acreditador', 'siglas', 'CIEES');
      const r = await api().post('/api/ciclos').set('Authorization', `Bearer ${admin}`)
        .send({ licenciaturaId, organismoId, fechaEmision: '2019-05-01', vigenciaInicio: '2019-05-01', vigenciaFin: '2024-05-01' }).expect(201);
      ciclosCreados.push(String(r.body.id));
      expect(r.body).toMatchObject({ nombre: '2019-2024', estado: 'HISTORICO', activo: false });
    });

    it('al terminar la vigencia bloquea la captura con el mensaje de la historia', async () => {
      const mio = await api().get('/api/planes/mio').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(mio.body.ciclo).toMatchObject({ nombre: '2024-2029', activo: true, mensaje: null });
      const cicloActual = mio.body.ciclo.id as string;
      await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', ['2025-01-01', cicloActual]);
      try {
        const vencido = await api().get('/api/planes/mio').set('Authorization', `Bearer ${captura}`).expect(200);
        expect(vencido.body.ciclo.activo).toBe(false);
        expect(vencido.body.ciclo.mensaje).toContain('El ciclo de acreditación ha finalizado');
        const { body: catalogos } = await api().get('/api/catalogos').set('Authorization', `Bearer ${captura}`).expect(200);
        const r = await api().post(`/api/ciclos/${cicloActual}/plan/recomendaciones`).set('Authorization', `Bearer ${captura}`)
          .send({ categoriaId: catalogos.categorias[0].id, indicador: 'Fuera de vigencia', descripcion: 'Fuera de vigencia' }).expect(409);
        expect(r.body.message).toContain('Contacte a la Unidad de Planeación');
      } finally {
        await dataSource.query('UPDATE ciclo_acreditacion SET vigencia_fin = ? WHERE ciclo_id = ?', ['2029-11-28', cicloActual]);
      }
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
