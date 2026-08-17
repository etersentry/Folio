import {
  ANNOTATION_TYPES, HANDLE_SIZE, MIN_OBJECT_SIZE, OBJECT_TYPES, PAGE,
} from '../core/constants.js';
import {
  boundsOf, handlesOf, hitTest, isSegment, pointInRect, rectsIntersect,
  resizeBox, snapAngle, CURSOR_FOR_HANDLE,
} from '../core/geometry.js';
import { createObject } from '../document/model.js';
import { objectPropsFor, TOOL_BY_ID } from '../tools/registry.js';

const CLICK_SLOP = 4;

/** Shapes drawn as an outline: hit by their edge first, interior as fallback. */
const OUTLINED_TYPES = [OBJECT_TYPES.box, OBJECT_TYPES.ellipse];

/**
 * Translates pointer input into document mutations: selecting, moving,
 * resizing, drawing and erasing directly on the canvas.
 */
export class CanvasInteractions {
  #view; #store; #tools; #textEditor; #canvas;
  #mode = 'idle';
  #drag = null;
  #erasedSomething = false;

  constructor({ view, store, tools, textEditor, canvas }) {
    this.#view = view;
    this.#store = store;
    this.#tools = tools;
    this.#textEditor = textEditor;
    this.#canvas = canvas;

    canvas.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.#cancel());
    canvas.addEventListener('pointerleave', () => {
      if (this.#mode === 'idle') this.#view.setOverlayState({ eraser: null, hoverId: null });
    });
    canvas.addEventListener('dblclick', (e) => this.#onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    tools.on('tool', () => this.#refreshCursor());
    this.#refreshCursor();
  }

  /* ── Hit helpers ───────────────────────────────────────────────────── */

  #objectsTopFirst() {
    const page = this.#store.activePage;
    return page ? [...page.objects].reverse() : [];
  }

  /**
   * Topmost object under the pointer. Outlined shapes are grabbed by their
   * edge so you can still click through them onto the screenshot below; if
   * nothing at all is hit, a second pass accepts the interior of an outlined
   * shape, which is what feels right on an otherwise empty area.
   */
  #objectAt(point) {
    const objects = this.#objectsTopFirst();
    const tolerance = 5 / this.#view.zoom;
    const direct = objects.find((obj) => hitTest(obj, point.x, point.y, tolerance));
    if (direct) return direct;
    return objects.find(
      (obj) => OUTLINED_TYPES.includes(obj.type) && pointInRect(point.x, point.y, boundsOf(obj)),
    ) ?? null;
  }

  #handleAt(point) {
    const selected = this.#store.selectedObjects;
    if (selected.length !== 1) return null;
    const reach = (HANDLE_SIZE / this.#view.zoom) * 0.75;
    return handlesOf(selected[0]).find(
      (h) => Math.abs(point.x - h.x) <= reach && Math.abs(point.y - h.y) <= reach,
    ) ?? null;
  }

  /* ── Pointer down ──────────────────────────────────────────────────── */

  #onPointerDown(event) {
    if (event.button !== 0) return;
    this.#canvas.setPointerCapture(event.pointerId);
    if (this.#textEditor.isOpen) this.#textEditor.commit();

    const point = this.#view.toPagePoint(event.clientX, event.clientY);
    const tool = this.#tools.tool;

    if (tool === 'eraser') return this.#startErase(point);
    if (tool === 'select') return this.#startSelect(point, event);
    this.#startCreate(tool, point, event);
  }

