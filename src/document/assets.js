import { Emitter } from '../core/emitter.js';

/**
 * Keeps decoded bitmaps for the document's image assets. The renderer asks for
 * an image synchronously; if it is not decoded yet the library kicks off the
 * decode and emits `ready`, which triggers a repaint.
 */
export class AssetLibrary extends Emitter {
  #store;
  #entries = new Map(); // assetId -> { url, image, loading, failed }

  constructor(store) {
    super();
    this.#store = store;
    store.on('change', ({ reason }) => {
      if (reason === 'load') this.reset();
    });
  }

  /** Decoded image or `null` while it is still loading. */
  get(assetId) {
    const entry = this.#entries.get(assetId);
    if (entry?.image) return entry.image;
    if (!entry) this.load(assetId);
    return null;
  }

  has(assetId) { return Boolean(this.#entries.get(assetId)?.image); }

  load(assetId) {
    const existing = this.#entries.get(assetId);
    if (existing?.image) return Promise.resolve(existing.image);
    if (existing?.loading) return existing.loading;

    const asset = this.#store.getAsset(assetId);
    if (!asset?.blob) return Promise.resolve(null);

    const url = URL.createObjectURL(asset.blob);
    const image = new Image();
    image.decoding = 'async';

    const loading = new Promise((resolve) => {
      image.onload = () => {
        const entry = this.#entries.get(assetId);
        if (entry) { entry.image = image; entry.loading = null; }
        this.emit('ready', { assetId, image });
        resolve(image);
      };
      image.onerror = () => {
        const entry = this.#entries.get(assetId);
        if (entry) { entry.failed = true; entry.loading = null; }
        this.emit('error', { assetId });
        resolve(null);
      };
      image.src = url;
    });

    this.#entries.set(assetId, { url, image: null, loading, failed: false });
    return loading;
  }

  /** Waits until every requested asset is decoded (used before exporting). */
  async loadAll(assetIds) {
    await Promise.all([...new Set(assetIds)].map((id) => this.load(id)));
  }

  reset() {
    for (const entry of this.#entries.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.#entries.clear();
  }
}
