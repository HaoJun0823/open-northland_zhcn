import { MapImportError } from '@open-northland/map-import';
import { errorMessage } from '../log.js';
import { ResponseTooLargeError, readCappedBody } from '../upstream/body.js';
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

/** The file at `url`, refused as `too-large` past `maxBytes` whether declared or received. */
export async function downloadArchive(
  fetchFn: Fetch,
  url: string,
  limits: DownloadLimits,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    const response = await fetchFn(url, {
      redirect: 'error',
      signal:
        signal === undefined
          ? AbortSignal.timeout(limits.timeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new DownloadError(`${url} answered ${response.status}`);
    }
    const declared = declaredLength(response);
    if (declared !== null && declared > limits.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new MapImportError('too-large', `${url}: declares ${declared} bytes, over ${limits.maxBytes}`);
    }
    const bytes = await readCappedBody(response, limits.maxBytes);
    if (declared !== null && bytes.byteLength !== declared) {
      throw new DownloadError(`${url}: received ${bytes.byteLength} of ${declared} declared bytes`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof ResponseTooLargeError)
      throw new MapImportError('too-large', `${url}: more than ${limits.maxBytes} bytes`);
    if (error instanceof MapImportError || error instanceof DownloadError) throw error;
    throw new DownloadError(`${url}: ${errorMessage(error)}`);
  }
}
