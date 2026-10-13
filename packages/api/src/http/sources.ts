import type { FileHandle } from 'node:fs/promises';

/** One stored sidecar: its file, whether that file is gzip-compressed, and the validator of the
 *  uncompressed bytes. */
export interface ContentFile {
  readonly handle: FileHandle;
  readonly gzipped: boolean;
  readonly etag: string;
}

/** The converted maps of one IR version, by map id and sidecar file name. */
export interface ContentSource {
  readonly irVersion: number;
  /** The caller closes a returned handle, including for HEAD and conditional requests. */
  file(mapId: string, fileName: string): Promise<ContentFile | null>;
}

/** A kept catalogue file as downloaded, with the name its upstream URL gave it. */
export interface KeptFile {
  readonly handle: FileHandle;
  readonly sha256: string;
  readonly name: string;
}

/** The kept catalogue files by entry id; null when none is kept or it no longer matches its hash. */
export interface KeptFileSource {
  /** The caller closes the verified handle, including for HEAD and conditional requests. */
  keptFile(entryId: string, signal?: AbortSignal): Promise<KeptFile | null>;
}
