import { MapScript, mapDocumentsFingerprint, parseTerrainMap } from '@open-northland/data';
import { MAX_BLOB_BYTES } from '@open-northland/net-protocol';

export const MAX_MAP_TRANSFER_BYTES = MAX_BLOB_BYTES;
// A map too large for the relay can still be verified and played locally.
export const MAX_MAP_DOCUMENT_BYTES = 64 * 1024 * 1024;
export interface VerifiedMapDocuments {
  readonly mapId: string;
  readonly fingerprint: string;
}
interface Documents {
  readonly map: unknown;
  readonly script: unknown;
}
/** The boot inputs parsed from the documents, shared by every reader of one verified handle. */
interface ParsedDocuments {
  readonly map: ReturnType<typeof parseTerrainMap>;
  readonly script: ReturnType<typeof MapScript.parse> | null;
}
interface Retained {
  readonly raw: Documents;
  readonly parsed: ParsedDocuments;
}
const retained = new WeakMap<VerifiedMapDocuments, Retained>();

/** A map id names a file on every peer, so it is one plain ASCII token. */
export function isMapId(mapId: string): boolean {
  return /^[a-z0-9_-]{1,128}$/i.test(mapId);
}

export function validMapId(mapId: string): void {
  if (!isMapId(mapId)) throw new Error('Invalid lobby map id');
}

/** Frozen through, so no reader of a shared parse can change what the next one boots from. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/** Own the exact raw documents whose fingerprint was verified, including unknown script fields. */
export function verifyMapDocuments(mapId: string, map: unknown, script: unknown): VerifiedMapDocuments {
  validMapId(mapId);
  const text = JSON.stringify({ map, script });
  if (
    text.length > MAX_MAP_DOCUMENT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_MAP_DOCUMENT_BYTES
  ) {
    throw new Error('Map documents exceed local size limit');
  }
  const raw: Documents = JSON.parse(text);
  const parsed = deepFreeze({
    map: parseTerrainMap(raw.map),
    script: raw.script === null ? null : MapScript.parse(raw.script),
  });
  const handle = Object.freeze({ mapId, fingerprint: mapDocumentsFingerprint(raw) });
  retained.set(handle, { raw, parsed });
  return handle;
}

function retainedOf(handle: VerifiedMapDocuments): Retained {
  const value = retained.get(handle);
  if (value === undefined) throw new Error('Unverified map documents');
  return value;
}

/** The verified raw documents themselves, for the transfer envelope to serialize; never mutate them. */
export function rawVerifiedMapDocuments(handle: VerifiedMapDocuments): Documents {
  return retainedOf(handle).raw;
}

/** The boot inputs, parsed once at verification and frozen. */
export function readVerifiedMapDocuments(
  handle: VerifiedMapDocuments,
  mapId: string = handle.mapId,
): ParsedDocuments {
  if (handle.mapId !== mapId) throw new Error('Verified map does not match boot map');
  return retainedOf(handle).parsed;
}

async function readDocument(path: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot read ${path}: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_MAP_DOCUMENT_BYTES) throw new Error('Map document exceeds local size limit');
  if (response.body === null) throw new Error('Empty map document');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MAP_DOCUMENT_BYTES) throw new Error('Map document exceeds local size limit');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function loadVerifiedMapDocuments(
  mapId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedMapDocuments | null> {
  validMapId(mapId);
  const [map, script] = await Promise.all([
    readDocument(`/maps/${mapId}.json`, fetchImpl),
    readDocument(`/maps/${mapId}.script.json`, fetchImpl),
  ]);
  return map === null ? null : verifyMapDocuments(mapId, map, script);
}
