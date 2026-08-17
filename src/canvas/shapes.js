import { OBJECT_TYPES } from '../core/constants.js';
import { boundsOf } from '../core/geometry.js';

export const TEXT_PADDING = 6;
export const TEXT_LINE_HEIGHT = 1.34;

export const fontFor = (obj) =>
  `${obj.bold ? '600 ' : ''}${obj.fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

/** Wraps `text` to `maxWidth`, honouring explicit line breaks. */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let current = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = current + word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export function measureText(ctx, obj) {
  ctx.save();
  ctx.font = fontFor(obj);
  const lines = wrapText(ctx, obj.text, Math.max(10, obj.w - TEXT_PADDING * 2));
  ctx.restore();
  return {
    lines,
    lineHeight: obj.fontSize * TEXT_LINE_HEIGHT,
    height: lines.length * obj.fontSize * TEXT_LINE_HEIGHT + TEXT_PADDING * 2,
  };
}

function withAlpha(ctx, alpha, fn) {
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  fn();
  ctx.globalAlpha = previous;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

function drawImageObject(ctx, obj, { assets, placeholders = true }) {
  const b = boundsOf(obj);
  const image = assets?.get(obj.assetId) ?? null;

  if (image) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, b.x, b.y, b.w, b.h);
  } else if (placeholders) {
    ctx.save();
    ctx.fillStyle = '#eef1f6';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = '#c7ccd8';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.restore();
  }

  if (obj.frame?.on && obj.frame.width > 0) {
    ctx.save();
    ctx.strokeStyle = obj.frame.color;
    ctx.lineWidth = obj.frame.width;
    ctx.strokeRect(b.x + obj.frame.width / 2, b.y + obj.frame.width / 2, b.w - obj.frame.width, b.h - obj.frame.width);
    ctx.restore();
  }
}

function drawArrowHead(ctx, x1, y1, x2, y2, width) {
  const size = Math.max(9, width * 3.4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread));
  ctx.lineTo(x2 - size * Math.cos(angle) * 0.72, y2 - size * Math.sin(angle) * 0.72);
  ctx.lineTo(x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx, obj) {
  const b = boundsOf(obj);

  if (obj.background?.on) {
    withAlpha(ctx, obj.background.opacity ?? 1, () => {
      ctx.fillStyle = obj.background.color;
      roundRectPath(ctx, b.x, b.y, b.w, b.h, 3);
      ctx.fill();
    });
  }
  if (obj.border?.on && obj.border.width > 0) {
    ctx.strokeStyle = obj.border.color;
    ctx.lineWidth = obj.border.width;
    roundRectPath(ctx, b.x + obj.border.width / 2, b.y + obj.border.width / 2, b.w - obj.border.width, b.h - obj.border.width, 3);
    ctx.stroke();
  }
  if (!obj.text) return;

  const { lines, lineHeight } = measureText(ctx, obj);
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
  ctx.font = fontFor(obj);
  ctx.fillStyle = obj.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = obj.align === 'center' ? 'center' : obj.align === 'right' ? 'right' : 'left';
  const anchorX = obj.align === 'center'
    ? b.x + b.w / 2
    : obj.align === 'right'
      ? b.x + b.w - TEXT_PADDING
      : b.x + TEXT_PADDING;
  lines.forEach((line, i) => {
    ctx.fillText(line, anchorX, b.y + TEXT_PADDING + i * lineHeight);
  });
  ctx.restore();
}

/** Paints a single object in document coordinates. */
export function drawObject(ctx, obj, options = {}) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (obj.type) {
    case OBJECT_TYPES.image:
      drawImageObject(ctx, obj, options);
      break;

    case OBJECT_TYPES.box: {
      const b = boundsOf(obj);
      ctx.strokeStyle = obj.stroke;
      ctx.lineWidth = obj.strokeWidth;
      roundRectPath(ctx, b.x, b.y, b.w, b.h, obj.radius ?? 0);
      ctx.stroke();
      break;
    }

    case OBJECT_TYPES.marker:
    case OBJECT_TYPES.highlight: {
      const b = boundsOf(obj);
      withAlpha(ctx, obj.opacity, () => {
        ctx.fillStyle = obj.fill;
        // Marker bands get a slight rounding so they read like a felt-tip pass.
        roundRectPath(ctx, b.x, b.y, b.w, b.h, obj.type === OBJECT_TYPES.marker ? Math.min(3, b.h / 3) : 1);
        ctx.fill();
      });
      break;
    }

    case OBJECT_TYPES.ellipse: {
      const b = boundsOf(obj);
      ctx.strokeStyle = obj.stroke;
      ctx.lineWidth = obj.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 0.5), Math.max(b.h / 2, 0.5), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case OBJECT_TYPES.line: {
      ctx.strokeStyle = obj.stroke;
      ctx.lineWidth = obj.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
      break;
    }

    case OBJECT_TYPES.arrow: {
      const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
      const head = Math.max(9, obj.strokeWidth * 3.4);
      const shaftX = obj.x2 - Math.cos(angle) * head * 0.62;
      const shaftY = obj.y2 - Math.sin(angle) * head * 0.62;
      ctx.strokeStyle = obj.stroke;
      ctx.fillStyle = obj.stroke;
      ctx.lineWidth = obj.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(shaftX, shaftY);
      ctx.stroke();
      drawArrowHead(ctx, obj.x1, obj.y1, obj.x2, obj.y2, obj.strokeWidth);
      break;
    }

    case OBJECT_TYPES.text:
      if (!options.skipTextIds?.has(obj.id)) drawText(ctx, obj);
      else {
        // While editing, keep the frame visible but let the DOM editor show the text.
        const stub = { ...obj, text: '' };
        drawText(ctx, stub);
      }
      break;

    default:
      break;
  }

  ctx.restore();
}
