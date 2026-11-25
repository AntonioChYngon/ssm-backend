import { cuerpoCorreo, NotificacionesService } from './notificaciones.module';
import { UsuarioToken } from '../../common/auth';

describe('NotificacionesService.marcarTodasLeidas', () => {
  it('solo actualiza avisos pendientes del usuario autenticado y devuelve el total', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 3 }) };
    const servicio = new NotificacionesService(repo as never, {} as never, {} as never, {} as never);

    await expect(servicio.marcarTodasLeidas({ sub: 'usuario-7' } as UsuarioToken)).resolves.toEqual({ actualizadas: 3 });

    const [filtro, cambios] = repo.update.mock.calls[0];
    expect(filtro).toMatchObject({ usuarioId: 'usuario-7' });
    expect(filtro.leidaEn).toBeDefined();
    expect(cambios.leidaEn).toBeInstanceOf(Date);
  });

  it('devuelve cero cuando no hay avisos pendientes', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 0 }) };
    const servicio = new NotificacionesService(repo as never, {} as never, {} as never, {} as never);

    await expect(servicio.marcarTodasLeidas({ sub: 'usuario-8' } as UsuarioToken)).resolves.toEqual({ actualizadas: 0 });
  });
});

describe('NotificacionesService · aviso por correo (HU-05, HU-11)', () => {
  const destinatarios = [
    { usuarioId: '1', correo: 'admin.uno@acatlan.unam.mx' },
    { usuarioId: '2', correo: 'admin.dos@acatlan.unam.mx' },
  ];
  const crearServicio = (enviar: jest.Mock) => {
    const repo = { insert: jest.fn().mockResolvedValue(undefined) };
    const consulta = { innerJoin: jest.fn(), where: jest.fn(), select: jest.fn(), addSelect: jest.fn(), getRawMany: jest.fn().mockResolvedValue(destinatarios) };
    [consulta.innerJoin, consulta.where, consulta.select, consulta.addSelect].forEach((fn) => fn.mockReturnValue(consulta));
    const asignaciones = { createQueryBuilder: jest.fn().mockReturnValue(consulta) };
    const config = { get: jest.fn().mockReturnValue('https://ssm.ejemplo.mx/') };
    const servicio = new NotificacionesService(repo as never, asignaciones as never, { enviar } as never, config as never);
    return { servicio, repo };
  };
  const aviso = { tipo: 'PLAN_ENVIADO' as const, titulo: 'Plan de mejora por validar', mensaje: 'Actuaría envió su plan.' };

  it('envía un correo a cada destinatario y guarda el aviso In-App como ENVIADA', async () => {
    const enviar = jest.fn().mockResolvedValue(undefined);
    const { servicio, repo } = crearServicio(enviar);

    await servicio.notificarAdministradores(aviso);

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls[0][0]).toMatchObject({ para: 'admin.uno@acatlan.unam.mx', asunto: 'SSM · Plan de mejora por validar' });
    expect(enviar.mock.calls[0][0].texto).toContain('https://ssm.ejemplo.mx/admin/planes');
    expect(repo.insert.mock.calls[0][0].map((n: { estado: string }) => n.estado)).toEqual(['ENVIADA', 'ENVIADA']);
  });

  it('si un correo falla, el aviso In-App se guarda igual y se marca FALLIDA solo para ese destinatario', async () => {
    const enviar = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SMTP caído'));
    const { servicio, repo } = crearServicio(enviar);

    await expect(servicio.notificarAdministradores(aviso)).resolves.toBeUndefined();

    expect(repo.insert.mock.calls[0][0].map((n: { estado: string }) => n.estado)).toEqual(['ENVIADA', 'FALLIDA']);
  });

  it('el cuerpo del correo lleva el mensaje y el enlace a la pantalla correspondiente', () => {
    const texto = cuerpoCorreo({ tipo: 'PLAN_DEVUELTO', titulo: 't', mensaje: 'Motivo: faltan metas' }, 'http://localhost:3000');
    expect(texto).toContain('Motivo: faltan metas');
    expect(texto).toContain('http://localhost:3000/licenciatura/plan');
  });

  it('los avisos del informe llevan a la pantalla del informe (HU-08, HU-11)', () => {
    const enlace = (tipo: 'INFORME_ENVIADO' | 'INFORME_VALIDADO' | 'INFORME_DEVUELTO' | 'INFORME_REABIERTO') =>
      cuerpoCorreo({ tipo, titulo: 't', mensaje: 'm' }, 'http://localhost:3000');
    expect(enlace('INFORME_ENVIADO')).toContain('http://localhost:3000/admin/informes');
    expect(enlace('INFORME_VALIDADO')).toContain('http://localhost:3000/licenciatura/informe');
    expect(enlace('INFORME_DEVUELTO')).toContain('http://localhost:3000/licenciatura/informe');
    expect(enlace('INFORME_REABIERTO')).toContain('http://localhost:3000/licenciatura/informe');
  });
});
