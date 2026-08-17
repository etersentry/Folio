import { el, clear, icon } from '../core/dom.js';
import { OBJECT_TYPES, PALETTE } from '../core/constants.js';
import { boundsOf, unionRects } from '../core/geometry.js';
import { TOOL_BY_ID, labelForObject } from '../tools/registry.js';
import { createStyleApplier, readStyle } from '../tools/styleBridge.js';

const BAR_GAP = 10;      // separación respecto a la selección
const BAR_MARGIN = 12;   // margen mínimo contra los bordes del escritorio

const ICONS = {
  bold: ['M7.5 5h4.6a3 3 0 0 1 0 6H7.5zM7.5 11h5.2a3.2 3.2 0 0 1 0 6.4H7.5z'],
  alignLeft: ['M4.5 6.5h15M4.5 10.5h9M4.5 14.5h13M4.5 18.5h7'],
  alignCenter: ['M4.5 6.5h15M7.5 10.5h9M5.5 14.5h13M8.5 18.5h7'],
  alignRight: ['M4.5 6.5h15M10.5 10.5h9M6.5 14.5h13M12.5 18.5h7'],
  duplicate: ['M8.5 8.5h10v10h-10z', 'M5.5 15.5v-10h10'],
  remove: ['M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'],
  frame: ['M4.5 4.5h15v15h-15z', 'M8 8h8v8H8z'],
  fitWidth: ['M4 12h16M4 12l3.5-3.5M4 12l3.5 3.5M20 12l-3.5-3.5M20 12l-3.5 3.5'],
  more: ['M6 12h.01M12 12h.01M18 12h.01'],
};

/**
 * Floating contextual bar. It replaces the permanent inspector: it carries the
 * handful of controls that matter for what is selected (or for the active
 * tool) and defers everything else to the properties drawer.
 */
