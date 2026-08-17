import { el, $, clear } from '../core/dom.js';

let activeClose = null;

/**
 * Accessible modal: focus is moved inside, Escape and backdrop clicks close it,
 * and focus returns to the previously active element.
 *
 * `build(ctx)` receives `{ close }` and returns the body node.
 */
export function openModal({ title, build, actions = [], wide = false, dismissable = true }) {
  const root = $('#modalRoot');
  if (!root) return Promise.resolve(null);
  activeClose?.(null);

  const previousFocus = document.activeElement;

  return new Promise((resolve) => {
    const close = (result) => {
      document.removeEventListener('keydown', onKeyDown, true);
      root.hidden = true;
      clear(root);
      activeClose = null;
      previousFocus?.focus?.();
      resolve(result ?? null);
    };
    activeClose = close;

    const body = build?.({ close }) ?? null;
    const footer = el('div.modal__actions', {}, actions.map((action) => el(
      `button.btn${action.variant ? `.${action.variant}` : ''}`,
      { type: 'button', onclick: () => action.onClick?.({ close }) },
      [action.label],
    )));

    const dialog = el(`div.modal${wide ? '.modal--wide' : ''}`, {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    }, [
      el('h2.modal__title', {}, [title]),
      body,
      actions.length ? footer : null,
    ]);

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && dismissable) {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.disabled && node.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    clear(root);
    root.append(dialog);
    root.hidden = false;
    root.onclick = (event) => {
      if (event.target === root && dismissable) close(null);
    };
    document.addEventListener('keydown', onKeyDown, true);

    const autofocus = dialog.querySelector('[data-autofocus]') ?? dialog.querySelector('input, button');
    autofocus?.focus();
    if (autofocus instanceof HTMLInputElement) autofocus.select();
  });
}

/** Yes/no confirmation. Resolves to true only when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Continuar', danger = false }) {
  return openModal({
    title,
    build: () => el('div.modal__body', {}, [message]),
    actions: [
      { label: 'Cancelar', onClick: ({ close }) => close(false) },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: ({ close }) => close(true) },
    ],
  }).then((result) => result === true);
}

/** Single-line text prompt. Resolves to the string, or null when cancelled. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Aceptar', hint = null }) {
  let input;
  return openModal({
    title,
    build: ({ close }) => {
      input = el('input.input', {
        type: 'text',
        value,
        'data-autofocus': '',
        onkeydown: (event) => {
          if (event.key === 'Enter') close(input.value.trim() || null);
        },
      });
      return el('div.modal__body', {}, [
        el('label.field', {}, [el('span.field__label', {}, [label]), input]),
        hint ? el('p.empty-note', {}, [hint]) : null,
      ]);
    },
    actions: [
      { label: 'Cancelar', onClick: ({ close }) => close(null) },
      { label: confirmLabel, variant: 'primary', onClick: ({ close }) => close(input.value.trim() || null) },
    ],
  });
}
