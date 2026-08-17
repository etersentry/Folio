import { OBJECT_TYPES } from '../core/constants.js';

/**
 * Tool catalogue. Each entry declares how it draws, which shortcut selects it
 * and which appearance controls the properties panel should show.
 */
export const TOOLS = [
  {
    id: 'select',
    label: 'Selección',
    key: 'V',
    cursor: 'default',
    controls: [],
    icon: [{ d: 'M6 3.5 19 11l-5.6 1.6L11 20.5z', fill: true }, 'M6 3.5 19 11l-5.6 1.6L11 20.5z'],
  },
  {
    id: 'box',
    label: 'Recuadro',
    key: 'R',
    objectType: OBJECT_TYPES.box,
    cursor: 'crosshair',
    controls: ['color', 'strokeWidth'],
    icon: ['M4.5 6.5h15v11h-15z'],
  },
  {
    id: 'marker',
    label: 'Marcador',
    key: 'U',
    objectType: OBJECT_TYPES.marker,
    cursor: 'crosshair',
    controls: ['fill', 'markerHeight', 'opacity'],
    icon: ['M4 7h13M4 11h9', { d: 'M3.5 14h17v4h-17z', fill: true, opacity: '.45' }],
  },
  {
    id: 'highlight',
    label: 'Resaltador',
    key: 'H',
    objectType: OBJECT_TYPES.highlight,
    cursor: 'crosshair',
    controls: ['fill', 'opacity'],
    icon: [{ d: 'M5 6h14v9H5z', fill: true, opacity: '.4' }, 'M5 6h14v9H5z'],
  },
  {
    id: 'arrow',
    label: 'Flecha',
    key: 'A',
    objectType: OBJECT_TYPES.arrow,
    cursor: 'crosshair',
    controls: ['color', 'strokeWidth'],
    icon: ['M5 19 18.5 5.5M18.5 5.5h-7.5M18.5 5.5v7.5'],
  },
  {
    id: 'line',
    label: 'Línea',
    key: 'L',
    objectType: OBJECT_TYPES.line,
    cursor: 'crosshair',
    controls: ['color', 'strokeWidth'],
    icon: ['M4.5 19.5 19.5 4.5'],
  },
  {
    id: 'ellipse',
    label: 'Elipse',
    key: 'O',
    objectType: OBJECT_TYPES.ellipse,
    cursor: 'crosshair',
    controls: ['color', 'strokeWidth'],
    icon: ['M12 5.5c4.1 0 7 2.9 7 6.5s-2.9 6.5-7 6.5-7-2.9-7-6.5 2.9-6.5 7-6.5z'],
  },
  {
    id: 'text',
    label: 'Texto',
    key: 'T',
    objectType: OBJECT_TYPES.text,
    cursor: 'text',
    controls: ['textColor', 'fontSize', 'textBorder'],
    icon: ['M5.5 6.5h13M12 6.5v12M9 18.5h6'],
  },
  {
    id: 'eraser',
    label: 'Borrador',
    key: 'E',
    cursor: 'none',
    controls: ['eraserSize'],
    icon: ['m13.5 4.5 6 6-8 8H7l-3.5-3.5z', 'M9 20.5h11'],
  },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const TOOL_BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t]));

/** Nombre visible de cada tipo de objeto (barra contextual y drawer). */
export const OBJECT_LABELS = Object.freeze({
  image: 'Imagen',
  box: 'Recuadro',
  marker: 'Marcador',
  highlight: 'Resaltador',
  arrow: 'Flecha',
  line: 'Línea',
  ellipse: 'Elipse',
  text: 'Texto',
});

export const labelForObject = (type) => OBJECT_LABELS[type] ?? 'Objeto';

export const DEFAULT_STYLE = Object.freeze({
  color: '#ff3b30',
  fill: '#ffcc00',
  textColor: '#16191f',
  strokeWidth: 3,
  fontSize: 16,
  markerHeight: 18,
  markerOpacity: 0.42,
  highlightOpacity: 0.3,
  eraserSize: 14,
  frame: { on: false, width: 2, color: '#3a3a3c' },
  textBorder: { on: false, width: 1.5, color: '#3a3a3c' },
});

/** Builds the object props for a tool from a drawn geometry. */
export function objectPropsFor(toolId, style, geometry) {
  switch (toolId) {
    case 'box':
      return { ...geometry, stroke: style.color, strokeWidth: style.strokeWidth };
    case 'ellipse':
      return { ...geometry, stroke: style.color, strokeWidth: style.strokeWidth };
    case 'arrow':
    case 'line':
      return { ...geometry, stroke: style.color, strokeWidth: style.strokeWidth };
    case 'marker':
      return { ...geometry, fill: style.fill, opacity: style.markerOpacity };
    case 'highlight':
      return { ...geometry, fill: style.fill, opacity: style.highlightOpacity };
    case 'text':
      return {
        ...geometry,
        color: style.textColor,
        fontSize: style.fontSize,
        border: { ...style.textBorder },
      };
    default:
      return geometry;
  }
}
