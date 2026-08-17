import { Emitter } from '../core/emitter.js';
import { boundsOf } from '../core/geometry.js';
import { measureText, fontFor, TEXT_PADDING, TEXT_LINE_HEIGHT } from './shapes.js';

/**
 * DOM overlay used to edit a text object in place. It mirrors the canvas
 * typography exactly (font, padding, line height) so what is typed is what is
 * painted, and grows the box vertically as the text wraps.
 */
export class TextEditor extends Emitter {
  #textarea; #view; #store;
  #objectId = null;
  #measureCtx = document.createElement('canvas').getContext('2d');
  #createdNow = false;

  constructor({ textarea, view, store }) {
    super();
    this.#textarea = textarea;
    this.#view = view;
    this.#store = store;

    textarea.addEventListener('input', () => this.#onInput());
    textarea.addEventListener('blur', () => this.commit());
    textarea.addEventListener('keydown', (event) => {
      event.stopPropagation(); // typing must not trigger tool shortcuts
      if (event.key === 'Escape') {
        event.preventDefault();
        this.commit();
        this.emit('escape', {});
      }
    });
    view.on('zoom', () => this.#position());
    // Navigating away must not leave an orphaned editor (or an open transaction).
    store.on('beforePage', () => this.commit());
  }

  get isOpen() { return this.#objectId !== null; }
  get objectId() { return this.#objectId; }

  open(objectId, { createdNow = false, selectAll = false } = {}) {
    if (this.#objectId && this.#objectId !== objectId) this.commit();
    const obj = this.#find(objectId);
    if (!obj) return;

    this.#objectId = objectId;
    this.#createdNow = createdNow;
    this.#textarea.value = obj.text ?? '';
    this.#textarea.hidden = false;
    this.#view.setEditing([objectId]);
    this.#position();
    this.#textarea.focus({ preventScroll: true });
    if (selectAll) this.#textarea.select();
    else this.#textarea.setSelectionRange(this.#textarea.value.length, this.#textarea.value.length);
    this.emit('open', { objectId });
  }

  /**
   * Writes the text back. A box created moments ago is still inside the live
   * transaction opened when it was drawn, so creating + typing collapses into
   * a single undo step (and an abandoned box disappears entirely).
   */
  commit() {
    const objectId = this.#objectId;
    if (!objectId) return;
    const createdNow = this.#createdNow;
    const obj = this.#find(objectId);
    const text = this.#pendingText ?? obj?.text ?? '';

    this.#objectId = null;
    this.#createdNow = false;
    this.#pendingText = null;
    this.#textarea.hidden = true;
    this.#textarea.value = '';
    this.#view.setEditing([]);

    if (!obj) {
      if (createdNow) this.#store.endLive({ changed: true });
      return;
    }

    if (!text.trim()) {
      // An empty text box is never useful — drop it instead of leaving a ghost.
      if (createdNow) this.#store.cancelLive();
      else this.#store.removeObjects([objectId], { reason: 'text:discard' });
      this.emit('close', { objectId, removed: true });
      return;
    }

    const patch = { text, h: this.#neededHeight({ ...obj, text }) };
    if (createdNow) {
      Object.assign(obj, patch);
      this.#store.endLive({ changed: true });
    } else {
      this.#store.updateObjects([objectId], patch, { reason: 'text:edit' });
    }
    this.emit('close', { objectId, removed: false });
  }

  #pendingText = null;

  #find(objectId) {
    return this.#store.activePage?.objects.find((o) => o.id === objectId) ?? null;
  }

  #neededHeight(obj) {
    const { height } = measureText(this.#measureCtx, obj);
    return Math.max(obj.fontSize * TEXT_LINE_HEIGHT + TEXT_PADDING * 2, height);
  }

  #onInput() {
    const obj = this.#find(this.#objectId);
    if (!obj) return;
    this.#pendingText = this.#textarea.value;
    const height = this.#neededHeight({ ...obj, text: this.#textarea.value });
    if (Math.abs(height - obj.h) > 0.5) {
      this.#store.updateObjects([obj.id], { h: height }, { reason: 'text:grow', live: true });
    }
    this.#position();
  }

  /** Keeps the textarea aligned with the object under the current zoom. */
  #position() {
    const obj = this.#find(this.#objectId);
    if (!obj) return;
    const zoom = this.#view.zoom;
    const b = boundsOf(obj);
    const style = this.#textarea.style;
    style.left = `${b.x * zoom}px`;
    style.top = `${b.y * zoom}px`;
    style.width = `${b.w * zoom}px`;
    style.height = `${b.h * zoom}px`;
    style.font = fontFor({ ...obj, fontSize: obj.fontSize * zoom });
    style.lineHeight = `${obj.fontSize * TEXT_LINE_HEIGHT * zoom}px`;
    style.padding = `${TEXT_PADDING * zoom}px`;
    style.color = obj.color;
    style.textAlign = obj.align ?? 'left';
  }
}
