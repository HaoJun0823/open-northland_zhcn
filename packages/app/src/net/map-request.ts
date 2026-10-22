import { RelayRefusal } from '@open-northland/net-client';
import { type ServerMessage, TRANSFER_REQUEST_COOLDOWN_MS } from '@open-northland/net-protocol';

/** Why an open request settles without the map: its page or room moved on. */
const ABANDONED = 'The map request was abandoned';

interface OpenRequest {
  readonly promise: Promise<string>;
  readonly resolve: (bytes: string) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * The request for the started room's map from the relay's kept copy, for a client that lost its own.
 * `request` answers the `map` blob's text, or rejects with the relay's refusal. A replaced socket
 * forgets the request on both ends, so `relinked` sends an open one again.
 */
export function relayMapRequest(client: { requestMap(): void }) {
  let open: OpenRequest | null = null;
  let retried = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const send = (): void => {
    clearTimeout(retry);
    retry = undefined;
    client.requestMap();
  };
  const settle = (): OpenRequest | null => {
    clearTimeout(retry);
    retry = undefined;
    const settled = open;
    open = null;
    return settled;
  };
  return {
    request(): Promise<string> {
      if (open !== null) return open.promise;
      let resolve: (bytes: string) => void = () => undefined;
      let reject: (error: unknown) => void = () => undefined;
      const promise = new Promise<string>((onMap, onRefusal) => {
        resolve = onMap;
        reject = onRefusal;
      });
      open = { promise, resolve, reject };
      retried = false;
      send();
      return promise;
    },
    /** Takes the relay's answer to an open request; true when `message` was that answer. */
    observe(message: ServerMessage): boolean {
      if (open === null) return false;
      if (message.kind === 'blob' && message.type === 'map') {
        settle()?.resolve(message.bytes);
        return true;
      }
      if (message.kind !== 'rejected' || message.of !== 'requestMap') return false;
      if (message.reason.code === 'retryTooSoon' && !retried) {
        retried = true;
        clearTimeout(retry);
        // A socket replaced meanwhile is the same member to the relay, so its cooldown still holds.
        retry = setTimeout(send, TRANSFER_REQUEST_COOLDOWN_MS);
      } else settle()?.reject(new RelayRefusal(message.reason));
      return true;
    },
    /** The relay welcomed a new socket. */
    relinked(): void {
      if (open === null) return;
      retried = false;
      send();
    },
    cancel(): void {
      settle()?.reject(new Error(ABANDONED));
    },
  };
}

export type RelayMapRequest = ReturnType<typeof relayMapRequest>;
