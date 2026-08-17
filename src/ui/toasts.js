import { el, $ } from '../core/dom.js';

const HOST_ID = 'toasts';

/**
 * Transient status messages. Errors stay until dismissed so a failed autosave
 * can never disappear unnoticed.
 */
export function toast(message, { type = 'info', timeout = 3200, actions = [] } = {}) {
  const host = $(`#${HOST_ID}`);
  if (!host) return () => {};

  const node = el(`div.toast.toast--${type}`, { role: type === 'error' ? 'alert' : 'status' }, [
    el('div.toast__message', {}, [message]),
  ]);

  const close = () => {
    node.remove();
  };

  const buttons = [...actions];
  if (type === 'error' || !timeout) buttons.push({ label: 'Cerrar', onClick: close });
  if (buttons.length) {
    node.append(el('div.toast__actions', {}, buttons.map((action) => el('button.btn.sm', {
      type: 'button',
      onclick: () => {
        try {
          action.onClick?.();
        } finally {
          if (action.keepOpen !== true) close();
        }
      },
    }, [action.label]))));
  }

  host.append(node);
  if (timeout && type !== 'error') setTimeout(close, timeout);
  return close;
}

export const toastError = (message, options = {}) => toast(message, { ...options, type: 'error', timeout: 0 });
export const toastOk = (message, options = {}) => toast(message, { ...options, type: 'ok' });
export const toastWarn = (message, options = {}) => toast(message, { ...options, type: 'warn', timeout: 6000 });
