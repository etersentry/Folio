import { el, clear } from '../core/dom.js';
import { ACCENTS, BACKGROUNDS } from '../core/constants.js';

const THEMES = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
  { id: 'auto', label: 'Sistema' },
];

/** Floating appearance panel: theme, accent, workspace background, glass. */
export function mountAppearance({ button, prefs }) {
  let popover = null;

  const close = () => {
    popover?.remove();
    popover = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };

  const onOutside = (event) => {
    if (!popover) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    close();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); button.focus(); }
  };

  const optionRow = (label, options, current, onPick, renderPreview = null) => el('div.field', {}, [
    el('span.field__label', {}, [label]),
    el('div.radio-cards', {}, options.map((option) => el('button.radio-card', {
      type: 'button',
      'aria-pressed': String(current === option.id),
      onclick: () => { onPick(option.id); refresh(); },
    }, [renderPreview ? renderPreview(option) : null, option.label].filter(Boolean)))),
  ]);

  function build() {
    const { theme, accent, background, transparency } = prefs.values;
    const node = el('div.popover.glass', { role: 'dialog', 'aria-label': 'Apariencia' }, [
      optionRow('Tema', THEMES, theme, (id) => prefs.set({ theme: id })),
      el('div.field', {}, [
        el('span.field__label', {}, ['Color de acento']),
        el('div.swatches', { style: { gridTemplateColumns: `repeat(${ACCENTS.length + 1}, 1fr)` } }, [
          ...ACCENTS.map((option) => el('button.swatch', {
            type: 'button',
            style: { background: option.value },
            title: option.id,
            'aria-label': `Acento ${option.id}`,
            'aria-pressed': String(accent.toLowerCase() === option.value.toLowerCase()),
            onclick: () => { prefs.set({ accent: option.value }); refresh(); },
          })),
          el('input', {
            type: 'color',
            value: accent,
            'aria-label': 'Acento personalizado',
            style: { width: '100%', height: 'auto', aspectRatio: '1' },
            oninput: (event) => prefs.set({ accent: event.target.value, }),
          }),
        ]),
      ]),
      optionRow('Fondo del área de trabajo', BACKGROUNDS, background, (id) => prefs.set({ background: id })),
      el('label.switch', {}, [
        el('input', {
          type: 'checkbox',
          checked: transparency,
          onchange: (event) => prefs.set({ transparency: event.target.checked }),
        }),
        el('span', {}, ['Superficies translúcidas']),
      ]),
      el('p.empty-note', {}, ['Desactiva la transparencia si prefieres máximo contraste o mejor rendimiento.']),
    ]);
    return node;
  }

  function place() {
    const rect = button.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${Math.max(12, Math.min(rect.right - 268, window.innerWidth - 280))}px`;
  }

  function refresh() {
    if (!popover) return;
    const next = build();
    clear(popover);
    popover.append(...next.childNodes);
  }

  function open() {
    popover = build();
    document.body.append(popover);
    place();
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    popover.querySelector('button')?.focus();
  }

  button.addEventListener('click', () => (popover ? close() : open()));
  window.addEventListener('resize', () => popover && place());
  return { close };
}
