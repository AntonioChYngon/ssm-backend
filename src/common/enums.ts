// Códigos de la tabla `rol`. Mismos valores en ssm-frontend/src/lib/types.ts.
export enum Rol {
  ADMINISTRADOR = 'ADMINISTRADOR',
  CAPTURA = 'CAPTURA',
  AUXILIAR = 'AUXILIAR',
}

// Estados de version_plan y version_informe (CHECK ck_plan_estado / ck_version_informe_estado).
export enum EstadoVersion {
  BORRADOR = 'BORRADOR',
  EN_REVISION = 'EN_REVISION',
  APROBADO = 'APROBADO',
  DEVUELTO = 'DEVUELTO',
}
