import { el, clear, icon } from '../core/dom.js';
import { TOOLS } from '../tools/registry.js';

/** Renders the tool palette and keeps it in sync with the active tool. */
export function mountToolPanel({ host, tools }) {
  const buttons = new Map();

  clear(host);
  for (const tool of TOOLS) {
    const button = el('button.tool', {
      type: 'button',
      title: `${tool.label} (${tool.key})`,
      'aria-label': `${tool.label}, atajo ${tool.key}`,
      'aria-pressed': String(tools.tool === tool.id),
      onclick: () => tools.setTool(tool.id),
    }, [icon(tool.icon, 19), el('span.tool__key', { 'aria-hidden': 'true' }, [tool.key])]);
    buttons.set(tool.id, button);
    host.append(button);
  }

  const sync = () => {
    for (const [id, button] of buttons) {
      button.setAttribute('aria-pressed', String(tools.tool === id));
    }
  };

  tools.on('tool', sync);
  return { sync };
}
