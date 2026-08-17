import { Emitter } from '../core/emitter.js';

const TITLES = {
  props: 'Propiedades',
  doc: 'Documento',
};

/**
 * Right-hand drawer for the things that do not belong on the desk: the full
 * properties panel and the complete document navigator. It overlays the
 * workspace instead of resizing it, so the paper never jumps, and it is
 * non-modal: the canvas stays usable while it is open.
 */
export function mountDrawer({ root, titleEl, closeButton, panes }) {
  const events = new Emitter();
  let current = null;

  function open(pane) {
    if (!panes[pane]) return;
    current = pane;
    for (const [name, node] of Object.entries(panes)) node.hidden = name !== pane;
    titleEl.textContent = TITLES[pane] ?? 'Panel';
    root.hidden = false;
    // El foco entra al panel para que el teclado siga la vista.
    root.querySelector('button, input, select, [tabindex]:not([tabindex="-1"])')?.focus({ preventScroll: true });
    events.emit('open', { pane });
  }

  function close() {
    if (!current) return;
    current = null;
    root.hidden = true;
    events.emit('close', {});
  }

  function toggle(pane) {
    if (current === pane) close();
    else open(pane);
  }

  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    // Escape cierra el drawer sólo si no hay un diálogo modal por encima.
    if (event.key !== 'Escape' || !current) return;
    if (!document.querySelector('#modalRoot:not([hidden])')) {
      event.stopPropagation();
      close();
    }
  }, true);

  return {
    open,
    close,
    toggle,
    get pane() { return current; },
    get isOpen() { return current !== null; },
    on: (type, fn) => events.on(type, fn),
  };
}
