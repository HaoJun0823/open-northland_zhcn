import type { MapImportFailure } from '@open-northland/map-import';
import type { LocalImportProgress, PreparedLocalImport } from './convert.js';
import type { LocalMapInput } from './input.js';
import type { LocalSourceRecord } from './source.js';

export interface LocalImportRequest {
  readonly input: LocalMapInput;
  readonly previous?: LocalSourceRecord;
  readonly knownSources?: readonly LocalSourceRecord[];
  readonly installedAt: number;
  readonly irVersion?: number;
}

export type LocalWorkerFailure = MapImportFailure | 'read-failed' | 'worker-failed';
export type LocalImportResponse =
  | { readonly kind: 'progress'; readonly progress: LocalImportProgress }
  | { readonly kind: 'ready'; readonly result: PreparedLocalImport }
  | { readonly kind: 'failed'; readonly failure: LocalWorkerFailure; readonly message: string };
