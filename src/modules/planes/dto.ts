import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { CATEGORIAS } from '../../common/enums';

export class CrearPlanDto {
  @IsUUID()
  licenciaturaId: string;

  /** Inicio del ciclo de acreditación (ciclos de 5 años). */
  @IsDateString()
  cicloInicio: string;

  @IsDateString()
  cicloFin: string;
}

export class RecomendacionDto {
  @IsIn(CATEGORIAS, { message: 'Elige una categoría del catálogo.' })
  categoria: string;

  @IsString()
  @Length(2, 160)
  criterio: string;

  @IsString()
  @Length(5, 5000)
  texto: string;

  @IsString()
  @Length(5, 5000)
  acciones: string;

  @IsString()
  @Length(2, 120)
  responsable: string;

  @IsOptional()
  @IsString()
  indicador?: string;

  @IsOptional()
  @IsString()
  meta?: string;

  @IsDateString()
  fechaInicio: string;

  @IsDateString()
  fechaTermino: string;
}

export class HitoDto {
  @IsString()
  @Length(3, 200)
  descripcion: string;

  @IsDateString()
  fechaCompromiso: string;

  @IsInt()
  @Min(1, { message: 'El % esperado debe ser entre 1 y 99.' })
  @Max(99, { message: 'El % esperado debe ser entre 1 y 99.' })
  porcentajeEsperado: number;
}

export class HitosDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HitoDto)
  hitos: HitoDto[];
}

export class ObservacionDto {
  @IsUUID()
  recomendacionId: string;

  @IsString()
  @Length(3, 2000)
  texto: string;
}

export class DevolverDto {
  @IsString()
  @Length(10, 4000, { message: 'Escribe el motivo de la devolución (al menos 10 caracteres).' })
  motivo: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ObservacionDto)
  observaciones?: ObservacionDto[];
}

export class EtiquetasDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  etiquetas: string[];
}
