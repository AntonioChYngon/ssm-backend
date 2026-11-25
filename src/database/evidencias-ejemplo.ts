// Datos de desarrollo · PDF de ejemplo para las evidencias de archivo de db/datos_desarrollo.sql.
// Se escriben en CARPETAS_DIR (la misma carpeta que usa el proveedor "local") solo si aún no existen,
// y se actualizan su tamaño y checksum en la base. Así HU-08 puede abrir evidencias sin esperar a HU-07.
import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { DataSource } from 'typeorm';

/** PDF mínimo de una página con una línea de texto (solo ASCII). */
export const pdfDeEjemplo = (texto: string): Buffer => {
  const limpio = texto.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
  const contenido = `BT /F1 14 Tf 72 720 Td (${limpio}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const posiciones: number[] = [];
  objetos.forEach((obj, i) => {
    posiciones.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

export const asegurarArchivosDeEjemplo = async (ds: DataSource, base: string) => {
  const filas: Array<{ id: string; ubicacion: string; nombre: string }> = await ds.query(
    "SELECT evidencia_id AS id, ubicacion, nombre_original AS nombre FROM evidencia WHERE origen = 'ARCHIVO' AND nombre_guardado LIKE 'ejemplo-%'",
  );
  const raiz = resolve(base);
  let creados = 0;
  for (const fila of filas) {
    const ruta = resolve(raiz, ...fila.ubicacion.split('/').filter(Boolean));
    if (!ruta.startsWith(raiz + sep)) continue;
    const existe = await access(ruta).then(() => true, () => false);
    if (existe) continue;
    const pdf = pdfDeEjemplo(`Evidencia de ejemplo (datos de desarrollo): ${fila.nombre}`);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, pdf);
    await ds.query('UPDATE evidencia SET tamano_bytes = ?, checksum_sha256 = ? WHERE evidencia_id = ?', [
      pdf.length,
      createHash('sha256').update(pdf).digest('hex'),
      fila.id,
    ]);
    creados += 1;
  }
  return { total: filas.length, creados };
};
