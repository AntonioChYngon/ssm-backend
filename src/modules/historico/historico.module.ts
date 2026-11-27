// HU-16 · Archivo histórico y filtro por ciclo de acreditación / vigencia.
// - Los planes e informes de ciclos concluidos nunca se borran: siguen en la base como cualquier otro registro.
// - La consulta exige elegir un ciclo por su vigencia (fecha de emisión o periodo de la constancia de la IEVA); se
//   puede buscar por una fecha que caiga dentro de la vigencia.
// - Sobre el ciclo elegido corren todas las consultas: Plan de Mejora, Informes de Seguimiento (con sus evidencias),
//   resumen de atención (HU-15), incumplimiento (HU-14, `cicloId`) y transversales (HU-17, `cicloId`).
// - El ciclo activo y los históricos se distinguen solos (HU-18); en un ciclo cerrado la coordinación no puede modificar nada.
// Administrador: todas las licenciaturas. Captura y Auxiliar: solo la suya, en solo lectura.
import { Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsDateString, IsOptional, Matches } from 'class-validator';
import { In, Repository } from 'typeorm';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth';
import { Rol } from '../../common/enums';
import { leerLicenciaturaIds, PATRON_LICENCIATURAS } from '../../common/licenciaturas';
import { CicloAcreditacion } from '../../database/plan.entities';
import { InformesModule } from '../informes/informes.module';
import { ConsultaInformesService } from '../informes/consulta.service';
import type { InformeResumen } from '../informes/contrato';
import { PlanesModule, PlanesService, PlanResumen } from '../planes/planes.module';
import { hoyEnMexico, validarId } from '../planes/reglas';
import { ReportesModule, ReportesService } from '../reportes/reportes.module';
import type { ConteoAtencion } from '../reportes/reglas';
import { aCicloHistorico, CicloHistorico, coincideFecha } from './reglas';

export type DetalleHistorico = {
  ciclo: CicloHistorico;
  plan: PlanResumen | null;
  informes: InformeResumen[];
  /** HU-15 sobre este ciclo; null si el ciclo no tiene un plan aprobado. */
  atencion: ConteoAtencion | null;
};

export class FiltrosHistoricoDto {
  @IsOptional() @Matches(PATRON_LICENCIATURAS) licenciaturaIds?: string;
  /** Una fecha (AAAA-MM-DD): ciclos cuya vigencia la incluye o que se emitieron ese día. */
  @IsOptional() @IsDateString({}, { message: 'fecha debe ser una fecha válida (AAAA-MM-DD).' }) fecha?: string;
}

@Injectable()
export class HistoricoService {
  constructor(
    @InjectRepository(CicloAcreditacion) private readonly ciclos: Repository<CicloAcreditacion>,
    private readonly planes: PlanesService,
    private readonly informes: ConsultaInformesService,
    private readonly reportes: ReportesService,
  ) {}

  /** Ciclos (vigentes e históricos) para elegir por su vigencia. */
  async listar(usuario: UsuarioToken, filtros: FiltrosHistoricoDto): Promise<CicloHistorico[]> {
    const hoy = hoyEnMexico();
    const propias = usuario.rol === Rol.ADMINISTRADOR ? leerLicenciaturaIds(filtros.licenciaturaIds) : [usuario.licenciaturaId ?? '0'];
    const ciclos = await this.ciclos.find({
      where: propias ? { licenciaturaId: In(propias) } : {},
      relations: { licenciatura: true, organismo: true },
    });
    return ciclos
      .filter((c) => !filtros.fecha || coincideFecha(c, filtros.fecha.slice(0, 10)))
      .sort((a, b) => a.licenciatura.nombre.localeCompare(b.licenciatura.nombre, 'es') || b.vigenciaInicio.localeCompare(a.vigenciaInicio))
      .map((c) => aCicloHistorico(c, hoy));
  }

  /** Todo lo de un ciclo: plan, informes (con sus evidencias en el detalle y en los reportes) y resumen de atención. */
  async detalle(usuario: UsuarioToken, id: string): Promise<DetalleHistorico> {
    validarId(id, 'el ciclo');
    const ciclo = await this.ciclos.findOne({ where: { id }, relations: { licenciatura: true, organismo: true } });
    if (!ciclo) throw new NotFoundException('Ciclo de acreditación no encontrado.');
    if (usuario.rol !== Rol.ADMINISTRADOR && usuario.licenciaturaId !== ciclo.licenciaturaId) {
      throw new ForbiddenException('Solo puedes consultar los ciclos de tu licenciatura.');
    }
    const [planes, informes, atencion] = await Promise.all([
      this.planes.listar(usuario, [ciclo.licenciaturaId]),
      this.informes.listar(usuario, { cicloId: ciclo.id }),
      this.reportes.resumenAtencion({ cicloId: ciclo.id }),
    ]);
    const [conteo] = atencion;
    return {
      ciclo: aCicloHistorico(ciclo, hoyEnMexico()),
      plan: planes.find((p) => p.cicloId === ciclo.id) ?? null,
      informes,
      atencion: conteo ? { atendidas: conteo.atendidas, enProceso: conteo.enProceso, sinAtender: conteo.sinAtender } : null,
    };
  }
}

@ApiTags('HU-16 · Histórico')
@ApiBearerAuth()
@Controller('historico')
@Roles(Rol.ADMINISTRADOR, Rol.CAPTURA, Rol.AUXILIAR)
export class HistoricoController {
  constructor(private readonly servicio: HistoricoService) {}

  /** Ciclos para elegir por vigencia; `fecha` busca la constancia por una fecha dentro de su vigencia. */
  @Get('ciclos')
  listar(@UsuarioActual() usuario: UsuarioToken, @Query() filtros: FiltrosHistoricoDto) {
    return this.servicio.listar(usuario, filtros);
  }

  @Get('ciclos/:id')
  detalle(@UsuarioActual() usuario: UsuarioToken, @Param('id') id: string) {
    return this.servicio.detalle(usuario, id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([CicloAcreditacion]), PlanesModule, InformesModule, ReportesModule],
  controllers: [HistoricoController],
  providers: [HistoricoService],
})
export class HistoricoModule {}
