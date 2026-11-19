import { generarPdfPlan } from './pdf';

describe('generarPdfPlan', () => {
  it('genera un PDF descargable con la tabla de recomendaciones', () => {
    const archivo = generarPdfPlan({
      licenciatura: 'Actuaría',
      organismo: 'CONAC',
      ciclo: '2024–2029',
      estado: 'BORRADOR',
      actualizado: '19/11/2026',
      recomendacionesDetalle: [{
        numero: 1,
        categoria: 'Personal académico',
        indicador: 'Formación docente',
        descripcion: 'Fortalecer la actualización del personal académico.',
        acciones: ['Organizar cursos semestrales.'],
        metas: [{ descripcion: 'Impartir dos cursos', fechaCompromiso: '2027-06-30', porcentajeEsperado: 50 }],
        areaResponsable: 'Secretaría Académica',
        fechaCumplimiento: '2028-06-30',
      }],
    });

    const pdf = archivo.toString('ascii');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(pdf).toContain('/Count 1');
    expect(pdf.endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('startxref');
  });

  it('pagina reportes con contenido extenso sin perder filas', () => {
    const archivo = generarPdfPlan({
      licenciatura: 'Actuaría', organismo: 'CONAC', ciclo: '2024–2029', estado: 'BORRADOR', actualizado: '19/11/2026',
      recomendacionesDetalle: [{
        numero: 1, categoria: 'Servicios', indicador: 'Seguimiento', descripcion: 'Actualizar procesos. '.repeat(350),
        acciones: [], metas: [], areaResponsable: 'Secretaría Académica', fechaCumplimiento: '2028-06-30',
      }],
    });
    const pdf = archivo.toString('ascii');
    expect(pdf).toMatch(/\/Count [2-9]/);
    expect(pdf).toContain('%%EOF');
  });
});
