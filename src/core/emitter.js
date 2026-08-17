/** Minimal synchronous event emitter shared by the store and services. */
export class Emitter {
  #listeners = new Map();

  on(type, fn) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.#listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[folio] listener for "${type}" failed`, err);
      }
    }
  }
}