export function mountQuickbar({ host, store, tools, view, stage, drawer }) {
  const { apply } = createStyleApplier({ store, tools });
  let popover = null;
  let suspended = false;

  /* ── Controles compactos ─────────────────────────────────────────────── */

  const divider = () => el('span.quickbar__hair', { 'aria-hidden': 'true' });

  const label = (text) => el('span.quickbar__label', {}, [text]);

  const iconButton = (paths, { title, onClick, pressed = null, danger = false }) => el(
    `button.qbtn${danger ? '.qbtn--danger' : ''}`,
    {
      type: 'button',
      title,
      'aria-label': title,
      ...(pressed === null ? {} : { 'aria-pressed': String(pressed) }),
      onclick: onClick,
    },
    [icon(paths, 15)],
  );

  /** [−] valor [+] — preciso, sin ocupar el ancho de un deslizador. */
  const stepper = (title, { value, min, max, step, suffix = '', onChange, format = null }) => {
    const output = el('span.stepper__value', {}, [format ? format(value) : `${value}${suffix}`]);
    const bump = (delta) => {
      const next = Math.min(max, Math.max(min, Math.round((value + delta) * 100) / 100));
      if (next === value) return;
      onChange(next);
    };
    return el('span.stepper', { title, role: 'group', 'aria-label': title }, [
      el('button.qbtn.qbtn--tight', { type: 'button', 'aria-label': `${title}: reducir`, onclick: () => bump(-step) }, ['−']),
      output,
      el('button.qbtn.qbtn--tight', { type: 'button', 'aria-label': `${title}: aumentar`, onclick: () => bump(step) }, ['+']),
    ]);
  };

  /** Botón de color: muestra el valor actual y abre la paleta. */
  const colorButtonWith = (title, current, onPick) => el('button.qbtn.qbtn--color', {
    type: 'button',
    title,
    'aria-label': title,
    onclick: (event) => openColorPopover(event.currentTarget, current, onPick),
  }, [el('span.qbtn__chip', { style: { background: current } })]);

  const colorButton = (title, styleKey) => colorButtonWith(
    title,
    readStyle(store, tools, styleKey),
    (value, live) => apply(styleKey, value, { live }),
  );

  function closePopover() {
    popover?.remove();
    popover = null;
    document.removeEventListener('pointerdown', onPopoverOutside, true);
  }

  function onPopoverOutside(event) {
    if (popover && !popover.contains(event.target)) closePopover();
  }

  function openColorPopover(anchor, current, onPick) {
    if (popover) { closePopover(); return; }
    const picker = el('input', {
      type: 'color',
      value: /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000',
      'aria-label': 'Color personalizado',
      oninput: (event) => onPick(event.target.value, true),
      onchange: (event) => { onPick(event.target.value, false); render(); },
    });
    popover = el('div.popover.popover--colors', { role: 'dialog', 'aria-label': 'Color' }, [
      el('div.swatches', {}, PALETTE.map((color) => el('button.swatch', {
        type: 'button',
        style: { background: color },
        title: color,
        'aria-label': `Color ${color}`,
        'aria-pressed': String(String(current).toLowerCase() === color.toLowerCase()),
        onclick: () => { onPick(color, false); closePopover(); render(); },
      }))),
      el('div.popover__row', {}, [picker, el('span.popover__note', {}, ['Color personalizado'])]),
    ]);
    document.body.append(popover);
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(BAR_MARGIN, Math.min(rect.left - 8, window.innerWidth - 236))}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    document.addEventListener('pointerdown', onPopoverOutside, true);
  }

  /* ── Composición según el contexto ───────────────────────────────────── */

  function textControls(objects, first, ids) {
    return [
      label('Texto'),
      divider(),
      stepper('Tamaño de texto', {
        value: first.fontSize, min: 8, max: 96, step: 1, suffix: ' px',
        onChange: (v) => { apply('fontSize', v); render(); },
      }),
      iconButton(ICONS.bold, {
        title: 'Negrita',
        pressed: Boolean(first.bold),
        onClick: () => { store.updateObjects(ids, { bold: !first.bold }, { reason: 'text:bold' }); render(); },
      }),
      divider(),
      ...['left', 'center', 'right'].map((align) => iconButton(
        align === 'left' ? ICONS.alignLeft : align === 'center' ? ICONS.alignCenter : ICONS.alignRight,
        {
          title: `Alinear a la ${align === 'left' ? 'izquierda' : align === 'center' ? 'al centro' : 'derecha'}`,
          pressed: first.align === align,
          onClick: () => { store.updateObjects(ids, { align }, { reason: 'text:align' }); render(); },
        },
      )),
      divider(),
      colorButton('Color del texto', 'textColor'),
    ];
  }

  function strokeControls() {
    return [
      stepper('Grosor', {
        value: readStyle(store, tools, 'strokeWidth'), min: 1, max: 24, step: 1, suffix: ' px',
        onChange: (v) => { apply('strokeWidth', v); render(); },
      }),
      colorButton('Color del trazo', 'color'),
    ];
  }

  function fillControls(isMarker) {
    const out = [
      stepper('Opacidad', {
        value: readStyle(store, tools, 'opacity'),
        min: 0.05, max: 1, step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => { apply('opacity', v); render(); },
      }),
      colorButton('Color', 'fill'),
    ];
    if (isMarker) {
      out.unshift(stepper('Alto de banda', {
        value: readStyle(store, tools, 'markerHeight'), min: 6, max: 80, step: 2, suffix: ' px',
        onChange: (v) => { apply('markerHeight', v); render(); },
      }));
    }
    return out;
  }

  function imageControls(first, ids, commands) {
    const frame = first.frame ?? { on: false, width: 2, color: '#3a3a3c' };
    return [
      label('Imagen'),
      divider(),
      iconButton(ICONS.frame, {
        title: 'Marco',
        pressed: frame.on,
        onClick: () => { apply('frame', { ...frame, on: !frame.on }); render(); },
      }),
      frame.on ? stepper('Grosor del marco', {
        value: frame.width, min: 0.5, max: 20, step: 0.5, suffix: ' px',
        onChange: (v) => { apply('frame', { ...frame, width: v }); render(); },
      }) : null,
      frame.on ? colorButtonWith('Color del marco', frame.color, (value, live) => {
        apply('frame', { ...frame, color: value }, { live });
      }) : null,
      iconButton(ICONS.fitWidth, {
        title: 'Ajustar al ancho útil',
        onClick: () => commands.fitImageToContent(ids),
      }),
    ].filter(Boolean);
  }

  function selectionControls(objects, commands) {
    const ids = objects.map((o) => o.id);
    const types = new Set(objects.map((o) => o.type));
    const first = objects[0];
    const items = [];

    if (objects.length > 1) {
      items.push(label(`${objects.length} objetos`), divider(), ...strokeControls());
    } else if (first.type === OBJECT_TYPES.text) {
      items.push(...textControls(objects, first, ids));
    } else if (first.type === OBJECT_TYPES.image) {
      items.push(...imageControls(first, ids, commands));
    } else if (types.has(OBJECT_TYPES.marker) || types.has(OBJECT_TYPES.highlight)) {
      items.push(label(labelForObject(first.type)), divider(), ...fillControls(types.has(OBJECT_TYPES.marker)));
    } else {
      items.push(label(labelForObject(first.type)), divider(), ...strokeControls());
    }

    items.push(
      divider(),
      iconButton(ICONS.duplicate, { title: 'Duplicar (Ctrl+D)', onClick: () => store.duplicateObjects(ids) }),
      iconButton(ICONS.remove, { title: 'Eliminar (Supr)', danger: true, onClick: () => store.removeObjects(ids) }),
      divider(),
      iconButton(ICONS.more, { title: 'Propiedades avanzadas', onClick: () => drawer.open('props') }),
    );
    return items;
  }

  function toolControls() {
    const tool = TOOL_BY_ID[tools.tool];
    const controls = new Set(tool?.controls ?? []);
    if (!controls.size) return null; // la herramienta de selección no necesita barra

    const items = [label(tool.label), divider()];
    if (controls.has('color') || controls.has('strokeWidth')) items.push(...strokeControls());
    if (controls.has('fill')) items.push(...fillControls(controls.has('markerHeight')));
    if (controls.has('textColor')) {
      items.push(
        stepper('Tamaño de texto', {
          value: tools.style.fontSize, min: 8, max: 96, step: 1, suffix: ' px',
          onChange: (v) => { apply('fontSize', v); render(); },
        }),
        colorButton('Color del texto', 'textColor'),
      );
    }
    if (controls.has('eraserSize')) {
      items.push(stepper('Tamaño del borrador', {
        value: tools.style.eraserSize, min: 6, max: 60, step: 2, suffix: ' px',
        onChange: (v) => { apply('eraserSize', v); render(); },
      }));
    }
    items.push(
      divider(),
      iconButton(ICONS.more, { title: 'Propiedades avanzadas', onClick: () => drawer.open('props') }),
    );
    return items;
  }

  /* ── Render y posición ───────────────────────────────────────────────── */

  let commands = { fitImageToContent: () => {} };

  function render() {
    if (suspended) return;
    const selected = store.selectedObjects;
    const items = selected.length ? selectionControls(selected, commands) : toolControls();

    if (!items) {
      host.hidden = true;
      closePopover();
      return;
    }
    clear(host);
    host.append(...items);
    host.hidden = false;
    position();
  }

  /**
   * Anchored above the selection when there is room, below it otherwise, and
   * docked under the top bar when the bar reflects the tool rather than an
   * object.
   */
  function position() {
    if (host.hidden) return;
    const deskRect = stage.getBoundingClientRect();
    const barRect = host.getBoundingClientRect();
    const selected = store.selectedObjects;

    let left;
    let top;

    if (selected.length) {
      const bounds = unionRects(selected.map((o) => boundsOf(o)));
      const screen = view.toScreenRect(bounds);
      left = screen.x + screen.w / 2 - barRect.width / 2;
      top = screen.y - barRect.height - BAR_GAP;
      if (top < deskRect.top + BAR_MARGIN) {
        const below = screen.y + screen.h + BAR_GAP;
        top = below + barRect.height > deskRect.bottom - BAR_MARGIN
          ? deskRect.top + BAR_MARGIN
          : below;
      }
    } else {
      left = deskRect.left + deskRect.width / 2 - barRect.width / 2;
      top = deskRect.top + BAR_MARGIN;
    }

    const minLeft = deskRect.left + BAR_MARGIN;
    const maxLeft = deskRect.right - barRect.width - BAR_MARGIN;
    host.style.left = `${Math.round(Math.max(minLeft, Math.min(left, maxLeft)))}px`;
    host.style.top = `${Math.round(Math.max(deskRect.top + BAR_MARGIN, top))}px`;
  }

  /* ── Suscripciones ───────────────────────────────────────────────────── */

  store.on('selection', render);
  store.on('page', render);
  tools.on('tool', render);
  tools.on('style', () => { if (!store.selectionIds.length) render(); });
  store.on('change', ({ live }) => {
    // Durante un arrastre la barra estorba: se aparta y vuelve al soltar.
    host.classList.toggle('is-muted', live);
    if (live) return;
    render();
  });
  view.on('zoom', position);
  stage.addEventListener('scroll', position, { passive: true });
  window.addEventListener('resize', position);

  return {
    render,
    position,
    setCommands(next) { commands = next; },
    /** El editor de texto en el lienzo oculta la barra mientras se escribe. */
    suspend(value) {
      suspended = value;
      if (value) { host.hidden = true; closePopover(); } else render();
    },
  };
}
