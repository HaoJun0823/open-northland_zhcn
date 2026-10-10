import { createHash } from 'node:crypto';
import { Catalog } from '@open-northland/data';

/** A response body with its validator. */
export interface Body {
  readonly bytes: Buffer;
  /** A strong `ETag`: the quoted SHA-256 of the bytes. */
  readonly etag: string;
}

/** The catalogue as served: the whole list and each entry, encoded once per sync. */
export interface CatalogSnapshot {
  readonly catalog: Body;
  readonly entries: ReadonlyMap<string, Body>;
  readonly syncedAt: Date;
}

export function bytesBody(bytes: Buffer): Body {
  return { bytes, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
}

export function jsonBody(value: unknown): Body {
  return bytesBody(Buffer.from(JSON.stringify(value)));
}

/** Parses stored or freshly written catalogue text; a file that fails the schema throws. */
export function catalogSnapshot(text: string, syncedAt: Date): CatalogSnapshot {
  const catalog = Catalog.parse(JSON.parse(text));
  return {
    catalog: jsonBody(catalog),
    entries: new Map(catalog.map((entry) => [entry.id, jsonBody(entry)])),
    syncedAt,
  };
}
