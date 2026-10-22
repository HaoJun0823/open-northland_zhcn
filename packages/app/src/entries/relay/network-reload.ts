import { compatibilityIssues } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../content/lobby-identity.js';
import { loadRoomMapDocuments } from '../../content/transfer/index.js';
import { messages } from '../../i18n/index.js';
import { NetworkConnection } from '../../net/connection.js';
import { relayCloseText, relayFailureText, relayReasonText } from '../../net/relay-reason.js';
import { dismissBootProgress, mountBootProgress } from '../../view/boot-progress.js';
import { compatibilityIssuesText } from './compatibility.js';
import { relayIdentity } from './identity.js';
import { keptView } from './kept-view.js';
import { mountHaltNotice } from './menu-notice.js';
import { renderNetworkGame } from './network-game.js';
import { wrongReconnectRoom } from './reload-message.js';
import { closeKeepsSeat, keptSeat } from './seat-surrender.js';

/** A document reload recreates the connection while the runtime still restores the relay snapshot. */
export function renderNetworkReload(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const url = params.get('relay');
  const roomId = params.get('room');
  if (url === null || roomId === null) throw new Error('Missing multiplayer reconnect address');
  const connection = new NetworkConnection(url, relayIdentity(url, params.get('nick')));
  let closed = false;
  let opening = false;
  let handedOff = false;
  // Nothing here gives the seat up: the halt notice's Leave is the player's own way to.
  const dispose = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (!handedOff) connection.dispose(false);
  };
  /** `seatKept` says the relay may still hold this client's seat, which the notice then offers back. */
  const fail = (error: unknown, seatKept = true) => {
    if (closed) return;
    dispose();
    dismissBootProgress();
    mountHaltNotice(messages().networkRelay.openFailed, relayFailureText(error), {
      onCard: false,
      seat: seatKept ? keptSeat(url, connection.identity, roomId) : null,
      view: keptView(url, roomId),
    });
  };
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'link' && event.state === 'closed') {
      fail(relayCloseText(event.reason), closeKeepsSeat(event.reason));
      return;
    }
    if (event.kind === 'failure') {
      // A refused rejoin lost the room, so no seat is left to offer back.
      fail(event.error, event.what !== 'room');
      return;
    }
    if (event.kind !== 'message') return;
    const message = event.message;
    if (wrongReconnectRoom(message, roomId)) {
      fail(messages().networkRelay.reconnectOtherRoom, false);
      return;
    }
    if (message.kind === 'welcome') connection.client.joinRoom(roomId);
    if (message.kind === 'left' || message.kind === 'error' || message.kind === 'rejected') {
      fail(message.kind === 'left' ? messages().net.roomEnded : relayReasonText(message.reason), false);
      return;
    }
    if (message.kind !== 'start' || opening) return;
    opening = true;
    void (async () => {
      const room = connection.client.room;
      if (room === null) throw new Error('Missing reconnect room');
      // The verify blocks the page; the world's boot then mounts its own steps over this card.
      await mountBootProgress(['verify']).begin('verify');
      if (closed) return;
      const map = await loadRoomMapDocuments(room);
      if (closed) return;
      if (map === null) throw new Error(messages().network.missingMap);
      const report = await loadLobbyCompatibility(map.mapId, fetch, undefined, map);
      if (closed) return;
      const members = room.members.filter((member) => member.nick !== connection.client.nick);
      const issues = compatibilityIssues(
        [
          ...members,
          {
            nick: connection.client.nick,
            compatibility: { ...report, save: room.settings.initialSave?.fingerprint ?? null },
          },
        ],
        room.creator,
        room.settings.initialSave,
      );
      if (issues.length > 0) throw new Error(compatibilityIssuesText(issues));
      handedOff = true;
      dispose();
      try {
        renderNetworkGame(canvas, params, { connection, map, initialSave: null });
      } catch (error) {
        closed = false;
        handedOff = false;
        fail(error);
      }
    })().catch((error: unknown) => fail(error));
  });
  window.addEventListener(
    'pagehide',
    () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      connection.dispose(false);
    },
    { once: true },
  );
}
