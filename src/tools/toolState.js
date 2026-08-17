import { Emitter } from '../core/emitter.js';
import { deepClone } from '../core/util.js';
import { DEFAULT_STYLE, TOOL_BY_ID } from './registry.js';

/**
 * Active tool + the appearance that newly drawn objects inherit.
 * Persisted through the preferences service so a session picks up where the
 * previous one left off.
 */
export class ToolState extends Emitter {
  #tool = 'select';
  #style = deepClone(DEFAULT_STYLE);

  get tool() { return this.#tool; }
  get toolDef() { return TOOL_BY_ID[this.#tool]; }
  get style() { return this.#style; }

  setTool(toolId) {
    if (!TOOL_BY_ID[toolId] || toolId === this.#tool) return;
    const previous = this.#tool;
    this.#tool = toolId;
    this.emit('tool', { tool: toolId, previous });
  }

  setStyle(patch) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.#style[key] = { ...this.#style[key], ...value };
        changed = true;
      } else if (this.#style[key] !== value) {
        this.#style[key] = value;
        changed = true;
      }
    }
    if (changed) this.emit('style', { style: this.#style, patch });
  }

  hydrate(style) {
    if (!style) return;
    this.#style = { ...deepClone(DEFAULT_STYLE), ...deepClone(style) };
    this.emit('style', { style: this.#style, patch: this.#style });
  }
}
