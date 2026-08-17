import { el, clear, icon } from '../core/dom.js';
import { PALETTE, OBJECT_TYPES } from '../core/constants.js';
import { TOOL_BY_ID } from '../tools/registry.js';
import { boundsOf, isSegment } from '../core/geometry.js';
import { round } from '../core/util.js';

const LAYER_ICONS = {
  front: ['M12 4 4 9l8 5 8-5z', 'M4 15l8 5 8-5'],
  back: ['M4 9l8 5 8-5', 'M12 4 4 9M20 9l-8-5'],
};

/**
 * Contextual properties. With a selection it edits those objects; with nothing
 * selected it edits the defaults the active tool will use next.
 */
export function mountProperties({ host, titleEl, scopeEl, store, tools, commands }) {
  let liveOpen = false;

  const beginLive = () => {
    if (liveOpen) return;
    store.beginLive('object:style');
    liveOpen = true;
  };
  const endLive = () => {
    if (!liveOpen) return;
    store.endLive({ changed: true });
    liveOpen = false;
  };

  /** Applies a style change to the selection, or to the tool defaults. */
  function apply(styleKey, value, { live = false } = {}) {
    const ids = store.selectionIds;
    if (!ids.length) {
      tools.setStyle({ [styleKey]: value });
      return;
    }
    const patch = (obj) => objectPatchFor(obj, styleKey, value);
    if (live) {
      beginLive();
      store.updateObjects(ids, patch, { reason: 'object:style', live: true });
    } else {
      if (liveOpen) {
        store.updateObjects(ids, patch, { reason: 'object:style', live: true });
        endLive();
      } else {
        store.updateObjects(ids, patch, { reason: 'object:style' });
      }
    }
    // Keep drawing defaults aligned with the last explicit choice.
    tools.setStyle({ [styleKey]: value });
  }

  /* ── Control builders ────────────────────────────────────────────────── */

  function swatches(current, onPick) {
    return el('div.swatches', { role: 'group', 'aria-label': 'Colores' },
      PALETTE.map((color) => el('button.swatch', {
        type: 'button',
        style: { background: color },
        title: color,
        'aria-label': `Color ${color}`,
        'aria-pressed': String(String(current).toLowerCase() === color.toLowerCase()),
        onclick: () => onPick(color),
      })));
  }

  function colorField(label, value, onChange) {
    const picker = el('input', {
      type: 'color',
      value: normalizeHex(value),
      dataset: { field: `color:${label}` },
      'aria-label': `${label}: color personalizado`,
      oninput: (event) => onChange(event.target.value, true),
      onchange: (event) => onChange(event.target.value, false),
    });
    return el('div.field', {}, [
      el('div.field__label', {}, [el('span', {}, [label]), el('span.field__value', {}, [String(value).toUpperCase()])]),
      swatches(value, (color) => { picker.value = normalizeHex(color); onChange(color, false); }),
      el('div.field__row', {}, [picker, el('span.empty-note', {}, ['Color personalizado'])]),
    ]);
  }

  function slider(label, { value, min, max, step = 1, suffix = '', onChange }) {
    const output = el('span.field__value', {}, [`${round(value, 2)}${suffix}`]);
    const input = el('input', {
      type: 'range',
      min, max, step,
      value,
      dataset: { field: `range:${label}` },
      'aria-label': label,
      oninput: (event) => {
        const next = Number(event.target.value);
        output.textContent = `${round(next, 2)}${suffix}`;
        onChange(next, true);
      },
      onchange: (event) => onChange(Number(event.target.value), false),
    });
    return el('div.field', {}, [
      el('div.field__label', {}, [el('span', {}, [label]), output]),
      input,
    ]);
  }

  function toggle(label, checked, onChange) {
    return el('label.switch', {}, [
      el('input', {
        type: 'checkbox',
        checked,
        dataset: { field: `toggle:${label}` },
        onchange: (event) => onChange(event.target.checked),
      }),
      el('span', {}, [label]),
    ]);
  }

  function group(title, children) {
    return el('div.field-group', {}, [
      title ? el('div.field-group__title', {}, [title]) : null,
      ...children.filter(Boolean),
    ]);
  }

  /* ── Sections of the panel ───────────────────────────────────────────── */

  function toolDefaults() {
    const tool = TOOL_BY_ID[tools.tool];
    const style = tools.style;
    const controls = new Set(tool?.controls ?? []);
    const blocks = [];

    if (controls.has('color')) {
      blocks.push(group('Trazo', [colorField('Color', style.color, (v, live) => apply('color', v, { live }))]));
    }
    if (controls.has('fill')) {
      blocks.push(group('Relleno', [colorField('Color', style.fill, (v, live) => apply('fill', v, { live }))]));
    }
    if (controls.has('textColor')) {
      blocks.push(group('Texto', [colorField('Color del texto', style.textColor, (v, live) => apply('textColor', v, { live }))]));
    }
    if (controls.has('strokeWidth')) {
      blocks.push(slider('Grosor', {
        value: style.strokeWidth, min: 1, max: 24, step: 0.5, suffix: ' px',
        onChange: (v, live) => apply('strokeWidth', v, { live }),
      }));
    }
    if (controls.has('fontSize')) {
      blocks.push(slider('Tamaño de texto', {
        value: style.fontSize, min: 8, max: 96, step: 1, suffix: ' px',
        onChange: (v, live) => apply('fontSize', v, { live }),
      }));
    }
    if (controls.has('markerHeight')) {
      blocks.push(slider('Alto de banda', {
        value: style.markerHeight, min: 6, max: 60, step: 1, suffix: ' px',
        onChange: (v, live) => apply('markerHeight', v, { live }),
      }));
    }
    if (controls.has('opacity')) {
      const key = tools.tool === 'marker' ? 'markerOpacity' : 'highlightOpacity';
      blocks.push(slider('Opacidad', {
        value: style[key], min: 0.05, max: 1, step: 0.05,
        onChange: (v, live) => apply(key, v, { live }),
      }));
    }
    if (controls.has('textBorder')) {
      blocks.push(group('Borde del cuadro', [
        toggle('Mostrar borde', style.textBorder.on, (on) => apply('textBorder', { ...style.textBorder, on })),
        style.textBorder.on ? slider('Grosor del borde', {
          value: style.textBorder.width, min: 0.5, max: 12, step: 0.5, suffix: ' px',
          onChange: (v, live) => apply('textBorder', { ...style.textBorder, width: v }, { live }),
        }) : null,
        style.textBorder.on
          ? colorField('Color del borde', style.textBorder.color, (v, live) => apply('textBorder', { ...style.textBorder, color: v }, { live }))
          : null,
      ]));
    }
    if (controls.has('eraserSize')) {
      blocks.push(slider('Tamaño del borrador', {
        value: style.eraserSize, min: 6, max: 60, step: 1, suffix: ' px',
        onChange: (v, live) => apply('eraserSize', v, { live }),
      }));
    }

    if (!blocks.length) {
      blocks.push(el('p.empty-note', {}, [
        'Selecciona un objeto en el lienzo para editar sus propiedades, o elige una herramienta de dibujo para ajustar su apariencia.',
      ]));
    }
    return blocks;
  }

  function geometryFields(obj) {
    const b = boundsOf(obj);
    const numeric = (label, value, onCommit) => el('label.field', {}, [
      el('span.field__label', {}, [label]),
      el('input', {
        type: 'number',
        value: Math.round(value),
        step: 1,
        dataset: { field: `num:${label}` },
        onchange: (event) => onCommit(Number(event.target.value)),
      }),
    ]);
    if (isSegment(obj)) return null;
    return group('Posición y tamaño', [
      el('div.btn-row', {}, [
        numeric('X', b.x, (v) => store.updateObjects([obj.id], { x: v })),
        numeric('Y', b.y, (v) => store.updateObjects([obj.id], { y: v })),
      ]),
      el('div.btn-row', {}, [
        numeric('Ancho', b.w, (v) => store.updateObjects([obj.id], { w: Math.max(6, v) })),
        numeric('Alto', b.h, (v) => store.updateObjects([obj.id], { h: Math.max(6, v) })),
      ]),
    ]);
  }

  function selectionControls(objects) {
    const ids = objects.map((o) => o.id);
    const types = new Set(objects.map((o) => o.type));
    const single = objects.length === 1 ? objects[0] : null;
    const blocks = [];
    const has = (type) => types.has(type);

    if (has(OBJECT_TYPES.box) || has(OBJECT_TYPES.ellipse) || has(OBJECT_TYPES.arrow) || has(OBJECT_TYPES.line)) {
      const first = objects.find((o) => o.stroke) ?? {};
      blocks.push(group('Trazo', [
        colorField('Color', first.stroke ?? tools.style.color, (v, live) => apply('color', v, { live })),
        slider('Grosor', {
          value: first.strokeWidth ?? tools.style.strokeWidth, min: 1, max: 24, step: 0.5, suffix: ' px',
          onChange: (v, live) => apply('strokeWidth', v, { live }),
        }),
      ]));
    }

    if (has(OBJECT_TYPES.marker) || has(OBJECT_TYPES.highlight)) {
      const first = objects.find((o) => o.fill) ?? {};
      blocks.push(group('Relleno', [
        colorField('Color', first.fill ?? tools.style.fill, (v, live) => apply('fill', v, { live })),
        slider('Opacidad', {
          value: first.opacity ?? 0.35, min: 0.05, max: 1, step: 0.05,
          onChange: (v, live) => apply('opacity', v, { live }),
        }),
        has(OBJECT_TYPES.marker) && single ? slider('Alto de banda', {
          value: single.h, min: 6, max: 80, step: 1, suffix: ' px',
          onChange: (v, live) => apply('markerHeight', v, { live }),
        }) : null,
      ]));
    }

    if (has(OBJECT_TYPES.text)) {
      const first = objects.find((o) => o.type === OBJECT_TYPES.text);
      blocks.push(group('Texto', [
        colorField('Color del texto', first.color, (v, live) => apply('textColor', v, { live })),
        slider('Tamaño', {
          value: first.fontSize, min: 8, max: 96, step: 1, suffix: ' px',
          onChange: (v, live) => apply('fontSize', v, { live }),
        }),
        el('div.field', {}, [
          el('span.field__label', {}, ['Alineación']),
          el('div.radio-cards', {}, ['left', 'center', 'right'].map((align) => el('button.radio-card', {
            type: 'button',
            'aria-pressed': String(first.align === align),
            onclick: () => store.updateObjects(ids, { align }, { reason: 'text:align' }),
          }, [align === 'left' ? 'Izq.' : align === 'center' ? 'Centro' : 'Der.']))),
        ]),
        toggle('Negrita', Boolean(first.bold), (bold) => store.updateObjects(ids, { bold }, { reason: 'text:bold' })),
        toggle('Borde del cuadro', Boolean(first.border?.on), (on) => apply('textBorder', { ...first.border, on })),
        first.border?.on ? slider('Grosor del borde', {
          value: first.border.width, min: 0.5, max: 12, step: 0.5, suffix: ' px',
          onChange: (v, live) => apply('textBorder', { ...first.border, width: v }, { live }),
        }) : null,
        first.border?.on
          ? colorField('Color del borde', first.border.color, (v, live) => apply('textBorder', { ...first.border, color: v }, { live }))
          : null,
        toggle('Fondo sólido', Boolean(first.background?.on), (on) => store.updateObjects(ids, (obj) => ({
          background: { ...obj.background, on },
        }), { reason: 'text:background' })),
      ]));
    }

    if (has(OBJECT_TYPES.image)) {
      const first = objects.find((o) => o.type === OBJECT_TYPES.image);
      const frame = first.frame ?? { on: false, width: 2, color: '#3a3a3c' };
      blocks.push(group('Imagen', [
        toggle('Marco', frame.on, (on) => apply('frame', { ...frame, on })),
        frame.on ? slider('Grosor del marco', {
          value: frame.width, min: 0.5, max: 20, step: 0.5, suffix: ' px',
          onChange: (v, live) => apply('frame', { ...frame, width: v }, { live }),
        }) : null,
        frame.on ? colorField('Color del marco', frame.color, (v, live) => apply('frame', { ...frame, color: v }, { live })) : null,
        el('button.btn.sm', {
          type: 'button',
          onclick: () => commands.fitImageToContent(ids),
        }, ['Ajustar al ancho útil']),
        el('button.btn.sm', {
          type: 'button',
          onclick: () => commands.resetImageScale(ids),
        }, ['Tamaño original']),
      ]));
    }

    if (single) {
      const geo = geometryFields(single);
      if (geo) blocks.push(geo);
    }

    blocks.push(group('Orden y acciones', [
      el('div.btn-row', {}, [
        el('button.btn.sm', { type: 'button', onclick: () => store.reorderObjects(ids, 'front') }, [icon(LAYER_ICONS.front, 14), 'Al frente']),
        el('button.btn.sm', { type: 'button', onclick: () => store.reorderObjects(ids, 'back') }, [icon(LAYER_ICONS.back, 14), 'Al fondo']),
      ]),
      el('div.btn-row', {}, [
        el('button.btn.sm', { type: 'button', onclick: () => store.reorderObjects(ids, 'forward') }, ['Subir']),
        el('button.btn.sm', { type: 'button', onclick: () => store.reorderObjects(ids, 'backward') }, ['Bajar']),
      ]),
      el('div.btn-row', {}, [
        el('button.btn.sm', { type: 'button', onclick: () => store.duplicateObjects(ids) }, ['Duplicar']),
        el('button.btn.sm.danger', { type: 'button', onclick: () => store.removeObjects(ids) }, ['Eliminar']),
      ]),
    ]));

    return blocks;
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  let rendering = false;

  function render() {
    // Re-focusing a control can fire blur/change handlers that ask for another
    // render; one pass is enough.
    if (rendering) return;
    rendering = true;
    try {
      renderNow();
    } finally {
      rendering = false;
    }
  }

  function renderNow() {
    const selected = store.selectedObjects;
    // A re-render rebuilds every control, so remember which one had focus.
    const focusedField = host.contains(document.activeElement)
      ? document.activeElement.dataset?.field ?? null
      : null;
    clear(host);

    if (selected.length) {
      const label = selected.length === 1 ? typeLabel(selected[0].type) : `${selected.length} objetos`;
      titleEl.textContent = label;
      scopeEl.textContent = 'Selección';
      for (const block of selectionControls(selected)) host.append(block);
    } else {
      // With the select tool there is no appearance to configure, so the panel
      // is simply "Propiedades" waiting for something to be selected.
      titleEl.textContent = tools.tool === 'select'
        ? 'Propiedades'
        : TOOL_BY_ID[tools.tool]?.label ?? 'Propiedades';
      scopeEl.textContent = 'Herramienta';
      for (const block of toolDefaults()) host.append(block);
    }

    if (focusedField) {
      host.querySelector(`[data-field="${CSS.escape(focusedField)}"]`)?.focus({ preventScroll: true });
    }
  }

  store.on('selection', render);
  store.on('page', render);
  store.on('change', ({ live }) => {
    // Live drags only repaint the canvas; the panel follows settled values so
    // toggling an option immediately reveals the controls it unlocks.
    if (live) return;
    render();
  });
  tools.on('tool', render);
  tools.on('style', () => { if (!store.selectionIds.length) render(); });

  render();
  return { render };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function typeLabel(type) {
  return {
    image: 'Imagen',
    box: 'Recuadro',
    marker: 'Marcador',
    highlight: 'Resaltador',
    arrow: 'Flecha',
    line: 'Línea',
    ellipse: 'Elipse',
    text: 'Texto',
  }[type] ?? 'Objeto';
}

function normalizeHex(value) {
  const hex = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
}

/** Maps an appearance key onto the fields a given object type understands. */
function objectPatchFor(obj, styleKey, value) {
  switch (styleKey) {
    case 'color':
      return 'stroke' in obj ? { stroke: value } : null;
    case 'fill':
      return 'fill' in obj ? { fill: value } : null;
    case 'textColor':
      return obj.type === OBJECT_TYPES.text ? { color: value } : null;
    case 'strokeWidth':
      return 'strokeWidth' in obj ? { strokeWidth: value } : null;
    case 'fontSize':
      return obj.type === OBJECT_TYPES.text ? { fontSize: value } : null;
    case 'markerOpacity':
    case 'highlightOpacity':
    case 'opacity':
      return 'opacity' in obj ? { opacity: value } : null;
    case 'markerHeight':
      return obj.type === OBJECT_TYPES.marker ? { h: value } : null;
    case 'frame':
      return obj.type === OBJECT_TYPES.image ? { frame: { ...obj.frame, ...value } } : null;
    case 'textBorder':
      return obj.type === OBJECT_TYPES.text ? { border: { ...obj.border, ...value } } : null;
    default:
      return null;
  }
}
