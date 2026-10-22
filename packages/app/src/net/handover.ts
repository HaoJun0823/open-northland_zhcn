import type { InitialSaveIdentity } from '@open-northland/lockstep';
import type { VerifiedMapDocuments } from '../content/transfer/index.js';
import type { NetworkConnection } from './connection.js';

export interface NetworkHandover {
  readonly connection: NetworkConnection;
  readonly map: VerifiedMapDocuments;
  readonly initialSave: { readonly identity: InitialSaveIdentity; readonly bytes: string } | null;
}

let pending: { readonly handover: NetworkHandover; readonly abandoned: (error: unknown) => void } | null =
  null;

/** `abandoned` hears when the entry meant to take the handover failed to load, so its stager takes
 *  the connection back. */
export function stageNetworkHandover(handover: NetworkHandover, abandoned: (error: unknown) => void): void {
  if (pending !== null) throw new Error('A network game is already starting');
  pending = { handover, abandoned };
}

export function takeNetworkHandover(): NetworkHandover | null {
  const result = pending;
  pending = null;
  return result?.handover ?? null;
}

/** The entry a handover was staged for never loaded: nobody will take it now. */
export function abandonNetworkHandover(error: unknown): void {
  const result = pending;
  pending = null;
  result?.abandoned(error);
}
