import { Emitter } from '../core/emitter.js';
import { metaGet, metaSet } from '../storage/db.js';

const STORAGE_KEY = 'folio.preferences.v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'auto',            // auto | light | dark
  accent: '#c66a32',        // cobre quemado
  background: 'gradient',   // plain | gradient | dots | grid
  transparency: true,       // textura y sombras de la mesa de trabajo
  inspector: true,          // inspector visible
  toolStyle: null,          // last used annotation appearance
});

/** Acentos de versiones anteriores que se reemplazan por el cobre de Folio. */
const LEGACY_ACCENTS = new Set(['#4f7cff', '#7c5cff', '#12a594', '#2e9e5b', '#d98324', '#e0455c']);

/**
 * User preferences: theme, accent, workspace background, transparency and the
 * last annotation appearance. Stored in localStorage for instant boot and
 * mirrored into IndexedDB so a cleared localStorage does not lose them.
 */
export class Preferences extends Emitter {
  #values = { ...DEFAULT_PREFERENCES };

  get values() { return this.#values; }

  /** Synchronous first pass so the UI never flashes the wrong theme. */
  loadSync() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.#values = { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
      if (LEGACY_ACCENTS.has(String(this.#values.accent).toLowerCase())) {
        this.#values.accent = DEFAULT_PREFERENCES.accent;
      }
    } catch {
      /* corrupted or unavailable storage — defaults are fine */
    }
    this.apply();
    return this.#values;
  }

  /** Second pass from IndexedDB, used when localStorage was wiped. */
  async loadAsync() {
    try {
      const stored = await metaGet('preferences');
      if (stored && !localStorage.getItem(STORAGE_KEY)) {
        this.#values = { ...DEFAULT_PREFERENCES, ...stored };
        this.apply();
        this.emit('change', { values: this.#values });
      }
    } catch {
      /* preferences are non-critical */
    }
    return this.#values;
  }

  set(patch, { silent = false } = {}) {
    this.#values = { ...this.#values, ...patch };
    this.apply();
    this.#persist();
    if (!silent) this.emit('change', { values: this.#values, patch });
  }

  #persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#values));
    } catch {
      /* private mode: IndexedDB mirror below still applies */
    }
    metaSet('preferences', this.#values).catch(() => {});
  }

  /** Reflects preferences onto the document root and body. */
  apply() {
    const root = document.documentElement;
    const { theme, accent, background, transparency, inspector } = this.#values;
    root.dataset.theme = theme === 'auto' ? 'auto' : theme;
    root.dataset.bg = background;
    root.dataset.transparency = transparency ? 'on' : 'off';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', pickReadableInk(accent));
    if (document.body) document.body.dataset.inspector = inspector ? 'on' : 'off';
  }
}

/** Black or white text over the accent, whichever keeps contrast usable. */
function pickReadableInk(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? '#10131a' : '#ffffff';
}
