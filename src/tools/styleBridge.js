import { OBJECT_TYPES } from '../core/constants.js';

/**
 * Single place that knows how an appearance key maps onto each object type,
 * shared by the floating quick bar and the advanced properties drawer so both
 * edit the document in exactly the same way.
 */
export function objectPatchFor(obj, styleKey, value) {
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

/**
 * Applies an appearance change to the current selection, or to the active
 * tool's defaults when nothing is selected. Live edits (dragging a slider)
 * repaint continuously and collapse into one undo entry on release.
 */
export function createStyleApplier({ store, tools }) {
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
    } else if (liveOpen) {
      store.updateObjects(ids, patch, { reason: 'object:style', live: true });
      endLive();
    } else {
      store.updateObjects(ids, patch, { reason: 'object:style' });
    }
    // Keep drawing defaults aligned with the last explicit choice.
    tools.setStyle({ [styleKey]: value });
  }

  return { apply, beginLive, endLive };
}

/** Current value of an appearance key for the selection (or the tool). */
export function readStyle(store, tools, key) {
  const selected = store.selectedObjects;
  const style = tools.style;
  if (!selected.length) return style[key];

  switch (key) {
    case 'color':
      return selected.find((o) => o.stroke)?.stroke ?? style.color;
    case 'fill':
      return selected.find((o) => o.fill)?.fill ?? style.fill;
    case 'textColor':
      return selected.find((o) => o.type === OBJECT_TYPES.text)?.color ?? style.textColor;
    case 'strokeWidth':
      return selected.find((o) => o.strokeWidth !== undefined)?.strokeWidth ?? style.strokeWidth;
    case 'fontSize':
      return selected.find((o) => o.type === OBJECT_TYPES.text)?.fontSize ?? style.fontSize;
    case 'opacity':
      return selected.find((o) => o.opacity !== undefined)?.opacity ?? style.highlightOpacity;
    case 'markerHeight':
      return selected.find((o) => o.type === OBJECT_TYPES.marker)?.h ?? style.markerHeight;
    default:
      return style[key];
  }
}
