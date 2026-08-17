import { PAGE } from '../core/constants.js';
import { drawObject } from './shapes.js';

/** Paints a page (white background + every object) in document coordinates. */
export function renderPage(ctx, page, options = {}) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  if (page) {
    for (const obj of page.objects) drawObject(ctx, obj, options);
  }
  ctx.restore();
}

/**
 * Renders a page into an offscreen canvas at `scale` (1 = 96 dpi).
 * Used by thumbnails and by every export path so output always matches
 * exactly what is on screen.
 */
export function renderPageToCanvas(page, { scale = 1, assets = null, canvas = null } = {}) {
  const width = Math.round(PAGE.width * scale);
  const height = Math.round(PAGE.height * scale);
  const target = canvas ?? document.createElement('canvas');
  target.width = width;
  target.height = height;

  const ctx = target.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderPage(ctx, page, { assets, placeholders: false });
  return target;
}
