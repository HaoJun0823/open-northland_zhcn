/** Why an import produced no map: the caller maps each kind to its own answer. */
export type MapImportFailure = 'no-map' | 'decode-failed' | 'unsupported-archive' | 'too-large';

/** A typed import failure; `message` names the file and, for `decode-failed`, the decoder's reason. */
export class MapImportError extends Error {
  constructor(
    readonly kind: MapImportFailure,
    message: string,
  ) {
    super(message);
    this.name = 'MapImportError';
  }
}

/** A thrown value's message, whatever was thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
