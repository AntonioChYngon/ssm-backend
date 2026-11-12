import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from './dominio';

describe('Validación de correo institucional', () => {
  const dominios = leerDominios('acatlan.unam.mx,unam.mx');

  it('acepta correos de los dominios institucionales', () => {
    expect(esCorreoInstitucional('jorge.ramirez@acatlan.unam.mx', dominios)).toBe(true);
    expect(esCorreoInstitucional('Persona@UNAM.MX', dominios)).toBe(true);
    expect(esCorreoInstitucional('alumno@pcpuma.acatlan.unam.mx', dominios)).toBe(true);
  });

  it('rechaza correos personales o con dominios parecidos', () => {
    expect(esCorreoInstitucional('rosa.cruz@gmail.com', dominios)).toBe(false);
    expect(esCorreoInstitucional('alguien@unam.mx.fake.com', dominios)).toBe(false);
    expect(esCorreoInstitucional('sin-arroba', dominios)).toBe(false);
  });
});

describe('Reglas de contraseña', () => {
  it('exige 8 caracteres, una mayúscula y un número', () => {
    expect(esContrasenaSegura('Acatlan2026')).toBe(true);
    expect(esContrasenaSegura('acatlan2026')).toBe(false);
    expect(esContrasenaSegura('Acatlan')).toBe(false);
  });
});
