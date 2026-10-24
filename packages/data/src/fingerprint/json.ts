import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** Object keys are unordered; array order remains part of the identity. */
export function jsonFingerprint(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(value))));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${Array.from(value, (entry: unknown) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('A fingerprint requires finite, plain JSON data');
}

/** A script's provenance object: where a record came from, not what it says. */
function isProvenance(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).file === 'string'
  );
}

function withoutProvenance(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProvenance);
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    // `source` is also a trigger's condition slot number, which is content and stays.
    if (key === 'source' && isProvenance(entry)) continue;
    out[key] = withoutProvenance(entry);
  }
  return out;
}

/** A map's identity: its terrain and script documents with every `source` provenance object left
 *  out, so one map converted from two folder paths hashes the same. */
export function mapDocumentsFingerprint(documents: {
  readonly map: unknown;
  readonly script: unknown;
}): string {
  return jsonFingerprint(withoutProvenance({ map: documents.map, script: documents.script }));
}
