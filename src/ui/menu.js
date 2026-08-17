import { el } from '../core/dom.js';

/**
 * Small dropdown for the few commands that do not deserve a permanent button.
 * Keyboard accessible, closes on Escape, outside click or after choosing.
 */
export function mountMenu({ button, items, align = 'right' }) {
  let node = null;

  const close = () => {
    node?.remove();
    node = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };

  const onOutside = (event) => {
    if (!node) return;
    if (node.contains(event.target) || button.contains(event.target)) return;
    close();
  };

  const onKey = (event) => {
    if (!node) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      button.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...node.querySelectorAll('button')];
    const index = options.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    options[(next + options.length) % options.length]?.focus();
  };

  function open() {
    node = el('div.menu', { role: 'menu' }, items.map((item) => el('button.menu__item', {
      type: 'button',
      role: 'menuitem',
      onclick: () => { close(); item.onClick(); },
    }, [
      el('span', {}, [item.label]),
      item.kbd ? el('kbd', {}, [item.kbd]) : null,
    ].filter(Boolean))));

    document.body.append(node);
    const rect = button.getBoundingClientRect();
    const width = node.offsetWidth;
    node.style.top = `${rect.bottom + 6}px`;
    node.style.left = align === 'right'
      ? `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`
      : `${Math.max(8, rect.left)}px`;

    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    node.querySelector('button')?.focus();
  }

  button.addEventListener('click', () => (node ? close() : open()));
  return { open, close, get isOpen() { return node !== null; } };
}
