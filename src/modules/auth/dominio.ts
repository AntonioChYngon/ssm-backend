/** Dominios que acepta la base (CHECK ck_usuario_correo_institucional). */
export const DOMINIOS_POR_DEFECTO = 'acatlan.unam.mx,pcpuma.acatlan.unam.mx';

export const leerDominios = (valor: string | undefined): string[] =>
  (valor ?? DOMINIOS_POR_DEFECTO)
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

const FORMATO_CORREO = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Valida el correo institucional igual que la base: el dominio debe coincidir exactamente (HU-01). */
export const esCorreoInstitucional = (correo: string, dominios: string[]): boolean => {
  const limpio = correo.trim().toLowerCase();
  if (!FORMATO_CORREO.test(limpio)) return false;
  return dominios.includes(limpio.split('@')[1] ?? '');
};

/** Reglas de contraseña que también muestra el frontend en Perfil. */
export const esContrasenaSegura = (password: string): boolean =>
  password.length >= 8 && /[A-ZÁÉÍÓÚÑ]/.test(password) && /\d/.test(password);
