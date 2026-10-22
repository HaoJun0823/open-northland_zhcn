# Deliver the room's map to a member that returns after the start without it

**Area:** net-protocol, net-server, app · **Priority:** P3

A map is a lobby transfer. `LobbyTransfers.requestMap` (`relay/lobby-transfers.ts`) forwards a
`mapRequest` to the connected creator, and the protocol refuses a map after Start. A member that
returns to a started room rebuilds its world from the map its browser installed, a delivered blob or
a catalogue download, and `network-reload.ts` throws `network.missingMap` when `loadRoomMapDocuments`
finds none: site storage cleared, another browser profile or device after a crash, or a `user` or
`mod` origin map the catalogue server never had. That player cannot come back. Its seat is kept and
the room waits for it until the others vote it out, and the seat then goes to the AI.

## Scope

Let a connected member of a started room ask for the room's map again and let the relay answer it.
Either a loaded member serves the delivered text through the relay as the creator did in the lobby,
or the relay keeps the delivered map text beside the room's initial save for the room's lifetime and
serves it within the recovery budget. Keep `MAX_BLOB_BYTES`, the request cooldown and the per-member
transfer accounting. The client awaits the transfer as it awaits a lobby map (`awaitsTransfer`), then
restores from a snapshot as a returning member does. The protocol version bumps.

## Verify

A relay session test: a member drops after the start, returns with no installed map, requests it,
receives it, restores from the snapshot and acknowledges ticks. In the browser lab, a player whose
site storage is cleared between dropping and returning rejoins without the halt notice that names the
missing map.
