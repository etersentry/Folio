import { Emitter } from '../core/emitter.js';
import { debounce } from '../core/util.js';
import {
  STORE_PROJECTS, dbPut, dbGet, dbGetAll, dbDelete,
  metaGet, metaSet, isQuotaError, isSupported, storageEstimate,
} from './db.js';
import { toRecord, fromRecord, toFileJson, fromFileJson, estimateSize } from './serialize.js';
import {
  supportsFsAccess, pickSaveHandle, pickOpenHandle,
  ensureWritable, writeToHandle, readHandle, downloadProject,
} from './fileAccess.js';

const SESSION_KEY = 'session';
const AUTOSAVE_DELAY = 1400;

/**
 * Local-first persistence:
 *   • every edit is autosaved to IndexedDB (crash/reload recovery)
 *   • "Guardar" writes the editable .folio file (File System Access API when
 *     available, download otherwise) and refreshes the IndexedDB copy
 * Failures are always surfaced — an autosave that runs out of space must never
 * pass unnoticed.
 */
export class ProjectService extends Emitter {
  #store;
  #dirty = false;
  #savingPromise = null;
  #fileHandle = null;
  #lastSavedAt = null;
  #storageBroken = false;
  #quotaWarned = false;

  constructor({ store }) {
    super();
    this.#store = store;
    this.autosave = debounce(() => this.#runAutosave(), AUTOSAVE_DELAY);

    store.on('change', ({ live, reason }) => {
      if (live || reason === 'navigate' || reason === 'load') return;
      this.markDirty();
    });
  }

  get dirty() { return this.#dirty; }
  get lastSavedAt() { return this.#lastSavedAt; }
  get fileName() { return this.#fileHandle?.name ?? null; }
  get available() { return isSupported(); }

  markDirty() {
    this.#dirty = true;
    this.emit('status', { state: 'dirty' });
    this.autosave();
  }

  #markClean(state = 'saved') {
    this.#dirty = false;
    this.#lastSavedAt = Date.now();
    this.emit('status', { state, at: this.#lastSavedAt });
  }

  /* ── Boot / recovery ───────────────────────────────────────────────── */

  /** Returns the recoverable session record, if any. */
  async findRecoverableSession() {
    if (!isSupported()) return null;
    try {
      const session = await metaGet(SESSION_KEY);
      if (!session?.projectId) return null;
      const record = await dbGet(STORE_PROJECTS, session.projectId);
      if (!record?.sections?.length) return null;
      return { record, session };
    } catch (err) {
      console.warn('[folio] no se pudo leer la sesión anterior', err);
      return null;
    }
  }

  async adoptSession(record) {
    const doc = fromRecord(record);
    this.#fileHandle = await metaGet(`handle:${record.id}`, null);
    this.#store.load(doc);
    this.#markClean('recovered');
    return doc;
  }

  /* ── Autosave ──────────────────────────────────────────────────────── */

  async #runAutosave() {
    if (!isSupported()) {
      this.#reportStorageProblem(new Error('Este navegador no permite guardar localmente'));
      return;
    }
    try {
      await this.#writeRecord();
      this.#markClean('autosaved');
      this.#storageBroken = false;
      await this.#checkQuota();
    } catch (err) {
      this.#reportStorageProblem(err);
    }
  }

  async #writeRecord() {
    const doc = this.#store.doc;
    this.#store.pruneAssets();
    const record = toRecord(doc);
    await dbPut(STORE_PROJECTS, record);
    await metaSet(SESSION_KEY, { projectId: doc.id, at: Date.now(), name: doc.name });
    return record;
  }

  async #checkQuota() {
    const estimate = await storageEstimate();
    if (!estimate || estimate.ratio < 0.85) { this.#quotaWarned = false; return; }
    if (this.#quotaWarned) return;
    this.#quotaWarned = true;
    this.emit('warning', {
      message: 'El almacenamiento local está casi lleno. Guarda el proyecto en un archivo para no perder cambios.',
      estimate,
    });
  }

  #reportStorageProblem(error) {
    this.#storageBroken = true;
    const quota = isQuotaError(error);
    this.emit('status', { state: 'error' });
    this.emit('error', {
      kind: quota ? 'quota' : 'storage',
      message: quota
        ? 'No hay espacio para el autoguardado. Guarda el proyecto en un archivo y libera espacio.'
        : `El autoguardado falló: ${error?.message ?? 'error desconocido'}`,
      error,
    });
  }

  /* ── Explicit save ─────────────────────────────────────────────────── */

  /**
   * Writes the editable project file.
   * @param {{ saveAs?: boolean }} options
   */
  async save({ saveAs = false } = {}) {
    if (this.#savingPromise) return this.#savingPromise;
    this.#savingPromise = this.#doSave({ saveAs }).finally(() => { this.#savingPromise = null; });
    return this.#savingPromise;
  }

  async #doSave({ saveAs }) {
    this.emit('status', { state: 'saving' });
    const doc = this.#store.doc;
    this.#store.pruneAssets();

    // The library copy first: it is the safety net if the file write fails.
    let recordSaved = false;
    try {
      await this.#writeRecord();
      recordSaved = true;
    } catch (err) {
      this.#reportStorageProblem(err);
    }

    const text = await toFileJson(doc);
    let target = 'library';

    try {
      if (supportsFsAccess()) {
        let handle = this.#fileHandle;
        if (saveAs || !handle) handle = await pickSaveHandle(doc.name);
        if (handle) {
          if (!(await ensureWritable(handle))) throw new Error('Permiso de escritura denegado');
          await writeToHandle(handle, text);
          this.#fileHandle = handle;
          await metaSet(`handle:${doc.id}`, handle).catch(() => {});
          target = 'file';
        }
      } else {
        downloadProject(text, doc.name);
        target = 'download';
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        this.emit('status', { state: recordSaved ? 'saved' : 'error' });
        return { cancelled: true, target: null };
      }
      this.emit('error', { kind: 'file', message: `No se pudo escribir el archivo: ${err.message}`, error: err });
      if (!recordSaved) throw err;
    }

    this.#markClean('saved');
    return { cancelled: false, target, size: estimateSize(doc) };
  }

  /* ── Open ──────────────────────────────────────────────────────────── */

  async openFromFilePicker() {
    if (!supportsFsAccess()) return null;
    const handle = await pickOpenHandle();
    if (!handle) return null;
    const text = await readHandle(handle);
    const doc = await fromFileJson(text);
    this.#fileHandle = handle;
    await this.#adopt(doc);
    return doc;
  }

  async openFromFile(file) {
    const doc = await fromFileJson(await file.text());
    this.#fileHandle = null;
    await this.#adopt(doc);
    return doc;
  }

  async openFromLibrary(projectId) {
    const record = await dbGet(STORE_PROJECTS, projectId);
    if (!record) throw new Error('El proyecto ya no está en la biblioteca local');
    const doc = fromRecord(record);
    this.#fileHandle = await metaGet(`handle:${projectId}`, null);
    this.#store.load(doc);
    this.#markClean('saved');
    await metaSet(SESSION_KEY, { projectId: doc.id, at: Date.now(), name: doc.name }).catch(() => {});
    return doc;
  }

  async #adopt(doc) {
    this.#store.load(doc);
    try {
      await this.#writeRecord();
      this.#markClean('saved');
    } catch (err) {
      this.#reportStorageProblem(err);
    }
  }

  /* ── Library ───────────────────────────────────────────────────────── */

  async list() {
    if (!isSupported()) return [];
    try {
      const all = await dbGetAll(STORE_PROJECTS);
      return all
        .map((record) => ({
          id: record.id,
          name: record.name,
          updatedAt: record.updatedAt,
          pages: (record.sections ?? []).reduce((sum, s) => sum + s.pages.length, 0),
          images: Object.keys(record.assets ?? {}).length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async remove(projectId) {
    await dbDelete(STORE_PROJECTS, projectId);
    const session = await metaGet(SESSION_KEY);
    if (session?.projectId === projectId) await metaSet(SESSION_KEY, null);
  }

  /** Starts tracking a brand-new document (called after store.load). */
  async adoptNew() {
    this.#fileHandle = null;
    this.#quotaWarned = false;
    try {
      await this.#writeRecord();
      this.#markClean('saved');
    } catch (err) {
      this.#reportStorageProblem(err);
    }
  }

  get storageBroken() { return this.#storageBroken; }
}
