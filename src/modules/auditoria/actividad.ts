// Traduce registros de auditoría a frases para "Mi perfil · Actividad reciente" (HU-02 / HU-03).
// Solo describe lo que hizo la propia persona; nunca expone valores (contraseñas, correos de terceros, JSON).

export type TipoActividad = 'SESION' | 'SEGURIDAD' | 'PLAN' | 'CUENTAS' | 'CICLOS' | 'OTRO';

export type Actividad = {
  id: string;
  tipo: TipoActividad;
  descripcion: string;
  /** ISO 8601 en UTC; el frontend lo muestra en la hora local. */
  fecha: string;
};

type Registro = { id: string; entidad: string; campo: string; valorNuevo: string | null; ocurridoEn: Date };

const estadoDe = (valor: string | null) => {
  if (!valor) return null;
  try {
    const dato = JSON.parse(valor) as { estado?: string };
    return dato.estado ?? null;
  } catch {
    return valor;
  }
};

const describir = ({ entidad, campo, valorNuevo }: Registro): [TipoActividad, string] => {
  if (entidad === 'usuario') {
    if (campo === 'sesion') return valorNuevo === 'INTENTO_FALLIDO' ? ['SEGURIDAD', 'Intento de inicio de sesión con contraseña incorrecta'] : ['SESION', 'Inicio de sesión'];
    if (campo === 'hash_contrasena') {
      if (valorNuevo === 'RESTABLECIDA_POR_ADMINISTRADOR') return ['CUENTAS', 'Restableció la contraseña de una cuenta'];
      if (valorNuevo === 'RESTABLECIDA') return ['SEGURIDAD', 'Restableció su contraseña con el enlace del correo'];
      return ['SEGURIDAD', 'Cambió su contraseña'];
    }
    if (campo === 'alta') return ['CUENTAS', 'Dio de alta una cuenta'];
    if (campo === 'asignacion') return ['CUENTAS', 'Cambió la asignación de una cuenta'];
    if (campo === 'estado') return ['CUENTAS', estadoDe(valorNuevo) === 'INACTIVO' ? 'Desactivó una cuenta' : 'Activó una cuenta'];
  }
  if (entidad === 'recomendacion') {
    if (campo.startsWith('creada')) return ['PLAN', 'Agregó una recomendación al plan'];
    if (campo.startsWith('actualizada')) return ['PLAN', 'Editó una recomendación del plan'];
    if (campo === 'eliminada') return ['PLAN', 'Eliminó una recomendación del plan'];
    if (campo === 'metas configuradas') return ['PLAN', 'Configuró las metas de una recomendación'];
  }
  if (entidad === 'version_plan' && campo === 'estado') {
    if (valorNuevo === 'EN_REVISION') return ['PLAN', 'Envió el plan de mejora a validación'];
    if (valorNuevo === 'APROBADO') return ['PLAN', 'Validó un plan de mejora'];
    if (valorNuevo === 'DEVUELTO') return ['PLAN', 'Devolvió un plan de mejora con observaciones'];
  }
  if (entidad === 'ciclo_acreditacion') {
    if (campo === 'alta') return ['CICLOS', 'Inició un ciclo de acreditación'];
    if (campo === 'vigencia') return ['CICLOS', 'Corrigió un ciclo de acreditación'];
    if (campo === 'carpeta') return ['CICLOS', 'Creó la carpeta de evidencias de un ciclo'];
    if (campo === 'estado') return ['CICLOS', 'Archivó un ciclo de acreditación como histórico'];
  }
  return ['OTRO', 'Actualizó información del sistema'];
};

export const describirActividad = (registro: Registro): Actividad => {
  const [tipo, descripcion] = describir(registro);
  return { id: registro.id, tipo, descripcion, fecha: registro.ocurridoEn.toISOString() };
};
