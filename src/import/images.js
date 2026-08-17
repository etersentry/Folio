import { PAGE, OBJECT_TYPES } from '../core/constants.js';
import { clamp } from '../core/util.js';
import { createAsset, createObject, contentBox, findPage } from '../document/model.js';

const MAX_PIXELS = 40_000_000; // guard against absurd source images

/** Reads intrinsic pixel dimensions without keeping the bitmap around. */
async function readImageSize(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      /* fall back to <img> below (e.g. unsupported type in this engine) */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('El archivo no es una imagen válida'));
    };
    img.src = url;
  });
}

/**
 * Brings screenshots into the document: from the clipboard, a file picker or
 * a drop. Several images are stacked top-to-bottom with consistent margins,
 * overflowing onto new pages, and always leaving the right gutter free for
 * annotations.
 */
export class ImageImporter {
  #store; #assets;

  constructor({ store, assets }) {
    this.#store = store;
    this.#assets = assets;
  }

  /** Extracts image blobs from a paste event (returns [] when there are none). */
  static blobsFromClipboard(event) {
    const items = [...(event.clipboardData?.items ?? [])];
    return items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  static isImageFile(file) {
    return Boolean(file) && (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name ?? ''));
  }

  /**
   * @param {File[]|Blob[]} files
   * @param {{point?: {x:number,y:number}}} options  drop position, when known
   * @returns {Promise<{inserted:number, pagesAdded:number, skipped:string[]}>}
   */
  async import(files, { point = null } = {}) {
    const list = [...files].filter((f) => ImageImporter.isImageFile(f));
    const skipped = [];
    const prepared = [];

    for (const file of list) {
      try {
        const size = await readImageSize(file);
        if (size.width * size.height > MAX_PIXELS) {
          skipped.push(`${file.name || 'imagen'} (demasiado grande)`);
          continue;
        }
        prepared.push({ file, size });
      } catch (err) {
        skipped.push(file.name || 'imagen');
        console.warn('[folio] no se pudo leer una imagen', err);
      }
    }

    if (!prepared.length) return { inserted: 0, pagesAdded: 0, skipped };

    const assets = prepared.map(({ file, size }) => this.#store.addAsset(createAsset({
      blob: file,
      mime: file.type || 'image/png',
      width: size.width,
      height: size.height,
      name: file.name || 'captura',
    })));

    const result = prepared.length === 1 && point
      ? this.#placeAtPoint(assets[0], point)
      : this.#placeStacked(assets);

    await this.#assets.loadAll(assets.map((a) => a.id));
    return { ...result, skipped };
  }

  /* ── Placement ─────────────────────────────────────────────────────── */

  #placeAtPoint(asset, point) {
    const box = contentBox();
    const scale = Math.min(box.w / asset.width, box.h / asset.height, 1);
    const w = asset.width * scale;
    const h = asset.height * scale;
    const x = clamp(point.x - w / 2, 0, Math.max(0, PAGE.width - w));
    const y = clamp(point.y - h / 2, 0, Math.max(0, PAGE.height - h));

    const object = createObject(OBJECT_TYPES.image, {
      assetId: asset.id, x, y, w, h,
      naturalWidth: asset.width, naturalHeight: asset.height,
    });
    this.#store.addObjects([object], { reason: 'image:insert' });
    return { inserted: 1, pagesAdded: 0 };
  }

  #placeStacked(assets) {
    const box = contentBox();
    const store = this.#store;
    let pagesAdded = 0;

    const outcome = store.transact('image:insert', () => {
      let pageId = store.activePageId;
      let cursorY = this.#stackStart(pageId, box);
      const inserted = [];

      for (const asset of assets) {
        const scale = Math.min(box.w / asset.width, 1);
        let w = asset.width * scale;
        let h = asset.height * scale;

        // A single image taller than the page is scaled to the full height.
        if (h > box.h) {
          const fit = box.h / h;
          w *= fit;
          h *= fit;
        }
        if (cursorY + h > box.y + box.h) {
          const section = findPage(store.doc, pageId)?.section ?? store.doc.sections[0];
          const page = store.rawAddPage(section.id, { afterPageId: pageId });
          if (!page) break;
          pagesAdded += 1;
          pageId = page.id;
          cursorY = box.y;
        }

        const object = createObject(OBJECT_TYPES.image, {
          assetId: asset.id,
          x: box.x, y: cursorY, w, h,
          naturalWidth: asset.width, naturalHeight: asset.height,
        });
        store.rawAddObjects(pageId, object);
        inserted.push({ pageId, id: object.id });
        cursorY += h + PAGE.imageGap;
      }

      if (!inserted.length) return false;
      const last = inserted.at(-1);
      store.rawSetActivePage(last.pageId);
      store.rawSelect(inserted.filter((i) => i.pageId === last.pageId).map((i) => i.id));
      return inserted;
    }, { structural: true });

    return { inserted: outcome ? outcome.length : 0, pagesAdded };
  }

  /** Next free Y on a page: below whatever is already placed there. */
  #stackStart(pageId, box) {
    const page = findPage(this.#store.doc, pageId)?.page;
    if (!page || !page.objects.length) return box.y;
    const bottom = page.objects.reduce((max, obj) => {
      if (obj.type !== OBJECT_TYPES.image) return max;
      return Math.max(max, obj.y + obj.h);
    }, -Infinity);
    if (bottom === -Infinity) return box.y;
    return Math.min(bottom + PAGE.imageGap, box.y + box.h);
  }
}
