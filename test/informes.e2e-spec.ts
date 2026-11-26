// Bloque Informe · base compartida: lectura, permisos y evidencias. Usa db/datos_desarrollo.sql (ver su encabezado).
// Las líneas A (HU-07) y B (HU-08/HU-11) agregan aquí sus pruebas de escritura en describe propios.
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hoyEnMexico } from '../src/modules/planes/reglas';
import { semestreDe } from '../src/modules/informes/reglas';
import { crearApp, tokenDe } from './app';

type Resumen = { id: string; licenciatura: string; periodo: string; estado: string; recomendaciones: number; conAvance: number; evidencias: number };

describe('Bloque Informe · base (consulta, permisos y evidencias)', () => {
  let app: INestApplication;
  let admin: string;
  let captura: string;
  let informes: Resumen[];
  const api = () => request(app.getHttpServer());
  const buscar = (licenciatura: string, periodo: string) => {
    const r = informes.find((i) => i.licenciatura === licenciatura && i.periodo === periodo);
    if (!r) throw new Error(`Falta el informe ${licenciatura} ${periodo} en los datos de desarrollo.`);
    return r;
  };

  beforeAll(async () => {
    app = await crearApp();
    admin = await tokenDe(app, 'ADMIN');
    captura = await tokenDe(app, 'CAPTURA');
    informes = (await api().get('/api/informes').set('Authorization', `Bearer ${admin}`).expect(200)).body;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('listado', () => {
    it('el Administrador ve los informes semestrales de todas las licenciaturas', () => {
      expect(buscar('Derecho', '2026-2')).toMatchObject({ estado: 'APROBADO', recomendaciones: 4, conAvance: 3, evidencias: 1 });
      expect(buscar('Economía', '2026-2')).toMatchObject({ estado: 'APROBADO', recomendaciones: 3, conAvance: 3, evidencias: 2 });
      expect(buscar('Derecho', '2027-1')).toMatchObject({ estado: 'EN_REVISION', conAvance: 4, evidencias: 3 });
      expect(buscar('Economía', '2027-1')).toMatchObject({ estado: 'BORRADOR', conAvance: 2, evidencias: 0 });
    });

    it('filtra por estado y por semestre, y rechaza filtros inválidos', async () => {
      const r = await api().get('/api/informes?estado=EN_REVISION').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(r.body.every((i: Resumen) => i.estado === 'EN_REVISION')).toBe(true);
      expect(r.body.map((i: Resumen) => i.id)).toContain(buscar('Derecho', '2027-1').id);
      const s = await api().get('/api/informes?periodo=2026-2').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(s.body.every((i: Resumen) => i.periodo === '2026-2')).toBe(true);
      await api().get('/api/informes?estado=CUALQUIERA').set('Authorization', `Bearer ${admin}`).expect(400);
    });

    it('la coordinación solo ve los informes de su licenciatura', async () => {
      const r = await api().get('/api/informes').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(r.body.every((i: Resumen) => i.licenciatura === 'Actuaría')).toBe(true);
    });
  });

  describe('detalle', () => {
    it('arma avances, % esperado al corte, evidencias, bloqueo y la última devolución', async () => {
      const { id } = buscar('Derecho', '2027-1');
      const { body } = await api().get(`/api/informes/${id}`).set('Authorization', `Bearer ${admin}`).expect(200);
      expect(body).toMatchObject({ periodo: '2027-1', fechaInicio: '2026-08-01', fechaFin: '2027-01-31', fechaCorte: '2027-01-31' });
      expect(body).toMatchObject({ estado: 'EN_REVISION', editable: false, bloqueo: 'EN_REVISION' });
      expect(body.avances.map((a: { numero: number; porcentaje: number }) => [a.numero, a.porcentaje])).toEqual([[1, 100], [2, 60], [3, 20], [4, 0]]);
      // Las metas aprobadas comprometen 50 % al 30/06/2026, antes del corte.
      expect(body.avances[0].esperadoAlCorte).toBe(50);
      expect(body.avances[0].evidenciaObligatoria).toBe(true);
      expect(body.avances[1].observacionRevision).toBe('Sube la guía de las prácticas diseñadas.');
      expect(body.ultimaRevision).toMatchObject({ decision: 'DEVUELTO' });

      const evidencias: Array<{ id: string; origen: string; enlace: string }> = body.avances[0].evidencias;
      expect(evidencias).toHaveLength(2);
      const archivo = evidencias.find((e) => e.origen === 'ARCHIVO');
      const enlace = evidencias.find((e) => e.origen === 'URL');
      expect(archivo).toMatchObject({ externo: false, enlace: `/evidencias/${archivo?.id}/archivo` });
      expect(enlace).toMatchObject({ externo: true, tamano: null });
      expect(enlace?.enlace).toMatch(/^https?:\/\//);
    });

    it('un informe aprobado queda bloqueado como APROBADO', async () => {
      const { body } = await api().get(`/api/informes/${buscar('Economía', '2026-2').id}`).set('Authorization', `Bearer ${admin}`).expect(200);
      expect(body).toMatchObject({ editable: false, bloqueo: 'APROBADO' });
      expect(body.ultimaRevision).toMatchObject({ decision: 'APROBADO' });
    });

    it('otra licenciatura responde 404 y un id mal formado 400', async () => {
      await api().get(`/api/informes/${buscar('Derecho', '2027-1').id}`).set('Authorization', `Bearer ${captura}`).expect(404);
      await api().get('/api/informes/abc').set('Authorization', `Bearer ${admin}`).expect(400);
      await api().get('/api/informes/999999999').set('Authorization', `Bearer ${admin}`).expect(404);
    });
  });

  describe('evidencias', () => {
    it('entrega el PDF de una evidencia de archivo con sesión', async () => {
      const { body } = await api().get(`/api/informes/${buscar('Derecho', '2027-1').id}`).set('Authorization', `Bearer ${admin}`).expect(200);
      const archivo = body.avances[0].evidencias.find((e: { origen: string }) => e.origen === 'ARCHIVO');
      const r = await api().get(`/api/evidencias/${archivo.id}/archivo`).set('Authorization', `Bearer ${admin}`)
        // En Node, responseType('blob') deja el cuerpo como Buffer.
        .responseType('blob')
        .expect(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('un enlace no se descarga y otra licenciatura no puede abrir el archivo', async () => {
      const { body } = await api().get(`/api/informes/${buscar('Derecho', '2027-1').id}`).set('Authorization', `Bearer ${admin}`).expect(200);
      const evidencias: Array<{ id: string; origen: string }> = body.avances[0].evidencias;
      const archivo = evidencias.find((e) => e.origen === 'ARCHIVO');
      const enlace = evidencias.find((e) => e.origen === 'URL');
      if (!archivo || !enlace) throw new Error('Faltan las evidencias de ejemplo de Derecho 2027-1.');
      await api().get(`/api/evidencias/${enlace.id}/archivo`).set('Authorization', `Bearer ${admin}`).expect(404);
      await api().get(`/api/evidencias/${archivo.id}/archivo`).set('Authorization', `Bearer ${captura}`).expect(404);
      await api().get(`/api/evidencias/${archivo.id}/archivo`).expect(401);
    });
  });

  describe('mi informe (coordinación)', () => {
    it('devuelve el ciclo, el semestre en curso y avisa que falta el plan aprobado', async () => {
      const { body } = await api().get('/api/informes/mio').set('Authorization', `Bearer ${captura}`).expect(200);
      expect(body.ciclo).toMatchObject({ nombre: '2024-2029', licenciatura: 'Actuaría', activo: true });
      expect(body.periodo?.nombre).toBe(semestreDe(hoyEnMexico()).nombre);
      // Actuaría empieza con el plan en borrador, pero acceso.e2e lo valida: no se depende del orden de las pruebas.
      expect(typeof body.planAprobado).toBe('boolean');
      expect(body.anteriores).toEqual([]);
    });

    it('el Administrador no tiene "mi informe"', async () => {
      await api().get('/api/informes/mio').set('Authorization', `Bearer ${admin}`).expect(403);
    });
  });

  describe('HU-09 · exportación en PDF y Word', () => {
    const binario = (res: NodeJS.ReadableStream, callback: (error: Error | null, cuerpo: Buffer) => void) => {
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => partes.push(parte));
      res.on('end', () => callback(null, Buffer.concat(partes)));
    };

    it('el Administrador descarga el informe en PDF con las evidencias como enlaces', async () => {
      const { id } = buscar('Derecho', '2027-1');
      const r = await api().get(`/api/informes/${id}/pdf`).set('Authorization', `Bearer ${admin}`).buffer(true).parse(binario)
        .expect('Content-Type', /application\/pdf/)
        .expect('Content-Disposition', /filename="informe-de-seguimiento-derecho-2027-1\.pdf"/)
        .expect(200);
      const pdf = (r.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-1.4')).toBe(true);
      expect(pdf).toContain('/Subtype /Link');
      expect(pdf).toMatch(/\/URI \(https?:\/\//);
    });

    it('y en Word editable con hipervínculos externos', async () => {
      const { id } = buscar('Derecho', '2027-1');
      const r = await api().get(`/api/informes/${id}/docx`).set('Authorization', `Bearer ${admin}`).buffer(true).parse(binario)
        .expect('Content-Type', /wordprocessingml\.document/)
        .expect('Content-Disposition', /filename="informe-de-seguimiento-derecho-2027-1\.docx"/)
        .expect(200);
      const docx = r.body as Buffer;
      expect(docx.subarray(0, 2).toString()).toBe('PK');
      expect(docx.includes(Buffer.from('word/media/logo-fes-acatlan.jpeg'))).toBe(true);
    });

    it('la coordinación no puede exportar el informe de otra licenciatura', async () => {
      const { id } = buscar('Derecho', '2027-1');
      await api().get(`/api/informes/${id}/pdf`).set('Authorization', `Bearer ${captura}`).expect(404);
      await api().get(`/api/informes/${id}/docx`).set('Authorization', `Bearer ${captura}`).expect(404);
    });
  });
});
