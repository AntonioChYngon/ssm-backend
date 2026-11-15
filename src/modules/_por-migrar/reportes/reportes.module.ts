import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { EstadoDocumento, Rol } from '../../common/enums';
import { Plan, Recomendacion } from '../planes/entities';
import { PlanesModule } from '../planes/planes.module';

const hoyIso = () => new Date().toISOString().slice(0, 10);

/** % esperado de una recomendación a una fecha: el del último hito cuya fecha ya pasó. */
const esperadoAl = (rec: Recomendacion, fecha: string) =>
  [...(rec.hitos ?? [])].sort((a, b) => a.fechaCompromiso.localeCompare(b.fechaCompromiso)).filter((h) => h.fechaCompromiso <= fecha).at(-1)?.porcentajeEsperado ?? 0;

/** % real de una recomendación: avance del hito más reciente reportado. */
const realDe = (rec: Recomendacion) => Math.max(0, ...(rec.hitos ?? []).map((h) => h.porcentajeReal));

@Injectable()
export class ReportesService {
  constructor(@InjectRepository(Plan) private readonly planes: Repository<Plan>) {}

  private async planesCon(filtro: { licenciaturaId?: string; cicloFin?: string }) {
    return this.planes.find({
      where: { ...(filtro.licenciaturaId ? { licenciaturaId: filtro.licenciaturaId } : {}), ...(filtro.cicloFin ? { cicloFin: filtro.cicloFin } : {}) },
      relations: { recomendaciones: { hitos: true } },
    });
  }

  /** KPIs y gráfica de avance real vs. esperado (pantallas 04 y 15). */
  async dashboard(usuario: UsuarioToken) {
    const planes = await this.planesCon({ licenciaturaId: usuario.rol === Rol.ADMINISTRADOR ? undefined : usuario.licenciaturaId ?? '' });
    const hoy = hoyIso();
    const hitos = planes.flatMap((p) => p.recomendaciones.flatMap((r) => r.hitos ?? []));
    const promedio = (valores: number[]) => (valores.length ? Math.round(valores.reduce((s, v) => s + v, 0) / valores.length) : 0);
    return {
      planesRegistrados: planes.length,
      planesValidados: planes.filter((p) => p.estado === EstadoDocumento.VALIDADO).length,
      porValidar: planes.filter((p) => p.estado === EstadoDocumento.EN_REVISION).length,
      hitosVencidos: hitos.filter((h) => h.fechaCompromiso < hoy && h.porcentajeReal < h.porcentajeEsperado).length,
      estados: Object.values(EstadoDocumento).map((estado) => ({ estado, total: planes.filter((p) => p.estado === estado).length })),
      avance: planes.map((p) => ({
        licenciatura: p.licenciatura.nombre,
        real: promedio(p.recomendaciones.map(realDe)),
        esperado: promedio(p.recomendaciones.map((r) => esperadoAl(r, hoy))),
      })),
    };
  }

  /** HU-15: hitos con avance real por debajo del esperado a la fecha de corte. */
  async incumplimiento(fechaCorte: string, brechaMinima: number, licenciaturaId?: string) {
    const planes = await this.planesCon({ licenciaturaId });
    return planes.flatMap((p) =>
      p.recomendaciones.flatMap((r) =>
        (r.hitos ?? [])
          .filter((h) => h.fechaCompromiso <= fechaCorte && h.porcentajeEsperado - h.porcentajeReal > brechaMinima)
          .map((h) => ({
            licenciatura: p.licenciatura.nombre,
            recomendacion: r.numero,
            hito: h.descripcion,
            fechaCompromiso: h.fechaCompromiso,
            esperado: h.porcentajeEsperado,
            real: h.porcentajeReal,
          })),
      ),
    );
  }

  /** HU-14: recomendaciones atendidas (100%), en proceso (1–99%) y sin atender (0%). */
  async atencion(licenciaturaId?: string, cicloFin?: string) {
    const planes = await this.planesCon({ licenciaturaId, cicloFin });
    return planes.map((p) => {
      const reales = p.recomendaciones.map(realDe);
      return {
        licenciatura: p.licenciatura.nombre,
        atendidas: reales.filter((v) => v >= 100).length,
        enProceso: reales.filter((v) => v > 0 && v < 100).length,
        sinAtender: reales.filter((v) => v === 0).length,
      };
    });
  }

  /** HU-16: planes de ciclos anteriores. */
  async historico(cicloFin?: string) {
    const planes = await this.planesCon({ cicloFin });
    return planes.map((p) => {
      const reales = p.recomendaciones.map(realDe);
      return {
        planId: p.id,
        licenciatura: p.licenciatura.nombre,
        organismo: p.licenciatura.organismo,
        ciclo: `${p.cicloInicio.slice(0, 4)}–${p.cicloFin.slice(0, 4)}`,
        recomendaciones: reales.length,
        atendidas: reales.length ? Math.round((reales.filter((v) => v >= 100).length / reales.length) * 100) : 0,
        estado: p.estado,
      };
    });
  }

  /** HU-17: recomendaciones agrupadas por etiqueta transversal. */
  async transversales() {
    const planes = await this.planesCon({});
    const grupos = new Map<string, { texto: string; licenciatura: string; recomendacionId: string }[]>();
    for (const p of planes) {
      for (const r of p.recomendaciones) {
        for (const etiqueta of r.etiquetas?.length ? r.etiquetas : ['Sin etiqueta']) {
          grupos.set(etiqueta, [...(grupos.get(etiqueta) ?? []), { texto: r.texto, licenciatura: p.licenciatura.nombre, recomendacionId: r.id }]);
        }
      }
    }
    return [...grupos.entries()].map(([etiqueta, items]) => ({ etiqueta, total: items.length, licenciaturas: new Set(items.map((i) => i.licenciatura)).size, items }));
  }
}

@ApiTags('Reportes')
@ApiBearerAuth()
@Controller('reportes')
export class ReportesController {
  constructor(private readonly servicio: ReportesService) {}

  @Get('dashboard')
  dashboard(@UsuarioActual() u: UsuarioToken) {
    return this.servicio.dashboard(u);
  }

  @Get('incumplimiento')
  @Roles(Rol.ADMINISTRADOR)
  @ApiQuery({ name: 'fechaCorte', required: false, description: 'YYYY-MM-DD (por defecto hoy)' })
  @ApiQuery({ name: 'brechaMinima', required: false, description: 'Puntos porcentuales (por defecto 0)' })
  @ApiQuery({ name: 'licenciaturaId', required: false })
  incumplimiento(@Query('fechaCorte') fechaCorte?: string, @Query('brechaMinima') brecha?: string, @Query('licenciaturaId') licenciaturaId?: string) {
    return this.servicio.incumplimiento(fechaCorte ?? hoyIso(), Number(brecha ?? 0), licenciaturaId);
  }

  @Get('atencion')
  @Roles(Rol.ADMINISTRADOR)
  atencion(@Query('licenciaturaId') licenciaturaId?: string, @Query('cicloFin') cicloFin?: string) {
    return this.servicio.atencion(licenciaturaId, cicloFin);
  }

  @Get('historico')
  @Roles(Rol.ADMINISTRADOR)
  historico(@Query('cicloFin') cicloFin?: string) {
    return this.servicio.historico(cicloFin);
  }

  @Get('transversales')
  @Roles(Rol.ADMINISTRADOR)
  transversales() {
    return this.servicio.transversales();
  }
}

@Module({
  imports: [PlanesModule],
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
