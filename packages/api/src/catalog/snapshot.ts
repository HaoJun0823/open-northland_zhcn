import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Catalog, catalogBrowseEntry } from '@open-northland/data';

/** A response body with its validator. */
export interface Body {
  readonly bytes: Buffer;
  readonly gzip?: Body;
  /** A strong `ETag`: the quoted SHA-256 of the bytes. */
  readonly etag: string;
}

/** How many entries carry each conversion verdict, for the health endpoint. */
export interface ConversionCounts {
  readonly converted: number;
  readonly pending: number;
  readonly failed: number;
}

/** The catalogue as served: the whole list and each entry, encoded once per publish. */
export interface CatalogSnapshot {
  readonly catalog: Body;
  readonly entries: ReadonlyMap<string, Body>;
  readonly syncedAt: Date;
  readonly conversions: ConversionCounts;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function bytesBody(bytes: Buffer): Body {
  return { bytes, etag: `"${sha256Hex(bytes)}"` };
}

export function jsonBody(value: unknown): Body {
  return bytesBody(Buffer.from(JSON.stringify(value)));
}

function conversionCounts(catalog: Catalog): ConversionCounts {
  const counts = { converted: 0, pending: 0, failed: 0 };
  for (const { conversion } of catalog) {
    if (conversion?.verdict === 'ok') counts.converted += 1;
    else if (conversion?.verdict === 'pending') counts.pending += 1;
    else if (conversion?.verdict === 'failed') counts.failed += 1;
  }
  return counts;
}

function compressedCatalog(catalog: Catalog): Body {
  const body = jsonBody(catalog.map(catalogBrowseEntry));
  return { ...body, gzip: bytesBody(gzipSync(body.bytes)) };
}

export function catalogSnapshot(catalog: Catalog, syncedAt: Date): CatalogSnapshot {
  return {
    catalog: compressedCatalog(catalog),
    entries: new Map(catalog.map((entry) => [entry.id, jsonBody(entry)])),
    syncedAt,
    conversions: conversionCounts(catalog),
  };
}

/** Parses stored or freshly written catalogue text; a file that fails the schema throws. */
export function parseCatalog(text: string): Catalog {
  return Catalog.parse(JSON.parse(text));
}
