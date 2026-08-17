import { isTypingTarget, isFormControl } from '../core/dom.js';
import { TOOL_BY_KEY } from '../tools/registry.js';
import { isSegment } from '../core/geometry.js';
import { OBJECT_TYPES } from '../core/constants.js';

/** Global keyboard map. Typing inside a field never triggers tool shortcuts. */
export function mountShortcuts({ store, tools, view, textEditor, commands }) {
  const nudge = (dx, dy) => {
    const ids = store.selectionIds;
    if (!ids.length) return;
    store.updateObjects(ids, (obj) => (isSegment(obj)
      ? { x1: obj.x1 + dx, y1: obj.y1 + dy, x2: obj.x2 + dx, y2: obj.y2 + dy }
      : { x: obj.x + dx, y: obj.y + dy }), { reason: 'object:nudge' });
  };

  function onKeyDown(event) {
    const mod = event.ctrlKey || event.metaKey;
    const typing = isTypingTarget(event.target);
    // Sliders, checkboxes and selects keep their own arrow/space behaviour,
    // but letter shortcuts still switch tools while they have focus.
    const inControl = isFormControl(event.target);

    if (mod) {
      const key = event.key.toLowerCase();
      switch (key) {
        case 'z':
          event.preventDefault();
          if (event.shiftKey) store.redo(); else store.undo();
          return;
        case 'y':
          event.preventDefault();
          store.redo();
          return;
        case 's':
          event.preventDefault();
          commands.save({ saveAs: event.shiftKey });
          return;
        case 'o':
          event.preventDefault();
          commands.open();
          return;
        case 'e':
          event.preventDefault();
          commands.exportDialog();
          return;
        case 'd':
          if (typing) return;
          event.preventDefault();
          store.duplicateObjects(store.selectionIds);
          return;
        case 'a':
          if (typing) return;
          event.preventDefault();
          store.selectAll();
          return;
        case '0':
          event.preventDefault();
          view.zoomToFit();
          return;
        case '+':
        case '=':
          event.preventDefault();
          view.zoomStep(1);
          return;
        case '-':
          event.preventDefault();
          view.zoomStep(-1);
          return;
        default:
          return;
      }
    }

    if (typing) return;

    if (inControl && event.key !== 'Escape' && !TOOL_BY_KEY[event.key.toLowerCase()]) return;

    switch (event.key) {
      case 'Escape':
        if (textEditor.isOpen) textEditor.commit();
        else store.clearSelection();
        return;
      case 'Delete':
      case 'Backspace': {
        const ids = store.selectionIds;
        if (!ids.length) return;
        event.preventDefault();
        store.removeObjects(ids);
        return;
      }
      case 'Enter': {
        const selected = store.selectedObjects;
        if (selected.length === 1 && selected[0].type === OBJECT_TYPES.text) {
          event.preventDefault();
          textEditor.open(selected[0].id, { selectAll: true });
        }
        return;
      }
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        if (event.altKey) {
          event.preventDefault();
          store.stepPage(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        if (!store.selectionIds.length) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const map = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
        nudge(...map[event.key]);
        return;
      }
      case 'PageDown':
        event.preventDefault();
        store.stepPage(1);
        return;
      case 'PageUp':
        event.preventDefault();
        store.stepPage(-1);
        return;
      default:
        break;
    }

    if (event.altKey || event.shiftKey) return;
    const tool = TOOL_BY_KEY[event.key.toLowerCase()];
    if (tool) {
      event.preventDefault();
      tools.setTool(tool.id);
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
