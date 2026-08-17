import { Emitter } from '../core/emitter.js';
import { clamp, rafThrottle } from '../core/util.js';
import { PAGE, ZOOM_STEPS, HANDLE_SIZE } from '../core/constants.js';
import { boundsOf, handlesOf, isSegment } from '../core/geometry.js';
import { renderPage } from './renderer.js';

/** Upper bound for the backing store so deep zoom cannot exhaust memory. */
const MAX_RENDER_SCALE = 3;

/**
 * Selection chrome uses a precise blue on purpose: it must never be confused
 * with a copper annotation, and it stays legible over any screenshot.
 */
const MARQUEE = '#2f6df0';
const MARQUEE_SOFT = 'rgba(47,109,240,0.5)';
const MARQUEE_FILL = 'rgba(47,109,240,0.10)';

/**
 * Owns the two stacked canvases: the page (content) and the overlay
 * (selection, handles, marquee, eraser cursor), plus the viewport transform.
 */
export class PageView extends Emitter {
  #store; #assets;
  #shell; #pageCanvas; #overlayCanvas; #stage;
  #ctx; #octx;
  #zoom = 1;
  #fitMode = true;
  #overlay = { marquee: null, eraser: null, hoverId: null };
  #editingIds = new Set();
  #renderScale = 1;
  #resizeObserver = null;
  #fitQueued = false;

