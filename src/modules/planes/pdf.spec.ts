import { generarPdfPlan } from './pdf';

describe('generarPdfPlan', () => {
  it('genera un PDF descargable con la tabla de recomendaciones', () => {
    const archivo = generarPdfPlan({
      licenciatura: 'Actuaría',
      organismo: 'CONAC',
      ciclo: '2024-2029',
      vigenciaInicio: '2024-11-28',
      vigenciaFin: '2029-11-28',
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
    // HU-06: logotipo incrustado y referenciado en la página.
    expect(pdf).toContain('/Subtype /Image /Width 720 /Height 209');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain('/XObject << /Logo 4 0 R >>');
  });

  it('la tabla xref apunta al inicio exacto de cada objeto aunque haya bytes binarios', () => {
    const archivo = generarPdfPlan({
      licenciatura: 'Derecho', organismo: 'CONAED', ciclo: '2024-2029', vigenciaInicio: '2024-11-28', vigenciaFin: '2029-11-28',
      estado: 'APROBADO', actualizado: '25/11/2026', recomendacionesDetalle: [],
    });
    const texto = archivo.toString('latin1');
    const inicioXref = Number(/startxref\n(\d+)/.exec(texto)![1]);
    expect(texto.slice(inicioXref, inicioXref + 4)).toBe('xref');
    const offsets = [...texto.slice(inicioXref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(texto.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('pagina reportes con contenido extenso sin perder filas', () => {
    const archivo = generarPdfPlan({
      licenciatura: 'Actuaría', organismo: 'CONAC', ciclo: '2024-2029', vigenciaInicio: '2024-11-28', vigenciaFin: '2029-11-28', estado: 'BORRADOR', actualizado: '19/11/2026',
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
