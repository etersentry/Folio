/** Small shared helpers with no dependencies on app state. */

let counter = 0;

/** Short, collision-resistant id (enough for a local document). */
export function uid(prefix = 'o') {
  counter = (counter + 1) % 0xffff;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const round = (v, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Structured deep clone with a graceful fallback for older engines. */
export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through — some values (functions, DOM nodes) are not cloneable */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = (...args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...args);
    }
  };
  return wrapped;
}

/** Runs `fn` on the next animation frame, collapsing repeated calls. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** "Documento 3.pdf" → safe file name without extension. */
export function sanitizeFileName(name, fallback = 'documento') {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  // Keep the anchor alive for a tick: removing it in the same task as other
  // DOM work (closing a dialog) can make the browser drop the file name.
  setTimeout(() => a.remove(), 0);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