  constructor({ store, assets, stage, shell, pageCanvas, overlayCanvas }) {
    super();
    this.#store = store;
    this.#assets = assets;
    this.#stage = stage;
    this.#shell = shell;
    this.#pageCanvas = pageCanvas;
    this.#overlayCanvas = overlayCanvas;
    this.#ctx = pageCanvas.getContext('2d', { alpha: false });
    this.#octx = overlayCanvas.getContext('2d');

    this.renderPage = rafThrottle(() => this.#paintPage());
    this.renderOverlay = rafThrottle(() => this.#paintOverlay());

    store.on('change', () => this.renderPage());
    store.on('page', () => { this.renderPage(); this.renderOverlay(); });
    store.on('selection', () => this.renderOverlay());
    assets.on('ready', () => this.renderPage());

    // Re-fitting inside the observer callback would reflow synchronously and
    // trip the "ResizeObserver loop" warning, so defer to the next frame.
    this.#resizeObserver = new ResizeObserver(() => {
      if (!this.#fitMode || this.#fitQueued) return;
      this.#fitQueued = true;
      requestAnimationFrame(() => {
        this.#fitQueued = false;
        if (this.#fitMode) this.zoomToFit();
      });
    });
    this.#resizeObserver.observe(stage);

    this.#applyZoom();
  }

  /* ── Viewport ──────────────────────────────────────────────────────── */

  get zoom() { return this.#zoom; }
  get isFitMode() { return this.#fitMode; }

  setZoom(zoom, { fit = false } = {}) {
    const next = clamp(zoom, 0.1, 5);
    this.#fitMode = fit;
    if (Math.abs(next - this.#zoom) < 0.0005) {
      this.emit('zoom', { zoom: this.#zoom, fit });
      return;
    }
    this.#zoom = next;
    this.#applyZoom();
    this.emit('zoom', { zoom: this.#zoom, fit });
  }

  zoomToFit() {
    // Measure the real content box: the stage padding is part of the layout
    // (it leaves room for the instrument tray) and changes with the theme.
    const style = getComputedStyle(this.#stage);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableW = this.#stage.clientWidth - padX;
    const availableH = this.#stage.clientHeight - padY;
    if (availableH <= 0 || availableW <= 0) return;
    const zoom = Math.min(availableW / PAGE.width, availableH / PAGE.height);
    this.setZoom(clamp(zoom, 0.1, 2), { fit: true });
  }

  zoomStep(direction) {
    const current = this.#zoom;
    const steps = ZOOM_STEPS;
    const next = direction > 0
      ? steps.find((s) => s > current + 0.001) ?? steps.at(-1)
      : [...steps].reverse().find((s) => s < current - 0.001) ?? steps[0];
    this.setZoom(next);
  }

  #applyZoom() {
    const cssW = Math.round(PAGE.width * this.#zoom);
    const cssH = Math.round(PAGE.height * this.#zoom);
    this.#shell.style.width = `${cssW}px`;
    this.#shell.style.height = `${cssH}px`;

    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(this.#zoom * dpr, MAX_RENDER_SCALE);
    for (const canvas of [this.#pageCanvas, this.#overlayCanvas]) {
      canvas.width = Math.max(1, Math.round(PAGE.width * scale));
      canvas.height = Math.max(1, Math.round(PAGE.height * scale));
    }
    this.#renderScale = scale;
    // Resizing a canvas clears it: repaint synchronously so a zoom change can
    // never expose an empty backing store.
    this.#paintPage();
    this.#paintOverlay();
  }

  /** Client (mouse) coordinates → document coordinates. */
  toPagePoint(clientX, clientY) {
    const rect = this.#overlayCanvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.#zoom,
      y: (clientY - rect.top) / this.#zoom,
    };
  }

  /** Document rectangle → client coordinates (used to anchor floating UI). */
  toScreenRect(bounds) {
    const rect = this.#overlayCanvas.getBoundingClientRect();
    return {
      x: rect.left + bounds.x * this.#zoom,
      y: rect.top + bounds.y * this.#zoom,
      w: bounds.w * this.#zoom,
      h: bounds.h * this.#zoom,
    };
  }

  setCursor(cursor) {
    this.#overlayCanvas.style.cursor = cursor;
  }

  /* ── Painting ──────────────────────────────────────────────────────── */

  setEditing(ids) {
    this.#editingIds = new Set(ids);
    this.renderPage();
    this.renderOverlay();
  }

  setOverlayState(patch) {
    Object.assign(this.#overlay, patch);
    this.renderOverlay();
  }

  #paintPage() {
    const ctx = this.#ctx;
    const scale = this.#renderScale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderPage(ctx, this.#store.activePage, {
      assets: this.#assets,
      skipTextIds: this.#editingIds,
      placeholders: true,
    });
    this.emit('painted', {});
  }

  #paintOverlay() {
    const ctx = this.#octx;
    const scale = this.#renderScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#overlayCanvas.width, this.#overlayCanvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const zoom = this.#zoom;
    const px = 1 / zoom; // one screen pixel in document units
    const selected = this.#store.selectedObjects;

    if (this.#overlay.hoverId) {
      const obj = this.#store.activePage?.objects.find((o) => o.id === this.#overlay.hoverId);
      if (obj && !this.#store.isSelected(obj.id)) {
        const b = boundsOf(obj);
        ctx.save();
        ctx.strokeStyle = MARQUEE_SOFT;
        ctx.lineWidth = px;
        ctx.strokeRect(b.x - px, b.y - px, b.w + px * 2, b.h + px * 2);
        ctx.restore();
      }
    }

    for (const obj of selected) {
      const b = boundsOf(obj);
      ctx.save();
      ctx.strokeStyle = MARQUEE;
      ctx.lineWidth = px * 1.4;
      ctx.setLineDash([5 * px, 4 * px]);
      if (isSegment(obj)) {
        ctx.beginPath();
        ctx.moveTo(obj.x1, obj.y1);
        ctx.lineTo(obj.x2, obj.y2);
        ctx.stroke();
      } else {
        ctx.strokeRect(b.x - px, b.y - px, b.w + px * 2, b.h + px * 2);
      }
      ctx.restore();
    }

    if (selected.length === 1) {
      const size = HANDLE_SIZE / zoom;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = MARQUEE;
      ctx.lineWidth = px * 1.4;
      for (const handle of handlesOf(selected[0])) {
        ctx.beginPath();
        ctx.rect(handle.x - size / 2, handle.y - size / 2, size, size);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.#overlay.marquee) {
      const m = this.#overlay.marquee;
      ctx.save();
      ctx.fillStyle = MARQUEE_FILL;
      ctx.strokeStyle = MARQUEE;
      ctx.lineWidth = px;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.restore();
    }

    if (this.#overlay.eraser) {
      const { x, y, r } = this.#overlay.eraser;
      ctx.save();
      ctx.strokeStyle = '#ff3b30';
      ctx.fillStyle = 'rgba(255,59,48,0.10)';
      ctx.lineWidth = px * 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  destroy() {
    this.#resizeObserver.disconnect();
  }
}
