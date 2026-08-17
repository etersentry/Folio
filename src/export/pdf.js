import { PAGE } from '../core/constants.js';

/**
 * Minimal PDF writer — one full-page image per document page.
 *
 * Two encodings are supported and both keep the render pixel-exact:
 *   • flate — raw RGB compressed with zlib (lossless, larger files)
 *   • jpeg  — the canvas JPEG stream embedded verbatim via /DCTDecode
 * No third-party library is involved, so exporting works fully offline.
 */

const encoder = new TextEncoder();

export const supportsLossless = () => typeof CompressionStream === 'function';

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Canvas → { bytes, filter } ready to embed. */
export async function encodeCanvas(canvas, { lossless = false, quality = 0.92 } = {}) {
  if (lossless && supportsLossless()) {
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    return { bytes: await deflate(rgb), filter: '/FlateDecode', width, height };
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('El navegador no pudo codificar la página');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    filter: '/DCTDecode',
    width: canvas.width,
    height: canvas.height,
  };
}

function pdfDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

const escapePdfText = (text) => String(text).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, '');

/**
 * @param {Array<{bytes:Uint8Array, filter:string, width:number, height:number}>} images
 * @param {{title?:string}} meta
 * @returns {Blob} application/pdf
 */
export function assemblePdf(images, { title = 'Documento' } = {}) {
  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (num) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };
  const endObject = () => push('endobj\n');

  const pageCount = images.length;
  // 1 catalog, 2 pages tree, 3 info, then 3 objects per page.
  const pageObjNum = (i) => 4 + i * 3;
  const contentObjNum = (i) => 5 + i * 3;
  const imageObjNum = (i) => 6 + i * 3;
  const totalObjects = 3 + pageCount * 3;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObject();

  beginObject(2);
  push(`<< /Type /Pages /Count ${pageCount} /Kids [${
    images.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ')
  }] >>\n`);
  endObject();

  beginObject(3);
  push(`<< /Title (${escapePdfText(title)}) /Producer (Folio) /Creator (Folio) /CreationDate (${pdfDate()}) >>\n`);
  endObject();

  images.forEach((image, i) => {
    const content = `q ${PAGE.ptWidth} 0 0 ${PAGE.ptHeight} 0 0 cm /Im0 Do Q\n`;

    beginObject(pageObjNum(i));
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.ptWidth} ${PAGE.ptHeight}] `
      + `/Resources << /XObject << /Im0 ${imageObjNum(i)} 0 R >> >> `
      + `/Contents ${contentObjNum(i)} 0 R >>\n`);
    endObject();

    beginObject(contentObjNum(i));
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`);
    endObject();

    beginObject(imageObjNum(i));
    push('<< /Type /XObject /Subtype /Image '
      + `/Width ${image.width} /Height ${image.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${image.filter} `
      + `/Length ${image.bytes.length} >>\nstream\n`);
    push(image.bytes);
    push('\nendstream\n');
    endObject();
  });

  const xrefOffset = length;
  push(`xref\n0 ${totalObjects + 1}\n`);
  push('0000000000 65535 f \n');
  for (let num = 1; num <= totalObjects; num += 1) {
    push(`${String(offsets[num] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 3 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}
