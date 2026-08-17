import { PAGE } from '../core/constants.js';
import { renderPageToCanvas } from '../canvas/renderer.js';
import { usedAssetIds, isPageEmpty, allPages } from '../document/model.js';
import { sanitizeFileName, downloadBlob } from '../core/util.js';
import { assemblePdf, encodeCanvas, supportsLossless } from './pdf.js';

const dpiToScale = (dpi) => dpi / 96;

/** Every page that has at least one object, in document order. */
export function exportablePages(doc) {
  return allPages(doc).filter((page) => !isPageEmpty(page));
}

async function ensureAssets(assets, pages) {
  const ids = new Set();
  for (const page of pages) {
    for (const obj of page.objects) if (obj.assetId) ids.add(obj.assetId);
  }
  await assets.loadAll([...ids]);
}

/** Current page → PNG or JPG blob at the requested resolution. */
export async function exportPageImage(page, { assets, format = 'png', dpi = 200, quality = 0.94 }) {
  await ensureAssets(assets, [page]);
  const canvas = renderPageToCanvas(page, { scale: dpiToScale(dpi), assets });
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('El navegador no pudo generar la imagen');
  return blob;
}

/**
 * Non-empty pages → single Letter-sized PDF.
 * Pages are rasterised one at a time so memory stays bounded on long documents.
 */
export async function exportPdf(doc, {
  assets, dpi = 200, lossless = false, quality = 0.92, onProgress = null,
} = {}) {
  const pages = exportablePages(doc);
  if (!pages.length) throw new Error('No hay páginas con contenido para exportar');
  await ensureAssets(assets, pages);

  const scale = dpiToScale(dpi);
  const images = [];
  const reusable = document.createElement('canvas');

  for (const [index, page] of pages.entries()) {
    onProgress?.({ index, total: pages.length });
    renderPageToCanvas(page, { scale, assets, canvas: reusable });
    images.push(await encodeCanvas(reusable, { lossless: lossless && supportsLossless(), quality }));
  }

  // Free the scratch canvas before assembling the (large) blob.
  reusable.width = 1;
  reusable.height = 1;

  onProgress?.({ index: pages.length, total: pages.length });
  return { blob: assemblePdf(images, { title: doc.name }), pages: pages.length };
}

export function saveExport(blob, name, extension) {
  downloadBlob(blob, `${sanitizeFileName(name, 'documento')}.${extension}`);
}

/** Approximate output size for the export dialog. */
export function pixelSizeFor(dpi) {
  return {
    width: Math.round(PAGE.width * dpiToScale(dpi)),
    height: Math.round(PAGE.height * dpiToScale(dpi)),
  };
}

export { usedAssetIds };
