import { SEGMENT_TYPES, HIT_TOLERANCE, MIN_OBJECT_SIZE } from './constants.js';

export const isSegment = (obj) => SEGMENT_TYPES.includes(obj.type);

/** Axis-aligned bounds of any object, always with positive width/height. */
export function boundsOf(obj) {
  if (isSegment(obj)) {
    const x = Math.min(obj.x1, obj.x2);
    const y = Math.min(obj.y1, obj.y2);
    return { x, y, w: Math.abs(obj.x2 - obj.x1), h: Math.abs(obj.y2 - obj.y1) };
  }
  const x = obj.w < 0 ? obj.x + obj.w : obj.x;
  const y = obj.h < 0 ? obj.y + obj.h : obj.y;
  return { x, y, w: Math.abs(obj.w), h: Math.abs(obj.h) };
}

/** Bounds padded by half the stroke so hit tests and selection feel right. */
export function paddedBounds(obj, extra = 0) {
  const b = boundsOf(obj);
  const pad = (obj.strokeWidth ?? 0) / 2 + extra;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function normalizeBox(obj) {
  if (isSegment(obj)) return obj;
  const b = boundsOf(obj);
  obj.x = b.x;
  obj.y = b.y;
  obj.w = Math.max(b.w, MIN_OBJECT_SIZE);
  obj.h = Math.max(b.h, MIN_OBJECT_SIZE);
  return obj;
}

export const pointInRect = (px, py, r) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export const rectsIntersect = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function unionRects(rects) {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointOnEllipseEdge(px, py, b, tolerance) {
  const rx = b.w / 2;
  const ry = b.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (px - (b.x + rx)) / rx;
  const ny = (py - (b.y + ry)) / ry;
  const v = nx * nx + ny * ny;
  const inner = Math.max(0, 1 - (2 * tolerance) / Math.min(rx, ry));
  return v <= 1 + (2 * tolerance) / Math.min(rx, ry) && v >= inner * inner;
}

/**
 * True when the point touches the object. Filled shapes (image, marker,
 * highlight, text) are hit anywhere inside; outlined shapes only near the edge
 * so overlapping annotations stay individually reachable.
 */
export function hitTest(obj, px, py, tolerance = HIT_TOLERANCE) {
  const tol = tolerance + (obj.strokeWidth ?? 0) / 2;
  if (isSegment(obj)) {
    return distanceToSegment(px, py, obj.x1, obj.y1, obj.x2, obj.y2) <= tol;
  }
  const b = boundsOf(obj);
  const outer = { x: b.x - tol, y: b.y - tol, w: b.w + tol * 2, h: b.h + tol * 2 };
  if (!pointInRect(px, py, outer)) return false;

  switch (obj.type) {
    case 'ellipse':
      return pointOnEllipseEdge(px, py, b, tol);
    case 'box': {
      const inner = { x: b.x + tol, y: b.y + tol, w: Math.max(0, b.w - tol * 2), h: Math.max(0, b.h - tol * 2) };
      return !pointInRect(px, py, inner);
    }
    default:
      return true;
  }
}

/** Handle layout for the selection overlay. */
export function handlesOf(obj) {
  if (isSegment(obj)) {
    return [
      { id: 'p1', x: obj.x1, y: obj.y1 },
      { id: 'p2', x: obj.x2, y: obj.y2 },
    ];
  }
  const b = boundsOf(obj);
  const midX = b.x + b.w / 2;
  const midY = b.y + b.h / 2;
  return [
    { id: 'nw', x: b.x, y: b.y },
    { id: 'n', x: midX, y: b.y },
    { id: 'ne', x: b.x + b.w, y: b.y },
    { id: 'e', x: b.x + b.w, y: midY },
    { id: 'se', x: b.x + b.w, y: b.y + b.h },
    { id: 's', x: midX, y: b.y + b.h },
    { id: 'sw', x: b.x, y: b.y + b.h },
    { id: 'w', x: b.x, y: midY },
  ];
}

export const CURSOR_FOR_HANDLE = Object.freeze({
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  p1: 'crosshair', p2: 'crosshair',
});

/** Applies a resize handle drag to a box, keeping a minimum size. */
export function resizeBox(start, handle, dx, dy, { keepRatio = false } = {}) {
  let { x, y, w, h } = start;
  const ratio = start.h === 0 ? 1 : start.w / start.h;

  if (handle.includes('e')) w = start.w + dx;
  if (handle.includes('s')) h = start.h + dy;
  if (handle.includes('w')) { x = start.x + dx; w = start.w - dx; }
  if (handle.includes('n')) { y = start.y + dy; h = start.h - dy; }

  if (keepRatio && handle.length === 2) {
    // Corner drags with Shift preserve the original aspect ratio.
    const targetH = w / ratio;
    if (handle.includes('n')) y += h - targetH;
    h = targetH;
  }

  if (w < MIN_OBJECT_SIZE) {
    if (handle.includes('w')) x -= MIN_OBJECT_SIZE - w;
    w = MIN_OBJECT_SIZE;
  }
  if (h < MIN_OBJECT_SIZE) {
    if (handle.includes('n')) y -= MIN_OBJECT_SIZE - h;
    h = MIN_OBJECT_SIZE;
  }
  return { x, y, w, h };
}

/** Snaps a segment to 0° / 45° / 90° increments (Shift while drawing). */
export function snapAngle(x1, y1, x2, y2, step = Math.PI / 4) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: x2, y: y2 };
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: x1 + Math.cos(angle) * len, y: y1 + Math.sin(angle) * len };
}

/** Fits `size` inside `box` without upscaling beyond `maxScale`. */
export function fitInside(size, box, maxScale = 1) {
  const scale = Math.min(box.w / size.w, box.h / size.h, maxScale);
  return { w: size.w * scale, h: size.h * scale, scale };
}
