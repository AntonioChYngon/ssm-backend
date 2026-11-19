import { NotificacionesService } from './notificaciones.module';
import { UsuarioToken } from '../../common/auth';

describe('NotificacionesService.marcarTodasLeidas', () => {
  it('solo actualiza avisos pendientes del usuario autenticado y devuelve el total', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 3 }) };
    const servicio = new NotificacionesService(repo as never, {} as never);

    await expect(servicio.marcarTodasLeidas({ sub: 'usuario-7' } as UsuarioToken)).resolves.toEqual({ actualizadas: 3 });

    const [filtro, cambios] = repo.update.mock.calls[0];
    expect(filtro).toMatchObject({ usuarioId: 'usuario-7' });
    expect(filtro.leidaEn).toBeDefined();
    expect(cambios.leidaEn).toBeInstanceOf(Date);
  });

  it('devuelve cero cuando no hay avisos pendientes', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 0 }) };
    const servicio = new NotificacionesService(repo as never, {} as never);

    await expect(servicio.marcarTodasLeidas({ sub: 'usuario-8' } as UsuarioToken)).resolves.toEqual({ actualizadas: 0 });
  });
});
