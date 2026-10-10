import { MapImportError } from '@open-northland/map-import';
import type { Fetch } from '../upstream/strapi.js';

/** The upstream did not deliver the file: an error status, a dropped connection, a timeout or a body
 *  that disagrees with its declared length. Worth retrying on the next sync. */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

function declaredLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

async function readCapped(response: Response, url: string, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MapImportError('too-large', `${url}: more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The file at `url`, refused as `too-large` past `maxBytes` whether declared or received. */
export async function downloadArchive(
  fetchFn: Fetch,
  url: string,
  limits: DownloadLimits,
): Promise<Uint8Array> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(limits.timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadError(`${url} answered ${response.status}`);
    }
    const declared = declaredLength(response);
    if (declared !== null && declared > limits.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new MapImportError('too-large', `${url}: declares ${declared} bytes, over ${limits.maxBytes}`);
    }
    const bytes = await readCapped(response, url, limits.maxBytes);
    if (declared !== null && bytes.byteLength !== declared) {
      throw new DownloadError(`${url}: received ${bytes.byteLength} of ${declared} declared bytes`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof MapImportError || error instanceof DownloadError) throw error;
    throw new DownloadError(`${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
