import type { RoomView } from '@open-northland/net-protocol';
import { messages } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { button } from './controls.js';
import type { NetworkRoomDeps } from './types.js';

/** Observers occupy no map seat. One free row always follows the occupied rows. */
export function roomObservers({ client, copy }: NetworkRoomDeps) {
  const text = messages().mainMenu.lobby;
  const root = node('section', 'network-room__observers');
  const list = node('div');
  const free = node('div', 'network-room__observer');
  const join = button(text.choose, () => client.claimSeat(null));
  const label = node('div');
  label.append(node('strong', '', text.observerName), node('p', 'network-room__muted', text.observerDetail));
  free.append(label, join);
  root.append(node('h3', '', text.watchTitle), list, free);
  return {
    root,
    update(room: RoomView, connected: boolean): void {
      list.replaceChildren(
        ...room.members
          .filter((member) => member.seat === null)
          .map((member) => {
            const row = node('div', 'network-room__observer');
            row.append(node('strong', '', member.nick));
            if (member.nick === client.nick)
              row.append(node('span', 'network-room__badge network-room__badge--you', copy.you));
            if (!member.connected) row.append(node('span', 'network-room__muted', copy.disconnected));
            return row;
          }),
      );
      const self = room.members.find((member) => member.nick === client.nick);
      join.disabled = !connected || room.state !== 'lobby' || self === undefined || self.seat === null;
    },
  };
}
