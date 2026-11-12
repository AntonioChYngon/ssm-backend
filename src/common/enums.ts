// Mismos valores que ssm-frontend/src/lib/types.ts. Cambiar en ambos repos a la vez.

export enum Rol {
  ADMINISTRADOR = 'ADMINISTRADOR',
  CAPTURISTA = 'CAPTURISTA',
  AUXILIAR = 'AUXILIAR',
}

export enum EstadoDocumento {
  BORRADOR = 'BORRADOR',
  EN_REVISION = 'EN_REVISION',
  DEVUELTO = 'DEVUELTO',
  VALIDADO = 'VALIDADO',
}

export enum EstadoEvidencia {
  SUBIENDO = 'SUBIENDO',
  CONVIRTIENDO = 'CONVIRTIENDO',
  LISTO = 'LISTO',
  ERROR = 'ERROR',
}

export enum TipoNotificacion {
  VENCIMIENTO = 'VENCIMIENTO',
  HITO = 'HITO',
  DEVOLUCION = 'DEVOLUCION',
}

export enum CanalNotificacion {
  CORREO = 'CORREO',
  IN_APP = 'IN_APP',
  AMBOS = 'AMBOS',
}

export enum TipoDocumento {
  PLAN = 'PLAN',
  INFORME = 'INFORME',
}

// Catálogo de 10 categorías del plan de mejora (HU-04).
export const CATEGORIAS = [
  'Personal académico',
  'Estudiantes',
  'Plan de estudios',
  'Evaluación del aprendizaje',
  'Formación integral',
  'Servicios de apoyo',
  'Vinculación',
  'Investigación',
  'Infraestructura',
  'Gestión administrativa',
] as const;