  #startSelect(point, event) {
    const handle = this.#handleAt(point);
    if (handle) {
      const obj = this.#store.selectedObjects[0];
      this.#mode = 'resize';
      this.#store.beginLive('object:resize');
      this.#drag = {
        origin: point,
        handle: handle.id,
        objectId: obj.id,
        start: isSegment(obj)
          ? { x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2 }
          : boundsOf(obj),
      };
      return;
    }

    const hit = this.#objectAt(point);
    if (!hit) {
      if (!event.shiftKey) this.#store.clearSelection();
      this.#mode = 'marquee';
      this.#drag = { origin: point, additive: event.shiftKey };
      return;
    }

    if (event.shiftKey) {
      this.#store.select([hit.id], { additive: true });
      this.#mode = 'idle';
      return;
    }
    if (!this.#store.isSelected(hit.id)) this.#store.select([hit.id]);

    this.#mode = 'move';
    this.#store.beginLive('object:move');
    this.#drag = {
      origin: point,
      moved: false,
      starts: new Map(this.#store.selectedObjects.map((o) => [
        o.id,
        isSegment(o) ? { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 } : { x: o.x, y: o.y },
      ])),
    };
  }

  #startCreate(toolId, point, event) {
    const def = TOOL_BY_ID[toolId];
    if (!def?.objectType) return;
    const style = this.#tools.style;
    const geometry = isSegment({ type: def.objectType })
      ? { x1: point.x, y1: point.y, x2: point.x, y2: point.y }
      : def.objectType === OBJECT_TYPES.marker
        ? { x: point.x, y: point.y - style.markerHeight / 2, w: 0, h: style.markerHeight }
        : { x: point.x, y: point.y, w: 0, h: 0 };

    const object = createObject(def.objectType, objectPropsFor(toolId, style, geometry));
    this.#store.beginLive('object:create');
    this.#store.addObjectLive(object);
    this.#store.select([object.id]);
    this.#mode = 'create';
    this.#drag = { origin: point, objectId: object.id, toolId, shift: event.shiftKey };
    this.#store.live();
  }

  #startErase(point) {
    this.#mode = 'erase';
    this.#erasedSomething = false;
    this.#store.beginLive('object:erase');
    this.#eraseAt(point);
  }

  /* ── Pointer move ──────────────────────────────────────────────────── */

  #onPointerMove(event) {
    const point = this.#view.toPagePoint(event.clientX, event.clientY);

    if (this.#tools.tool === 'eraser') {
      this.#view.setOverlayState({ eraser: { x: point.x, y: point.y, r: this.#tools.style.eraserSize } });
    }

    switch (this.#mode) {
      case 'idle':
        this.#hover(point);
        return;
      case 'create':
        this.#updateCreate(point, event);
        return;
      case 'move':
        this.#updateMove(point, event);
        return;
      case 'resize':
        this.#updateResize(point, event);
        return;
      case 'marquee': {
        const o = this.#drag.origin;
        this.#view.setOverlayState({
          marquee: {
            x: Math.min(o.x, point.x), y: Math.min(o.y, point.y),
            w: Math.abs(point.x - o.x), h: Math.abs(point.y - o.y),
          },
        });
        return;
      }
      case 'erase':
        this.#eraseAt(point);
        return;
      default:
    }
  }

  #hover(point) {
    if (this.#tools.tool !== 'select') return;
    const handle = this.#handleAt(point);
    if (handle) {
      this.#view.setCursor(CURSOR_FOR_HANDLE[handle.id] ?? 'default');
      this.#view.setOverlayState({ hoverId: null });
      return;
    }
    const hit = this.#objectAt(point);
    this.#view.setCursor(hit ? 'move' : 'default');
    this.#view.setOverlayState({ hoverId: hit?.id ?? null });
  }

  #updateCreate(point, event) {
    const { origin, objectId, toolId } = this.#drag;
    const obj = this.#store.activePage?.objects.find((o) => o.id === objectId);
    if (!obj) return;

    if (isSegment(obj)) {
      const end = event.shiftKey
        ? snapAngle(origin.x, origin.y, point.x, point.y)
        : { x: point.x, y: point.y };
      obj.x2 = end.x;
      obj.y2 = end.y;
    } else if (toolId === 'marker') {
      obj.x = Math.min(origin.x, point.x);
      obj.w = Math.abs(point.x - origin.x);
      obj.y = origin.y - obj.h / 2;
    } else {
      let w = point.x - origin.x;
      let h = point.y - origin.y;
      if (event.shiftKey) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      obj.x = Math.min(origin.x, origin.x + w);
      obj.y = Math.min(origin.y, origin.y + h);
      obj.w = Math.abs(w);
      obj.h = Math.abs(h);
    }
    this.#store.live();
  }

  #updateMove(point, event) {
    let dx = point.x - this.#drag.origin.x;
    let dy = point.y - this.#drag.origin.y;
    if (event.shiftKey) {
      // Constrain to the dominant axis for tidy alignment.
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    if (!this.#drag.moved && Math.hypot(dx, dy) > CLICK_SLOP / this.#view.zoom) this.#drag.moved = true;
    if (!this.#drag.moved) return;

    const starts = this.#drag.starts;
    this.#store.updateObjects([...starts.keys()], (obj) => {
      const start = starts.get(obj.id);
      if (!start) return null;
      return isSegment(obj)
        ? { x1: start.x1 + dx, y1: start.y1 + dy, x2: start.x2 + dx, y2: start.y2 + dy }
        : { x: start.x + dx, y: start.y + dy };
    }, { reason: 'object:move', live: true });
  }

  #updateResize(point, event) {
    const { handle, start, objectId, origin } = this.#drag;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const obj = this.#store.activePage?.objects.find((o) => o.id === objectId);
    if (!obj) return;

    if (isSegment(obj)) {
      const anchor = handle === 'p1' ? { x: start.x2, y: start.y2 } : { x: start.x1, y: start.y1 };
      const moving = handle === 'p1'
        ? { x: start.x1 + dx, y: start.y1 + dy }
        : { x: start.x2 + dx, y: start.y2 + dy };
      const end = event.shiftKey ? snapAngle(anchor.x, anchor.y, moving.x, moving.y) : moving;
      this.#store.updateObjects([objectId], handle === 'p1'
        ? { x1: end.x, y1: end.y }
        : { x2: end.x, y2: end.y }, { reason: 'object:resize', live: true });
      return;
    }

    // Images keep their aspect ratio on corner handles unless Alt is held.
    const keepRatio = obj.type === OBJECT_TYPES.image ? !event.altKey : event.shiftKey;
    const next = resizeBox(start, handle, dx, dy, { keepRatio });
    this.#store.updateObjects([objectId], next, { reason: 'object:resize', live: true });
  }

  #eraseAt(point) {
    const page = this.#store.activePage;
    if (!page) return;
    const radius = this.#tools.style.eraserSize;
    const doomed = page.objects.filter(
      (obj) => ANNOTATION_TYPES.includes(obj.type) && hitTest(obj, point.x, point.y, radius),
    );
    if (!doomed.length) return;
    const ids = new Set(doomed.map((o) => o.id));
    page.objects = page.objects.filter((o) => !ids.has(o.id));
    this.#erasedSomething = true;
    this.#store.live('object:erase');
  }

  /* ── Pointer up ────────────────────────────────────────────────────── */

  #onPointerUp(event) {
    const point = this.#view.toPagePoint(event.clientX, event.clientY);
    const mode = this.#mode;
    const drag = this.#drag;
    this.#mode = 'idle';
    this.#drag = null;

    switch (mode) {
      case 'create':
        this.#finishCreate(drag, point);
        break;
      case 'move':
        this.#store.endLive({ changed: Boolean(drag?.moved) });
        break;
      case 'resize':
        this.#store.endLive({ changed: true });
        break;
      case 'erase':
        this.#store.endLive({ changed: this.#erasedSomething });
        break;
      case 'marquee': {
        this.#view.setOverlayState({ marquee: null });
        const o = drag.origin;
        const rect = {
          x: Math.min(o.x, point.x), y: Math.min(o.y, point.y),
          w: Math.abs(point.x - o.x), h: Math.abs(point.y - o.y),
        };
        if (rect.w > 2 && rect.h > 2) {
          const inside = (this.#store.activePage?.objects ?? [])
            .filter((obj) => rectsIntersect(boundsOf(obj), rect))
            .map((obj) => obj.id);
          if (inside.length) this.#store.select(inside, { additive: drag.additive });
        }
        break;
      }
      default:
        break;
    }
    this.#refreshCursor();
  }

  /** Gives click-without-drag a sensible default size, then commits. */
  #finishCreate(drag, point) {
    const obj = this.#store.activePage?.objects.find((o) => o.id === drag.objectId);
    if (!obj) { this.#store.endLive({ changed: false }); return; }

    const tiny = Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < CLICK_SLOP;
    if (tiny) {
      if (isSegment(obj)) {
        obj.x2 = obj.x1 + 120;
        obj.y2 = obj.y1;
      } else if (obj.type === OBJECT_TYPES.marker) {
        obj.x = drag.origin.x - 80;
        obj.w = 160;
      } else if (obj.type === OBJECT_TYPES.text) {
        obj.w = 240;
        obj.h = obj.fontSize * 1.34 + 12;
      } else {
        obj.w = obj.type === OBJECT_TYPES.ellipse ? 120 : 160;
        obj.h = obj.type === OBJECT_TYPES.ellipse ? 90 : 100;
        obj.x = drag.origin.x - obj.w / 2;
        obj.y = drag.origin.y - obj.h / 2;
      }
    }

    if (!isSegment(obj)) {
      obj.w = Math.max(obj.w, MIN_OBJECT_SIZE);
      obj.h = Math.max(obj.h, obj.type === OBJECT_TYPES.text ? obj.fontSize * 1.34 + 12 : MIN_OBJECT_SIZE);
      // Keep new objects reachable: never let them start fully off-page.
      obj.x = Math.min(Math.max(obj.x, -obj.w + 20), PAGE.width - 20);
      obj.y = Math.min(Math.max(obj.y, -obj.h + 20), PAGE.height - 20);
    }

    if (obj.type === OBJECT_TYPES.text) {
      // The live transaction stays open until the editor commits, so creating
      // and typing a text box collapse into a single undo step.
      this.#store.live();
      this.#textEditor.open(obj.id, { createdNow: true });
    } else {
      this.#store.endLive({ changed: true });
    }
  }

  #onDoubleClick(event) {
    const point = this.#view.toPagePoint(event.clientX, event.clientY);
    const hit = this.#objectAt(point);
    if (hit?.type === OBJECT_TYPES.text) {
      this.#store.select([hit.id]);
      this.#textEditor.open(hit.id, { selectAll: true });
    }
  }

  #cancel() {
    if (this.#mode === 'marquee') this.#view.setOverlayState({ marquee: null });
    else if (this.#mode !== 'idle') this.#store.endLive({ changed: false });
    this.#mode = 'idle';
    this.#drag = null;
  }

  #refreshCursor() {
    const tool = TOOL_BY_ID[this.#tools.tool];
    this.#view.setCursor(tool?.cursor ?? 'default');
    if (this.#tools.tool !== 'eraser') this.#view.setOverlayState({ eraser: null });
    if (this.#tools.tool !== 'select') this.#view.setOverlayState({ hoverId: null });
  }
}
