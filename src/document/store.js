import { Emitter } from '../core/emitter.js';
import { deepClone, uid } from '../core/util.js';
import { History } from './history.js';
import {
  createDocument, createPage, createSection,
  findPage, findSection, allPages, pageCount, usedAssetIds,
} from './model.js';

/**
 * Holds the document, the selection and the undo stack, and is the only place
 * that mutates document state. UI and canvas layers subscribe to its events:
 *
 *   change     { reason, live }  — document content changed
 *   structure  {}                — sections/pages added, removed or reordered
 *   selection  { ids }
 *   history    { canUndo, canRedo }
 *   page       { pageId }        — active page changed
 */
export class DocumentStore extends Emitter {
  #doc;
  #activePageId;
  #selection = new Set();
  #history = new History();
  #live = null;

  constructor(doc = createDocument()) {
    super();
    this.#doc = doc;
    this.#activePageId = doc.sections[0]?.pages[0]?.id ?? null;
  }

  /* ── Accessors ─────────────────────────────────────────────────────── */

  get doc() { return this.#doc; }
  get sections() { return this.#doc.sections; }
  get activePageId() { return this.#activePageId; }
  get canUndo() { return this.#history.canUndo; }
  get canRedo() { return this.#history.canRedo; }
  get selectionIds() { return [...this.#selection]; }

  get activePage() {
    return findPage(this.#doc, this.#activePageId)?.page ?? null;
  }

  get activeSection() {
    return findPage(this.#doc, this.#activePageId)?.section ?? null;
  }

  get selectedObjects() {
    const page = this.activePage;
    if (!page) return [];
    return page.objects.filter((o) => this.#selection.has(o.id));
  }

  getAsset(assetId) { return this.#doc.assets[assetId] ?? null; }
  get assets() { return this.#doc.assets; }

  get stats() {
    return {
      sections: this.#doc.sections.length,
      pages: pageCount(this.#doc),
      objects: allPages(this.#doc).reduce((sum, p) => sum + p.objects.length, 0),
    };
  }

  /* ── Document lifecycle ────────────────────────────────────────────── */

  /** Replaces the whole document (new / open / recover). */
  load(doc, { pageId = null, resetHistory = true } = {}) {
    this.#doc = doc;
    this.#selection.clear();
    if (resetHistory) this.#history.clear();
    this.#activePageId = pageId && findPage(doc, pageId)
      ? pageId
      : doc.sections[0]?.pages[0]?.id ?? null;
    this.emit('structure', {});
    this.emit('page', { pageId: this.#activePageId });
    this.emit('selection', { ids: [] });
    this.#emitHistory();
    this.emit('change', { reason: 'load', live: false, structural: true });
  }

  rename(name) {
    if (this.#doc.name === name) return;
    this.#doc.name = name;
    this.emit('change', { reason: 'rename', live: false, structural: false });
  }

  /* ── History ───────────────────────────────────────────────────────── */

  #snapshot() {
    return { sections: deepClone(this.#doc.sections), activePageId: this.#activePageId };
  }

  #restore(snapshot) {
    this.#doc.sections = snapshot.sections;
    const stillThere = snapshot.activePageId && findPage(this.#doc, snapshot.activePageId);
    this.#activePageId = stillThere ? snapshot.activePageId : this.#doc.sections[0]?.pages[0]?.id ?? null;
    this.#pruneSelection();
    this.emit('structure', {});
    this.emit('page', { pageId: this.#activePageId });
    this.#emitHistory();
    this.emit('change', { reason: 'history', live: false, structural: true });
  }

  /** Runs `fn`, records one undo step and notifies listeners. */
  transact(reason, fn, { structural = false } = {}) {
    const before = this.#snapshot();
    const result = fn();
    if (result === false) return false; // mutation opted out
    this.#history.push(before);
    this.#doc.updatedAt = Date.now();
    this.#pruneSelection();
    if (structural) this.emit('structure', {});
    this.#emitHistory();
    this.emit('change', { reason, live: false, structural });
    return result;
  }

  /** Drag interactions: snapshot once, repaint often, record on release. */
  beginLive(reason) {
    this.#live = { reason, before: this.#snapshot() };
  }

  live(reason = this.#live?.reason ?? 'drag') {
    this.emit('change', { reason, live: true, structural: false });
  }

  endLive({ changed = true, structural = false } = {}) {
    const live = this.#live;
    this.#live = null;
    if (!live) return;
    if (!changed) {
      this.emit('change', { reason: live.reason, live: false, structural });
      return;
    }
    this.#history.push(live.before);
    this.#doc.updatedAt = Date.now();
    this.#pruneSelection();
    if (structural) this.emit('structure', {});
    this.#emitHistory();
    this.emit('change', { reason: live.reason, live: false, structural });
  }

  cancelLive() {
    const live = this.#live;
    this.#live = null;
    if (live) this.#restore(live.before);
  }

  undo() {
    const snap = this.#history.undo(this.#snapshot());
    if (snap) this.#restore(snap);
    return Boolean(snap);
  }

  redo() {
    const snap = this.#history.redo(this.#snapshot());
    if (snap) this.#restore(snap);
    return Boolean(snap);
  }

  #emitHistory() {
    this.emit('history', { canUndo: this.canUndo, canRedo: this.canRedo });
  }

  /* ── Navigation ────────────────────────────────────────────────────── */

  setActivePage(pageId) {
    if (!pageId || pageId === this.#activePageId) return;
    if (!findPage(this.#doc, pageId)) return;
    this.emit('beforePage', { from: this.#activePageId, to: pageId });
    this.#activePageId = pageId;
    this.clearSelection();
    this.emit('page', { pageId });
    this.emit('change', { reason: 'navigate', live: false, structural: false });
  }

  /** step = +1 / -1 across the flattened page list. */
  stepPage(step) {
    const pages = allPages(this.#doc);
    const index = pages.findIndex((p) => p.id === this.#activePageId);
    const next = pages[index + step];
    if (next) this.setActivePage(next.id);
  }

  /* ── Sections ──────────────────────────────────────────────────────── */

  addSection(name) {
    return this.transact('section:add', () => {
      const section = createSection(name ?? `Sección ${this.#doc.sections.length + 1}`);
      this.#doc.sections.push(section);
      this.#activePageId = section.pages[0].id;
      this.emit('page', { pageId: this.#activePageId });
      return section;
    }, { structural: true });
  }

  renameSection(sectionId, name) {
    const section = findSection(this.#doc, sectionId);
    if (!section || section.name === name) return;
    this.transact('section:rename', () => { section.name = name; }, { structural: true });
  }

  removeSection(sectionId) {
    if (this.#doc.sections.length <= 1) return false;
    return this.transact('section:remove', () => {
      const index = this.#doc.sections.findIndex((s) => s.id === sectionId);
      if (index < 0) return false;
      this.#doc.sections.splice(index, 1);
      if (!findPage(this.#doc, this.#activePageId)) {
        this.#activePageId = this.#doc.sections[0]?.pages[0]?.id ?? null;
        this.emit('page', { pageId: this.#activePageId });
      }
      return true;
    }, { structural: true });
  }

  /** Collapse state is a view preference: no undo entry. */
  toggleSection(sectionId, collapsed) {
    const section = findSection(this.#doc, sectionId);
    if (!section) return;
    section.collapsed = collapsed ?? !section.collapsed;
    this.emit('structure', {});
  }

  moveSection(sectionId, toIndex) {
    return this.transact('section:move', () => {
      const from = this.#doc.sections.findIndex((s) => s.id === sectionId);
      if (from < 0) return false;
      const [section] = this.#doc.sections.splice(from, 1);
      const target = Math.max(0, Math.min(toIndex, this.#doc.sections.length));
      this.#doc.sections.splice(target, 0, section);
      return true;
    }, { structural: true });
  }

  /* ── Pages ─────────────────────────────────────────────────────────── */

  addPage(sectionId = this.activeSection?.id, { afterPageId = null, activate = true } = {}) {
    return this.transact('page:add', () => {
      const section = findSection(this.#doc, sectionId) ?? this.#doc.sections[0];
      if (!section) return false;
      const page = createPage();
      const index = afterPageId ? section.pages.findIndex((p) => p.id === afterPageId) : -1;
      if (index >= 0) section.pages.splice(index + 1, 0, page);
      else section.pages.push(page);
      if (activate) {
        this.#activePageId = page.id;
        this.emit('page', { pageId: page.id });
      }
      return page;
    }, { structural: true });
  }

  duplicatePage(pageId) {
    return this.transact('page:duplicate', () => {
      const found = findPage(this.#doc, pageId);
      if (!found) return false;
      const { section, page } = found;
      const copy = deepClone(page);
      copy.id = uid('pg');
      copy.name = page.name;
      copy.objects = copy.objects.map((o) => ({ ...o, id: uid('ob') }));
      section.pages.splice(section.pages.indexOf(page) + 1, 0, copy);
      this.#activePageId = copy.id;
      this.emit('page', { pageId: copy.id });
      return copy;
    }, { structural: true });
  }

  removePage(pageId) {
    if (pageCount(this.#doc) <= 1) return false;
    return this.transact('page:remove', () => {
      const found = findPage(this.#doc, pageId);
      if (!found) return false;
      const { section, page } = found;
      const pages = allPages(this.#doc);
      const flatIndex = pages.findIndex((p) => p.id === pageId);
      section.pages.splice(section.pages.indexOf(page), 1);
      if (this.#activePageId === pageId) {
        const remaining = allPages(this.#doc);
        const next = remaining[Math.min(flatIndex, remaining.length - 1)];
        this.#activePageId = next?.id ?? null;
        this.emit('page', { pageId: this.#activePageId });
      }
      return true;
    }, { structural: true });
  }

  renamePage(pageId, name) {
    const found = findPage(this.#doc, pageId);
    if (!found || found.page.name === name) return;
    this.transact('page:rename', () => { found.page.name = name; }, { structural: true });
  }

  /**
   * Moves a page inside/between sections (drag & drop).
   * `index` is the destination index **after** the page has been taken out of
   * its current position, which is what the outline computes while dragging.
   */
  movePage(pageId, targetSectionId, index) {
    return this.transact('page:move', () => {
      const found = findPage(this.#doc, pageId);
      const target = findSection(this.#doc, targetSectionId);
      if (!found || !target) return false;
      const { section, page } = found;
      section.pages.splice(section.pages.indexOf(page), 1);
      const to = Math.max(0, Math.min(index, target.pages.length));
      target.pages.splice(to, 0, page);
      return true;
    }, { structural: true });
  }

  /* ── Objects ───────────────────────────────────────────────────────── */

  addObjects(objects, { pageId = this.#activePageId, select = true, reason = 'object:add' } = {}) {
    const list = [].concat(objects);
    if (!list.length) return [];
    return this.transact(reason, () => {
      const found = findPage(this.#doc, pageId);
      if (!found) return false;
      found.page.objects.push(...list);
      if (select) this.#setSelection(list.map((o) => o.id));
      return list;
    });
  }

  /** Adds an object without an undo entry — used while drawing (see endLive). */
  addObjectLive(object, pageId = this.#activePageId) {
    const found = findPage(this.#doc, pageId);
    if (!found) return null;
    found.page.objects.push(object);
    return object;
  }

  removeObjects(ids, { reason = 'object:remove' } = {}) {
    const idSet = new Set([].concat(ids));
    if (!idSet.size) return false;
    return this.transact(reason, () => {
      const page = this.activePage;
      if (!page) return false;
      const before = page.objects.length;
      page.objects = page.objects.filter((o) => !idSet.has(o.id));
      if (page.objects.length === before) return false;
      for (const id of idSet) this.#selection.delete(id);
      this.emit('selection', { ids: this.selectionIds });
      return true;
    });
  }

  /** Applies a patch (or patch function) to every object in `ids`. */
  updateObjects(ids, patch, { reason = 'object:update', live = false } = {}) {
    const idSet = new Set([].concat(ids));
    if (!idSet.size) return false;
    const apply = () => {
      const page = this.activePage;
      if (!page) return false;
      let touched = false;
      for (const obj of page.objects) {
        if (!idSet.has(obj.id)) continue;
        const delta = typeof patch === 'function' ? patch(obj) : patch;
        if (!delta) continue;
        Object.assign(obj, delta);
        touched = true;
      }
      return touched;
    };
    if (live) {
      const touched = apply();
      if (touched) this.live(reason);
      return touched;
    }
    return this.transact(reason, apply);
  }

  duplicateObjects(ids, offset = 18) {
    const idSet = new Set([].concat(ids));
    if (!idSet.size) return false;
    return this.transact('object:duplicate', () => {
      const page = this.activePage;
      if (!page) return false;
      const copies = page.objects.filter((o) => idSet.has(o.id)).map((o) => {
        const copy = deepClone(o);
        copy.id = uid('ob');
        if (copy.x !== undefined) { copy.x += offset; copy.y += offset; }
        if (copy.x1 !== undefined) { copy.x1 += offset; copy.y1 += offset; copy.x2 += offset; copy.y2 += offset; }
        return copy;
      });
      if (!copies.length) return false;
      page.objects.push(...copies);
      this.#setSelection(copies.map((o) => o.id));
      return copies;
    });
  }

  /** where: 'front' | 'forward' | 'backward' | 'back' */
  reorderObjects(ids, where) {
    const idSet = new Set([].concat(ids));
    if (!idSet.size) return false;
    return this.transact('object:reorder', () => {
      const page = this.activePage;
      if (!page) return false;
      const objects = page.objects;
      const moving = objects.filter((o) => idSet.has(o.id));
      if (!moving.length) return false;
      const rest = objects.filter((o) => !idSet.has(o.id));

      if (where === 'front') page.objects = [...rest, ...moving];
      else if (where === 'back') page.objects = [...moving, ...rest];
      else {
        const dir = where === 'forward' ? 1 : -1;
        const next = [...objects];
        const indices = moving.map((o) => next.indexOf(o));
        indices.sort((a, b) => (dir > 0 ? b - a : a - b));
        for (const index of indices) {
          const swap = index + dir;
          if (swap < 0 || swap >= next.length || idSet.has(next[swap].id)) continue;
          [next[index], next[swap]] = [next[swap], next[index]];
        }
        page.objects = next;
      }
      return true;
    });
  }

  /* ── Low-level access ──────────────────────────────────────────────── */

  /**
   * Multi-step operations (image import) need to create pages *and* objects
   * inside a single undo entry. These raw helpers mutate without recording
   * history; call them from inside `transact`.
   */
  rawAddPage(sectionId, { afterPageId = null } = {}) {
    const section = findSection(this.#doc, sectionId) ?? this.#doc.sections[0];
    if (!section) return null;
    const page = createPage();
    const index = afterPageId ? section.pages.findIndex((p) => p.id === afterPageId) : -1;
    if (index >= 0) section.pages.splice(index + 1, 0, page);
    else section.pages.push(page);
    return page;
  }

  rawAddObjects(pageId, objects) {
    const found = findPage(this.#doc, pageId);
    if (!found) return false;
    found.page.objects.push(...[].concat(objects));
    return true;
  }

  rawSetActivePage(pageId) {
    if (!findPage(this.#doc, pageId)) return;
    this.#activePageId = pageId;
    this.emit('page', { pageId });
  }

  rawSelect(ids) {
    this.#setSelection([].concat(ids));
  }

  /* ── Assets ────────────────────────────────────────────────────────── */

  addAsset(asset) {
    this.#doc.assets[asset.id] = asset;
    return asset;
  }

  /** Drops assets no page references any more (called before saving). */
  pruneAssets() {
    const used = usedAssetIds(this.#doc);
    let removed = 0;
    for (const id of Object.keys(this.#doc.assets)) {
      if (!used.has(id)) { delete this.#doc.assets[id]; removed += 1; }
    }
    return removed;
  }

  /* ── Selection ─────────────────────────────────────────────────────── */

  #setSelection(ids) {
    this.#selection = new Set(ids);
    this.emit('selection', { ids: this.selectionIds });
  }

  #pruneSelection() {
    const page = this.activePage;
    const valid = new Set(page ? page.objects.map((o) => o.id) : []);
    let changed = false;
    for (const id of [...this.#selection]) {
      if (!valid.has(id)) { this.#selection.delete(id); changed = true; }
    }
    if (changed) this.emit('selection', { ids: this.selectionIds });
  }

  select(ids, { additive = false } = {}) {
    const list = [].concat(ids ?? []);
    if (additive) {
      for (const id of list) {
        if (this.#selection.has(id)) this.#selection.delete(id);
        else this.#selection.add(id);
      }
      this.emit('selection', { ids: this.selectionIds });
      return;
    }
    const same = list.length === this.#selection.size && list.every((id) => this.#selection.has(id));
    if (same) return;
    this.#setSelection(list);
  }

  selectAll() {
    const page = this.activePage;
    if (page) this.#setSelection(page.objects.map((o) => o.id));
  }

  clearSelection() {
    if (!this.#selection.size) return;
    this.#selection.clear();
    this.emit('selection', { ids: [] });
  }

  isSelected(id) { return this.#selection.has(id); }
}
