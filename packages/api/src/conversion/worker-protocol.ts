import type { MapImportFailure } from '@open-northland/map-import';
import type { ArchiveConversion } from './convert.js';

export interface ConversionJob {
  readonly bytes: Uint8Array;
  readonly entryId: string;
}

export type ConversionReply =
  | { readonly kind: 'warning'; readonly message: string }
  | { readonly kind: 'result'; readonly conversion: ArchiveConversion }
  | { readonly kind: 'failure'; readonly reason: MapImportFailure; readonly message: string };
