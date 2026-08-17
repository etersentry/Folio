import { Emitter } from '../core/emitter.js';
import { renderPageToCanvas } from '../canvas/renderer.js';
import { debounce } from '../core/util.js';

const THUMB_SCALE = 0.115; // ~94 x 121 px

/**
 * Page thumbnails for the outline. Rendering is throttled and incremental:
 * only invalidated pages are redrawn, one per animation frame, so a large
 * document never blocks typing or dragging.
 */
export class ThumbnailService extends Emitter {
  #store;
  #assets;
  #cache = new Map();  // pageId -> dataURL
  #dirty = new Set();
  #running = false;
  #canvas = document.createElement('canvas');

  constructor({ store, assets }) {
    super();
    this.#store = store;
    this.#assets = assets;

    this.schedule = debounce(() => this.#process(), 260);

    store.on('change', ({ live, structural }) => {
      if (live) return;
      if (structural) this.invalidateAll();
      else this.invalidate(store.activePageId);
    });
    assets.on('ready', () => this.invalidateAll());
  }

  get(pageId) {
    return this.#cache.get(pageId) ?? null;
  }

  invalidate(pageId) {
    if (!pageId) return;
    this.#dirty.add(pageId);
    this.schedule();
  }

  invalidateAll() {
    for (const section of this.#store.sections) {
      for (const page of section.pages) this.#dirty.add(page.id);
    }
    this.schedule();
  }

  #findPage(pageId) {
    for (const section of this.#store.sections) {
      const page = section.pages.find((p) => p.id === pageId);
      if (page) return page;
    }
    return null;
  }

  async #process() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#dirty.size) {
        const pageId = this.#dirty.values().next().value;
        this.#dirty.delete(pageId);
        const page = this.#findPage(pageId);
        if (!page) {
          this.#cache.delete(pageId);
          continue;
        }
        renderPageToCanvas(page, { scale: THUMB_SCALE, assets: this.#assets, canvas: this.#canvas });
        this.#cache.set(pageId, this.#canvas.toDataURL('image/jpeg', 0.7));
        this.emit('update', { pageId, dataUrl: this.#cache.get(pageId) });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    } finally {
      this.#running = false;
    }
  }
}
