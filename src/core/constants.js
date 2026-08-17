/** Document-wide constants. The document coordinate space is CSS pixels at
 *  96 dpi, so a Letter page is exactly 816 x 1056 units. */

export const PAGE = Object.freeze({
  width: 816,
  height: 1056,
  /** PDF points (72 dpi) for a Letter page. */
  ptWidth: 612,
  ptHeight: 792,
  margin: 44,
  /** Fraction of the page width reserved on the right for annotations. */
  annotationGutter: 0.24,
  /** Vertical gap between auto-placed images. */
  imageGap: 20,
});

export const OBJECT_TYPES = Object.freeze({
  image: 'image',
  box: 'box',
  marker: 'marker',
  highlight: 'highlight',
  arrow: 'arrow',
  line: 'line',
  ellipse: 'ellipse',
  text: 'text',
});

/** Types drawn as a two-point segment instead of a box. */
export const SEGMENT_TYPES = Object.freeze([OBJECT_TYPES.arrow, OBJECT_TYPES.line]);

/** Everything the eraser is allowed to remove (images are never erased). */
export const ANNOTATION_TYPES = Object.freeze([
  OBJECT_TYPES.box,
  OBJECT_TYPES.marker,
  OBJECT_TYPES.highlight,
  OBJECT_TYPES.arrow,
  OBJECT_TYPES.line,
  OBJECT_TYPES.ellipse,
  OBJECT_TYPES.text,
]);

export const PALETTE = Object.freeze([
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#32ade6', '#007aff', '#5856d6', '#af52de', '#ff2d55',
  '#000000', '#3a3a3c', '#636366', '#8e8e93', '#c7c7cc',
  '#ffffff', '#8b5e34', '#1d7874', '#0b3d91', '#7a1f3d',
]);

/** Acentos de la interfaz: familia cobre/tierra, con una alternativa fría. */
export const ACCENTS = Object.freeze([
  { id: 'cobre', value: '#c66a32' },
  { id: 'ladrillo', value: '#a8453a' },
  { id: 'ocre', value: '#b3862b' },
  { id: 'oliva', value: '#6b7f3a' },
  { id: 'pizarra', value: '#4a6572' },
  { id: 'ciruela', value: '#7d4a63' },
]);

/** Acabados de la mesa de trabajo (los identificadores se conservan). */
export const BACKGROUNDS = Object.freeze([
  { id: 'plain', label: 'Liso' },
  { id: 'gradient', label: 'Viñeta' },
  { id: 'dots', label: 'Puntos' },
  { id: 'grid', label: 'Retícula' },
]);

export const HISTORY_LIMIT = 120;

/** Handle size in screen pixels (kept constant regardless of zoom). */
export const HANDLE_SIZE = 9;
export const HIT_TOLERANCE = 6;
export const MIN_OBJECT_SIZE = 6;
export const ERASER_RADIUS = 14;

export const ZOOM_STEPS = Object.freeze([0.25, 0.35, 0.5, 0.65, 0.8, 0.9, 1, 1.25, 1.5, 2, 3, 4]);

export const EXPORT_DPI_CHOICES = Object.freeze([
  { id: 'screen', label: 'Rápida · 120 ppp', dpi: 120 },
  { id: 'standard', label: 'Estándar · 200 ppp', dpi: 200 },
  { id: 'high', label: 'Alta · 300 ppp', dpi: 300 },
]);

export const PROJECT_FILE_EXTENSION = '.folio';
export const PROJECT_FILE_VERSION = 1;
