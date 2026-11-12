/** Valida que el correo pertenezca a un dominio institucional (HU-01). */
export const esCorreoInstitucional = (correo: string, dominios: string[]): boolean => {
  const dominio = correo.trim().toLowerCase().split('@')[1] ?? '';
  return dominios.some((permitido) => dominio === permitido || dominio.endsWith(`.${permitido}`));
};

export const leerDominios = (valor: string | undefined): string[] =>
  (valor ?? 'acatlan.unam.mx,unam.mx')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

/** Reglas de contraseña que también muestra el frontend en Perfil. */
export const esContrasenaSegura = (password: string): boolean =>
  password.length >= 8 && /[A-ZÁÉÍÓÚÑ]/.test(password) && /\d/.test(password);
