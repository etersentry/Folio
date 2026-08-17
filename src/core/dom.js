/** Tiny DOM helpers so UI modules stay declarative. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * el('button.btn.sm', { onclick, title }, ['Texto'])
 * Tag syntax supports `tag.class1.class2` and `tag#id`.
 */
export function el(spec, props = {}, children = []) {
  const [head, ...classes] = String(spec).split('.');
  const [tag, id] = head.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.classList.add(...classes);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.classList.add(...String(value).split(/\s+/).filter(Boolean));
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Empties a node atomically (safe even if a blur handler re-enters). */
export function clear(node) {
  if (typeof node.replaceChildren === 'function') node.replaceChildren();
  else while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Inline SVG icon from a path set. */
export function icon(paths, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  for (const d of [].concat(paths)) {
    const isFill = typeof d === 'object';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', isFill ? d.d : d);
    if (isFill && d.fill) {
      path.setAttribute('fill', 'currentColor');
      if (d.opacity) path.setAttribute('opacity', d.opacity);
    } else {
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(path);
  }
  return svg;
}

const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time',
]);

/** True when focus is in a field that consumes typed characters. */
export function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has(target.type);
}

/** True for any form control — sliders and checkboxes own their arrow keys. */
export function isFormControl(target) {
  return target instanceof HTMLElement
    && ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(target.tagName);
}
