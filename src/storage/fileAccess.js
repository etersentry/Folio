import { PROJECT_FILE_EXTENSION } from '../core/constants.js';
import { downloadBlob, sanitizeFileName } from '../core/util.js';

/**
 * File System Access API with graceful degradation: when the API is missing
 * (Firefox, Safari) saving falls back to a download and opening to an
 * `<input type="file">` handled by the caller.
 */
export const supportsFsAccess = () =>
  typeof window !== 'undefined'
  && typeof window.showSaveFilePicker === 'function'
  && typeof window.showOpenFilePicker === 'function';

const PROJECT_TYPES = [{
  description: 'Proyecto Folio',
  accept: { 'application/json': [PROJECT_FILE_EXTENSION, '.json'] },
}];

export async function pickSaveHandle(suggestedName) {
  if (!supportsFsAccess()) return null;
  return window.showSaveFilePicker({
    suggestedName: `${sanitizeFileName(suggestedName)}${PROJECT_FILE_EXTENSION}`,
    types: PROJECT_TYPES,
  });
}

export async function pickOpenHandle() {
  if (!supportsFsAccess()) return null;
  const [handle] = await window.showOpenFilePicker({ types: PROJECT_TYPES, multiple: false });
  return handle ?? null;
}

/** Verifies (and if needed re-requests) write permission for a stored handle. */
export async function ensureWritable(handle) {
  if (!handle?.queryPermission) return false;
  const options = { mode: 'readwrite' };
  if (await handle.queryPermission(options) === 'granted') return true;
  return await handle.requestPermission(options) === 'granted';
}

export async function writeToHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: 'application/json' }));
  await writable.close();
}

export async function readHandle(handle) {
  const file = await handle.getFile();
  return file.text();
}

/** Fallback path when the File System Access API is unavailable. */
export function downloadProject(text, name) {
  downloadBlob(
    new Blob([text], { type: 'application/json' }),
    `${sanitizeFileName(name, 'proyecto')}${PROJECT_FILE_EXTENSION}`,
  );
}
