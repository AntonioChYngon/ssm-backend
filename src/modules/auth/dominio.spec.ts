import { esContrasenaSegura, esCorreoInstitucional, leerDominios } from './dominio';

describe('Validación de correo institucional', () => {
  const dominios = leerDominios(undefined);

  it('acepta los dominios definidos en el esquema', () => {
    expect(esCorreoInstitucional('jorge.ramirez@acatlan.unam.mx', dominios)).toBe(true);
    expect(esCorreoInstitucional('423101700@pcpuma.acatlan.unam.mx', dominios)).toBe(true);
    expect(esCorreoInstitucional('  Persona@ACATLAN.UNAM.MX ', dominios)).toBe(true);
  });

  it('rechaza correos personales, otros dominios UNAM y dominios parecidos', () => {
    expect(esCorreoInstitucional('rosa.cruz@gmail.com', dominios)).toBe(false);
    expect(esCorreoInstitucional('persona@unam.mx', dominios)).toBe(false);
    expect(esCorreoInstitucional('alguien@otro.acatlan.unam.mx', dominios)).toBe(false);
    expect(esCorreoInstitucional('alguien@acatlan.unam.mx.fake.com', dominios)).toBe(false);
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
