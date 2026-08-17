import { HISTORY_LIMIT } from '../core/constants.js';

/**
 * Snapshot-based undo/redo. Snapshots only contain the section/page tree —
 * image binaries live in `doc.assets` and are never duplicated, so a snapshot
 * stays small even for documents with many screenshots.
 */
export class History {
  #undo = [];
  #redo = [];
  #limit;

  constructor(limit = HISTORY_LIMIT) {
    this.#limit = limit;
  }

  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get depth() { return this.#undo.length; }

  push(snapshot) {
    this.#undo.push(snapshot);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo.length = 0;
  }

  undo(current) {
    if (!this.#undo.length) return null;
    this.#redo.push(current);
    return this.#undo.pop();
  }

  redo(current) {
    if (!this.#redo.length) return null;
    this.#undo.push(current);
    return this.#redo.pop();
  }

  clear() {
    this.#undo.length = 0;
    this.#redo.length = 0;
  }
}
