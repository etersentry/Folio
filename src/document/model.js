import { uid } from '../core/util.js';
import { OBJECT_TYPES, PAGE } from '../core/constants.js';

/**
 * Document shape (the single source of truth for everything that is saved):
 *
 *   doc
 *    ├─ id, name, createdAt, updatedAt
 *    ├─ sections: [{ id, name, collapsed, pages: [Page] }]
 *    └─ assets:   { [assetId]: { id, mime, width, height, name, blob } }
 *
 *   Page  = { id, name, objects: [Obj] }   // objects are painted back-to-front
 */

export function createPage(name = 'Página') {
  return { id: uid('pg'), name, objects: [] };
}

export function createSection(name = 'Sección', { withPage = true } = {}) {
  return {
    id: uid('sc'),
    name,
    collapsed: false,
    pages: withPage ? [createPage()] : [],
  };
}

export function createDocument(name = 'Proyecto sin título') {
  const now = Date.now();
  return {
    id: uid('doc'),
    name,
    createdAt: now,
    updatedAt: now,
    sections: [createSection('Sección 1')],
    assets: {},
  };
}

/** Per-type geometry/style defaults; `style` overrides come from the tool. */
const FACTORIES = {
  [OBJECT_TYPES.image]: (p) => ({
    assetId: p.assetId,
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 200, h: p.h ?? 200,
    naturalWidth: p.naturalWidth ?? p.w ?? 200,
    naturalHeight: p.naturalHeight ?? p.h ?? 200,
    frame: p.frame ?? { on: false, width: 2, color: '#3a3a3c' },
  }),
  [OBJECT_TYPES.box]: (p) => ({
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 120, h: p.h ?? 80,
    stroke: p.stroke ?? '#ff3b30',
    strokeWidth: p.strokeWidth ?? 3,
    radius: p.radius ?? 2,
  }),
  [OBJECT_TYPES.marker]: (p) => ({
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 160, h: p.h ?? 18,
    fill: p.fill ?? '#ffcc00',
    opacity: p.opacity ?? 0.42,
  }),
  [OBJECT_TYPES.highlight]: (p) => ({
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 140, h: p.h ?? 90,
    fill: p.fill ?? '#ffcc00',
    opacity: p.opacity ?? 0.3,
  }),
  [OBJECT_TYPES.arrow]: (p) => ({
    x1: p.x1 ?? 0, y1: p.y1 ?? 0, x2: p.x2 ?? 100, y2: p.y2 ?? 60,
    stroke: p.stroke ?? '#ff3b30',
    strokeWidth: p.strokeWidth ?? 3,
  }),
  [OBJECT_TYPES.line]: (p) => ({
    x1: p.x1 ?? 0, y1: p.y1 ?? 0, x2: p.x2 ?? 100, y2: p.y2 ?? 60,
    stroke: p.stroke ?? '#ff3b30',
    strokeWidth: p.strokeWidth ?? 3,
  }),
  [OBJECT_TYPES.ellipse]: (p) => ({
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 120, h: p.h ?? 90,
    stroke: p.stroke ?? '#ff3b30',
    strokeWidth: p.strokeWidth ?? 3,
  }),
  [OBJECT_TYPES.text]: (p) => ({
    x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 220, h: p.h ?? 48,
    text: p.text ?? '',
    color: p.color ?? '#16191f',
    fontSize: p.fontSize ?? 16,
    align: p.align ?? 'left',
    bold: p.bold ?? false,
    border: p.border ?? { on: false, width: 1.5, color: '#3a3a3c' },
    background: p.background ?? { on: false, color: '#ffffff', opacity: 0.9 },
  }),
};

export function createObject(type, props = {}) {
  const factory = FACTORIES[type];
  if (!factory) throw new Error(`Tipo de objeto desconocido: ${type}`);
  return { id: uid('ob'), type, ...factory(props) };
}

export function createAsset({ blob, mime, width, height, name }) {
  return { id: uid('as'), blob, mime, width, height, name: name ?? 'imagen' };
}

/* ── Traversal helpers ─────────────────────────────────────────────────── */

export function* iterPages(doc) {
  for (const section of doc.sections) {
    for (const page of section.pages) yield { section, page };
  }
}

export function allPages(doc) {
  return [...iterPages(doc)].map((entry) => entry.page);
}

export function findPage(doc, pageId) {
  for (const { section, page } of iterPages(doc)) {
    if (page.id === pageId) return { section, page };
  }
  return null;
}

export function findSection(doc, sectionId) {
  return doc.sections.find((s) => s.id === sectionId) ?? null;
}

export function pageNumber(doc, pageId) {
  let n = 0;
  for (const { page } of iterPages(doc)) {
    n += 1;
    if (page.id === pageId) return n;
  }
  return 0;
}

export function pageCount(doc) {
  return doc.sections.reduce((sum, s) => sum + s.pages.length, 0);
}

export const isPageEmpty = (page) => page.objects.length === 0;

/** Asset ids actually referenced by the document (used to prune on save). */
export function usedAssetIds(doc) {
  const ids = new Set();
  for (const { page } of iterPages(doc)) {
    for (const obj of page.objects) if (obj.assetId) ids.add(obj.assetId);
  }
  return ids;
}

/** Content area available for auto-placed images (leaves a right gutter). */
export function contentBox() {
  const width = PAGE.width - PAGE.margin * 2;
  return {
    x: PAGE.margin,
    y: PAGE.margin,
    w: width * (1 - PAGE.annotationGutter),
    h: PAGE.height - PAGE.margin * 2,
    fullWidth: width,
  };
}
