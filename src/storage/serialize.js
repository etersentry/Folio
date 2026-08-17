import { PROJECT_FILE_VERSION } from '../core/constants.js';
import { blobToDataUrl, dataUrlToBlob, deepClone } from '../core/util.js';
import { usedAssetIds } from '../document/model.js';

/**
 * Two serialisation targets:
 *   • IndexedDB — keeps image blobs as-is (fast, no base64 bloat)
 *   • .folio file — a self-contained JSON with base64 images
 * Both round-trip sections, pages, objects, geometry, styles and z-order.
 */

/** Document → record safe to store in IndexedDB. */
export function toRecord(doc, extra = {}) {
  const used = usedAssetIds(doc);
  const assets = {};
  for (const [id, asset] of Object.entries(doc.assets)) {
    if (!used.has(id)) continue; // never persist orphans
    assets[id] = { id, mime: asset.mime, width: asset.width, height: asset.height, name: asset.name, blob: asset.blob };
  }
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: Date.now(),
    version: PROJECT_FILE_VERSION,
    sections: deepClone(doc.sections),
    assets,
    ...extra,
  };
}

/** IndexedDB record → live document. */
export function fromRecord(record) {
  return {
    id: record.id,
    name: record.name ?? 'Proyecto sin título',
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
    sections: record.sections ?? [],
    assets: record.assets ?? {},
  };
}

/** Document → portable JSON string (.folio). */
export async function toFileJson(doc) {
  const used = usedAssetIds(doc);
  const assets = {};
  for (const [id, asset] of Object.entries(doc.assets)) {
    if (!used.has(id)) continue;
    assets[id] = {
      id,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      name: asset.name,
      data: await blobToDataUrl(asset.blob),
    };
  }
  return JSON.stringify({
    format: 'folio-project',
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    document: {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      updatedAt: Date.now(),
      sections: doc.sections,
    },
    assets,
  }, null, 0);
}

/** Portable JSON → live document (throws on malformed input). */
export async function fromFileJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un proyecto Folio válido');
  }
  if (parsed?.format !== 'folio-project' || !parsed.document?.sections) {
    throw new Error('El archivo no es un proyecto Folio válido');
  }
  if (Number(parsed.version) > PROJECT_FILE_VERSION) {
    throw new Error('El proyecto fue creado con una versión más reciente de Folio');
  }

  const assets = {};
  for (const [id, asset] of Object.entries(parsed.assets ?? {})) {
    assets[id] = {
      id,
      mime: asset.mime ?? 'image/png',
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      name: asset.name ?? 'imagen',
      blob: await dataUrlToBlob(asset.data),
    };
  }

  const doc = parsed.document;
  return {
    id: doc.id,
    name: doc.name ?? 'Proyecto sin título',
    createdAt: doc.createdAt ?? Date.now(),
    updatedAt: doc.updatedAt ?? Date.now(),
    sections: doc.sections,
    assets,
  };
}

/** Rough byte size of a document, for storage warnings. */
export function estimateSize(doc) {
  let bytes = JSON.stringify(doc.sections).length;
  for (const asset of Object.values(doc.assets)) bytes += asset.blob?.size ?? 0;
  return bytes;
}
