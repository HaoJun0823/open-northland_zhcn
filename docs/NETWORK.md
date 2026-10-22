# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 40` in
`packages/net-protocol`. A change one side of the current version could not honour, a message shape
or the value set of a validated field such as the fog mode ids, bumps the version; the relay refuses a
`hello` that names another.

The model is server-paced deterministic lockstep. Every client runs the full simulation. The relay
is the authority for time, order, membership, and session settings, and for nothing else: it holds
no game content, runs no simulation, and never interprets a command payload or a blob. That is what
keeps the server image free of decoded game data.

Map-script integration and multiplayer eligibility are documented in
[`MISSIONS.md`](formats/MISSIONS.md#multiplayer-integration). Seat commands include tribute payments,
trader route orders and civilian lessons; all peers must understand their payloads.

## Transport

WebSocket, one JSON text frame per message. A client message is at most `MAX_CLIENT_MESSAGE_BYTES`
(513 KiB), except a `blob`, which is at most `MAX_BLOB_MESSAGE_BYTES` (a 32 MiB payload in base64
plus its fields). A relay message is bounded by what it carries: a full tick frame holds up to
`MAX_SEATS * MAX_COMMANDS_PER_TICK` envelopes, with at most 1 MiB of serialized envelopes per
member plus sequence wrappers (a little over 16 MiB in all), and a blob is as large as the one a client
sent. A binary frame or unparsable text closes the connection. Every message is an object with a string `kind`. A close
with `CLOSE_REPLACED` (4000), `CLOSE_PROTOCOL_ERROR` (1002) or `CLOSE_SERVICE_RESTART` (1012, the
relay shutting down with its rooms) is final; after any other close a client may reconnect on its
token.

A traffic-budget excess closes with 1013 and `trafficLimit`, allowing the same reconnect path. A
stalled TCP upload can release a burst of valid catch-up acknowledgements. The connection still loses
its excess traffic; the returning client reports its current world and tick through `loaded`.

The relay replies to a message it cannot honour with `rejected { of, reason }`, naming the kind it
refused, and keeps the connection. A violation of the protocol itself gets `error { reason }`
followed by a close whose reason text is the bare code. A `reason` is never prose: it is
`{ code, ...values }`, one of the codes in `net-protocol`'s `RelayReason` with the values that code
names (a seat index, a nick, a count), and each client words it in its player's language. Only
`malformed` carries text, the parser's `detail`, which is a developer diagnostic and is not shown.

## Identity

The first message on a connection is `hello { protocol, token, nick }`. The `token` is a secret the
client generated and stored (16 to 128 URL-safe characters). Browser clients keep a separate token
for each normalized relay origin and path so another relay cannot impersonate them. The token is the
identity and is never shown to other clients. The `nick` is display only. The relay answers
`welcome { protocol, nick, build? }`, where `build` is its `RELAY_BUILD` when set (a printable line of
at most 128 characters), or `error { reason: { code: "protocolUnsupported", client, relay } }` naming
both versions when it speaks another, and closes. The shapes of `hello`, `welcome` and `error` hold
across versions, so a mismatch reads the same on any pair. A connection that has not said `hello`
within `HELLO_TIMEOUT_MS` (10 s) is closed.

A `hello` with a token already connected replaces that connection: the older one gets
`error { reason: { code: "replaced" } }` and is closed, and its room membership carries over. A token
that belongs to a started room, connected or not, is put back into that room by `hello` alone; in
the lobby a dropped connection is a leave, so only a running game keeps a member across a drop. Its
welcome uses the room's retained canonical nick. When a join assigns a numeric suffix, a further
`welcome` announces that canonical nick before the first room view; it is a name update, not a new
connection. The relay attaches membership before publishing the view, so a client can answer it
immediately. The host closes a connection that has sent nothing, a pong included, for
`SILENT_SOCKET_MS` (30 s); the token may return on a new socket.

## Rooms and seats

`listRooms` returns `rooms { rooms: [{ id, name, state, members, seats }] }`.

`createRoom { settings, seats }` makes a room and puts the sender in it. `settings` is
`{ name, world, seed, rules, speed, kickedSeatMode?, initialSave?, mapOrigin?, catalogMap? }`, where `world` and `rules` are the session descriptor's, and
the world is fixed for the room's life. Alliances come from the map's diplomacy and in-game
diplomacy; while the rules' `alliedVision` is on, the sim joins mutual friends into one fog mask and
follows later stance changes, so allies explore, see and meet as one in every fog mode. `seats` lists
the world's seats in ascending order as `{ player, mode, claimable, offers, color, authoredTribe?, tribe?, difficulty? }` with `mode` `map-ai`, `computer`, `idle` or `absent`;
`human` is never chosen, it is what a claimed seat becomes. The required boolean `claimable`
is false for scenario-only or hidden seats; the relay rejects claims with `seatNotClaimable`.
An explicit `playeroption` row determines whether a person may take the seat, even when its roster
default is `human`; without that row, the authored player type determines eligibility.
The receiving app validates the room and session roster against the verified map before starting
the world; the relay validates wire consistency without loading map content. Hidden seats are read
from that verified map, including maps transferred by the host.
`offers` lists the vacant modes the map's
`playeroption` row allows the seat, `mode` among them. Where a computer is allowed, the lobby offers
Computer (`computer`, autonomous control) and Idle (entities remain without AI control). Where `playeroption` allows None, the lobby also
offers None (`absent`), which omits that seat’s starting entities. Selectable authored AI seats default to Computer. Only reserved scenario seats use Map AI
(`map-ai`, the map’s `[AIData]` configuration); they offer that mode alone and cannot be claimed. Map AI respects `AI_Disable`, `HAI_Disable`
and individual module switches. An explicit Computer selection enables both controllers and
overrides those switches for the selectable seat, within its tribe's capabilities.
The computer controller and map AI controller have separate enabled gates: disabling every known
computer module is not a substitute for the blanket computer gate. Authored `PLAYER_TYPE_NONE`
seats are absent and cannot be claimed. `authoredTribe` is the tribe the map's roster
names for the seat, and `tribe` the one it starts as when that differs (a saved world's choice); a seat
without `authoredTribe` offers no tribe choice, and `tribe` needs it. Tribe ids are integers from 1
through `MAX_TRIBE_ID` (255); which of them name a civilization is the clients' content to say.
`difficulty` (`easy`, `medium` or `hard`) marks a seat the computer may play at a level and is the level
it starts at; the clients give it to a civilization seat the computer player controls, never to a monster seat
or a reserved map AI camp with autonomous control disabled.
An `absent` seat idles, and a fresh world places none of its authored settlers,
buildings, walls, animals or signposts. A room resumed from a save refuses `absent`, since its world
already stands. `joinRoom { roomId }` joins a room in the lobby; a room that has started refuses. A
duplicate nick within a room gets a numeric suffix (`Ania`, `Ania2`). Observers occupy no map seat
and have no room slot limit. The lobby shows each observer and one additional free observer row;
multiplayer never offers the sandbox overseer role.

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, seats: [{ player, mode, claimable, offers, color, authoredTribe?, tribe?, difficulty?, nick, ready }], members: [{ nick, seat, connected, compatibility, load, loading, roundTripMs, delayTicks, behindTicks }] }`,
where a seat carries `authoredTribe` and its current `tribe` together or neither.
A member's `load` is the one its last acknowledgement reported (below), null before its first. Its
`loading` is the boot progress in whole percent it last reported before its world loaded (below),
100 once that world has loaded, and null before its first report. `roundTripMs` is the relay's smoothed
round trip to the member in milliseconds (0 until its first pong) and `delayTicks` its assigned input
delay (see [Input delay](#input-delay)), both null while it is disconnected. `behindTicks` is how many
ticks its acknowledgements trail the clock: 0 before the clock runs, after the match ended, and while
the relay does not follow its world (disconnected, loading, or out of sync). Once the room has
started, loading included, a moved load, progress, round trip, delay or `behindTicks` alone sends a
view at most once per `LOAD_VIEW_INTERVAL_MS` (1 s) per room. Before `start` no figure alone sends a
view: a link measurement is stored and shown with the next view, and progress is
refused with `gameNotStarted`. Any other change carries the current figures with it.

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human` whatever it was;
  `claimSeat { player: null }` becomes a read-only observer. In the lobby it returns the seat to its
  vacant setting; in a running game it releases control, marks that seat idle in the room view and
  leaves the shared world unchanged. A running observer cannot reclaim a seat. Reconnect retains
  the observer role.
- `setSeat { player, mode?, color?, tribe?, difficulty? }` is the creator's: `mode` only on a
  vacant seat that offers it. A seated member may also send `tribe` alone for its own seat. `tribe` needs
  a seat with an `authoredTribe` (else `seatTribeUnavailable`), and reaches the start descriptor's seat
  only when it differs from the authored one; a seat without it plays the map's roster tribe.
  `difficulty` needs a seat that has one (else `seatDifficultyUnavailable`), and reaches the start
  descriptor's seat only while the computer plays it; a computer seat without one plays `hard`.
- `setSettings { settings }` is the creator's. It replaces `{ name, seed, rules, speed, kickedSeatMode? }`
  in full; including `world`, `initialSave`, `mapOrigin` or `catalogMap` is refused because these are immutable,
  and a replacement that changes nothing produces no room update. A saved room also fixes its seed,
  rules, seat colors, tribes and levels; claims and creator-selected vacant AI/idle modes remain
  editable.
- `setCompatibility { compatibility }` supplies the sender's report or null to invalidate it.
- `setReady { ready }` needs a seat; becoming ready also requires all compatibility checks to pass.
- `leaveRoom` frees the seat and identity; the last member out drops the room, and
  a creator who leaves passes the role to the next member. Once the clock runs, explicit departure
  immediately applies the same deterministic AI/idle seat handover as a passed kick vote, without
  a countdown or vote. A seated member that leaves after the start but before the clock runs ends the
  room instead (see [Waiting](#waiting)). Socket loss alone retains the seat for reconnection. The
  departing connection can create or join another room as soon as it receives `left`.

Every effective report, membership, seat, color, tribe, level or settings change clears all ready
flags.
Repeating the same report, seat claim or settings preserves readiness. A reconnect in the lobby also
clears that member's compatibility report and all readiness, so the new client must check its files.
A reconnect into a started game is checked by its snapshot tick and digests instead.

A compatibility report is `{ content, map, client, protocol, save? }`. Content and map are lowercase SHA-256
hex digests; `map: null` means the client lacks the map. The client version is a non-empty printable
line of at most 128 characters, and protocol names the version it speaks. The relay compares content,
map and client against the creator's report and requires its own protocol version from every member.
A saved room also requires every `save` report to equal its immutable initial-save fingerprint;
a fresh room requires an absent/null save report. Missing reports, missing maps and mismatches block ready and are checked again at Start, with a
refusal naming the member and category. `compatibilityIssues` exposes these results as pure data
(`nick`, `kind`, `reason`) for a lobby display. The hashes are client reports, not server-side content
validation; the relay does not read local content or map files.

`start` is the creator's, and goes through only when every member passes compatibility and every
seated player is ready. The relay then sends each member `start { session, snapshotTick: null }`: the `GameSession` descriptor with
that member's own `localSeat`, and every claimed seat as `human`. Each member builds its world from
it and reports `loaded { tick, world: 0 }` with the tick that world stands at (0 for a world with no
setup tick, 1 for a decoded map whose placements drain on one). The first report fixes the room's
built tick; the relay refuses any other tick from the rest, a second `loaded` on the same connection,
and a command sent before any world has loaded. The clock starts once every seated player has loaded, one
whose connection dropped included, so a game never starts without one of its players. The start is
announced by `clock { tick, speed, paused: false, by: null, governed: null }` naming the first tick
to run. The app reports `loaded` only once its display has shown the world's first frame and begun
the next one, so a first frame that blocks on first-use graphics work still holds the room, and
every player's game starts together rather than when the slowest one's sim is built. A hidden
page runs no animation frames, so there the app reports `loaded` once it has drawn one frame, and a
tab hidden through its load neither holds the room nor runs out its loading time. A client
holding no world that asks with `loaded { tick: null }` instead counts as loaded once the relay
serves it the room's snapshot, before its display shows the restored world. Until then it may send
`loading { progress }`, its boot progress in whole percent (0-100), which the room view shows; the
relay ignores progress from a member whose world has loaded.
After the start there is no host role.

## The clock and tick frames

Once started, the relay emits one `frame { tick, commands }` per simulation tick on its own clock,
at `TICKS_PER_SECOND` (12) times the running speed, empty frames included. Ticks count on from the
one the built worlds stood at and are never skipped. A client runs tick `t` only once it holds
frame `t`; that is the whole synchronisation rule. If the relay stalls it emits at most a short
burst and the game runs late; no tick is dropped.

`commands` is the list of `{ envelope, sequence }` that apply on that tick, with `sequence` counting
from 0 in the order the relay received them. Every client applies them in that order, after the
tick's own untargeted commands, through `Simulation.enqueueAt`.

Any seated player may change the clock with `clock { speed?, paused? }`. The relay applies it and broadcasts
`clock { tick, speed, paused, by, governed }` with the sender's nick and the first tick the setting
holds from; a speed request carries `governed` recomputed for the new requested speed. Pauses are
unlimited.

`speed` is always the requested speed. The running speed is `governed.speed` while `governed` is
`{ nick, speed, cause }`, and `speed` when it is null: the relay governs the clock while any seated player is
slow (see [Pacing](#pacing)) and runs it at the slowest one's pace. `cause` is `load` when that
member's reported tick cost bounds the speed, and `lag` when the catch-up share does: the member says
it could keep up, yet trails, as over a poor link. Clients run their driver at
`governed?.speed ?? speed`. The relay broadcasts `clock` with `by: null` whenever the governing member,
its speed or its cause changes.

## Commands

A client sends `command { envelope, fromTick }`: a seat envelope from the sim's command contract, and
the tick the client's own sim had reached when the person issued it. The relay:

- accepts `origin: "player"` only; `setup`, `admin`, and `ai` envelopes are refused, since the AI
  seats run inside every client and trusted commands have no wire;
- stamps `player` with the seat the connection holds, whatever the envelope claimed;
- lands the envelope on tick `max(nextTick, fromTick + delay)`, where `delay` is the member's
  assigned input delay, so a command applies a fixed number of ticks after it was issued as long as
  the connection stays within its budget; a later command from the same member never lands before
  its last accepted command, even when its delay falls or its world is restored to an earlier tick;
- admits at most `MAX_COMMANDS_PER_TICK` (20) complete player gestures from one member on one tick,
  each at most `MAX_ENVELOPE_BYTES` (512 KiB) as JSON, with at most 1 MiB per member per tick;
- bounds pending input to 128 gestures and 2 MiB per member, including paused rooms. Excess input is
  refused as a whole with `commandBudget`, never postponed to make room on a later tick;
- reserves recovery space before accepting input: retained frames plus pending gestures, including a
  conservative frame-overhead charge, may use 12 MiB of the 16 MiB history store. The remaining space
  keeps empty ticks and seat handovers flowing while a snapshot refresh frees capacity. Excess gestures
  receive `commandBudget`; already admitted gestures retain their application tick.

An army's movement, attack-move, direct attack, stance or regeneration selection is one opaque
command, bounded by the sim to 4096 unique members. Formation movement carries each member's target.
Settler selections also carry needs, equipment, jobs, training, lessons, chests and work assignments
together. Shared actions use one payload; differing actions use a closed per-member list of at most
two actions, preserving their order. Nested actions pass the same ownership checks as single orders.
Vehicle movement and attack selections are grouped as well; boarding groups retain both the unit's
and the vehicle's ownership checks. A mixed army emits a settler group and a vehicle group.

Ground clicks first request current formation slots from the simulation host, excluding blocked
terrain, structure bodies and occupied destinations. Members stay paired within their land component.
Vehicle commanders retain the clicked target so their vehicle can judge its own surface and clearance.
While that local query is pending, a newer order supersedes only its affected actors; Shift preserves
the order of overlapping gestures. A commander's pending walk also observes orders to its vehicle.
Only the completed member destinations enter the relay command.

Every admitted member receives the order in the same tick; a larger selection is refused locally as
one gesture with a visible notice. Ordinary redirects replace the previous standing order when they
apply, while Shift deliberately retains the sim's waypoint queue. Pending commands, saves and replays
retain the complete group. These are authored responsiveness choices; the relay neither splits a
selection nor interprets unit IDs. Player routes drain in that tick, sharing successful corridors and
proofs of unreachable regions under the same obstacle view instead of deferring soldiers by count.
The client checks the serialized envelope's UTF-8 size before sending and reports `envelopeTooLarge`
locally, so an oversized gesture cannot disconnect its sender or partly enter the command stream.

The relay reads nothing else. The command payload reaches every client as sent, and every client
validates it with `parseCommandEnvelope` before enqueueing; an envelope the sim's parser refuses is
dropped on every client alike, so a bad payload cannot split the session.

One envelope in a frame does not come from a seat: `{ v, origin: "admin", command: { kind:
"setAiControl", player, enabled: true, computerEnabled: true, mapAiEnabled: true } }`, the relay's own, for a seat a kick vote handed to the AI.
It is the only trusted command the wire carries; a client refuses a frame with any other.

## Input delay

The relay pings each client once a second (`ping { t, roundTripMs }`, answered by `pong { t }`) and
keeps a smoothed round trip and jitter per client; `roundTripMs` is that smoothed trip, carried so
the client can show it. Each sample is clamped before it enters the smoothing: it counts as at most
twice the smoothed trip, or the smoothed trip plus one tick when that is more, and the first sample
as at most one second. The trip and the jitter (the mean deviation from the trip) then move a quarter
of the way toward the clamped sample. One late pong therefore moves both a little, while a lasting
change carries them over within about ten samples. A pong to a ping that was outstanding while a
message from the client was still arriving, such as its own snapshot upload, is no sample: it waited
behind that message and measures the upload, not the link. The same holds for a ping sent while a
fragmented message to the client was still unread, such as a snapshot or map it is downloading, until
the client answers the control ping after that message's last fragment.

The assigned input delay is `ceil((rtt + jitter) / tickLength) + 1` ticks of the smoothed values,
with `tickLength` the tick at speed 1, starting at 2, never below 1 and never above 12 (one second).
The first sample sets it directly; after that it rises at most one tick per sample, and once the
budget has stayed below it for three samples in a row it drops to that budget. A change is sent as `delay { ticks }`; every
member also gets its current delay at the start.

A delay that is lower than the link needs never splits state: the relay places a command on the
next unemitted tick when its stamped tick plus the delay has already passed, so the command applies
as soon as it arrives and its click-to-apply time follows the link's jitter instead of staying
fixed. A higher delay only adds latency, which is why the cap holds even on a slower link.

## Order responsiveness

Any seated player may select `responsiveness { mode }` for the whole room, including while paused. `mode`
is `auto` (the default), `responsive`, `balanced` or `smooth`. The relay broadcasts
`responsiveness { mode, bufferTicks, by }` and sends the current state after `chatHistory` whenever a
member joins or reconnects. `by` is the last explicit selector's nick, or null before anyone chooses;
automatic reserve changes retain it. Selecting the current mode changes nothing.

Manual modes target one, two and three received tick frames respectively. The client adjusts its
playout pace to approach that target; after a decrease it also drains the last extra frame, which the
ordinary pacing deadband would retain. It never drops frames or changes command application ticks to
switch modes. This reserve is distinct from the per-member input delay above. The in-game Network
window shows the selected mode and its reserve in milliseconds at the running speed, announces mode
changes, and disables changes while disconnected.

Auto starts at two ticks. Its authored policy uses the worst connected, loaded, in-sync seated
member's `min(25 ms, RTT * 0.1) + 2 * jitter` as a reserve in milliseconds, converts it to ticks at
the effective governed speed, and clamps the result to 1..6. Stable latency is already covered by the
input delay; only a capped RTT margin supplements measured variation. An unmeasured active link
keeps at least two ticks. Spectators do not affect the estimate. A higher target must persist for
one running second for each tick the reserve rises, and a lower target for ten running seconds for
each tick it falls. Pauses and held rooms reset both timers, and reconnects invalidate stale link
measurements. The jitter comes from the clamped samples above, so one late pong lifts the target
little and only for a few seconds.

## Acknowledgements and the sync check

After every tick a client sends `ack { tick, digest, world, load }` with the sim's `SyncDigest.domains`
for that tick: one unsigned 32-bit word per domain (`rng`, `entities`, `players`, `movement`,
`settlers`, `economy`, `combat`, `fog`). `world` is the generation of the world the client reports
from: 0 for one built from the descriptor, otherwise the tick of the snapshot it was restored from.
An acknowledgement from another generation is still in flight from a world the client has thrown
away, and is ignored. Within a generation acknowledgements are consecutive; one out of order or
ahead of the clock is refused. The acknowledged tick is also how far the relay believes the client
has applied.

`load { tickMs, buffered }` is the client's own pace. `tickMs` is the wall time one tick costs it in
milliseconds, the larger of two exponential moving averages whose newest tick weighs
`1 / TICKS_PER_SECOND`: the sim's, on the thread that runs it (frame admission, the step, and the
host's work to hand the tick to its display), and the display's, sampled once per drawn frame as the
frame interval over the most ticks a frame takes in on average, weighing as the ticks that frame
took in. The app's sim worker steps only a couple of frames
past the tick its display drew, so a display that cannot keep up also leaves the client's
acknowledgements behind, and the relay governs the room for it as for a slow sim.
`buffered` is the frames it holds received and not yet applied. The relay keeps the latest load of
an accepted acknowledgement as sent, with no smoothing of its own.

Once every client in sync has passed a tick, by acknowledging it or by being moved past it with a
snapshot, the relay compares the digests those clients reported for it. The majority digest is the
reference; on a tie, the client connected the longest (the earliest current connection, then the
earliest to join). A client in the minority gets `desync { tick, domains, reference }` naming the
domains that differ and the reference's nick, and is out of sync from then on: its acknowledgements
are ignored and its snapshots refused until it has rebuilt from a snapshot, and the notice is sent
again if it reconnects meanwhile. The reference, if connected, gets one `disputed { tick, domains,
diverged }` naming the nicks newly out of sync at that tick and the union of their differing domains,
so both sides can keep that tick's digest inputs for a diagnostics bundle. A client keeps the inputs
of its last `DISPUTE_WINDOW_TICKS` (960) acknowledged ticks, and at most `DISPUTE_RING_BYTES` (24 MiB)
of them, dropping the oldest ticks first; a verdict for a tick it no longer holds records no inputs.
A client acknowledging a tick the room has already settled is judged against that tick's reference,
so a returning client is checked from its first tick back. A disconnected client's reports do not
count; it says where it stands again on its return.

## Waiting

The clock holds, emitting no frames, while any seated player is:

- `gone`: its connection dropped;
- `silent`: the relay has heard nothing from it for `SILENT_AFTER_MS` (4 s), whatever its socket says.
  Any message counts, and so does progress on one still arriving: a pong queued behind a large upload
  does not make its sender silent. Progress on a large message to the client counts the same way: the
  client's answer to the control ping after each of its fragments (see
  [Public relay security boundary](#public-relay-security-boundary)) keeps a client heard while the
  relay's pings and frames wait behind a snapshot it is downloading;
- `loading`: it has not said where its world stands, before the start or after a return, and is still
  heard; a loader that went silent is waited for as `silent`;
- `resync`: it is out of sync and its snapshot has not arrived;
- `slow`: it has been slow for `SLOW_WAIT_AFTER_MS` (30 s) on end and has not caught up since; see
  [Pacing](#pacing).

A held clock runs for nobody: a `clock { paused: false }` changes the pause flag and nothing else, and
the frames resume once nobody is waited for. A member that is merely behind, or slow for less than
`SLOW_WAIT_AFTER_MS`, is not waited for; see [Pacing](#pacing).

Every change to the waited set is broadcast as `waiting { for: [{ nick, reason, voteAfterMs }] }`; an
empty `for` ends the wait. Each member's `voteAfterMs` is what is left of `KICK_COUNTDOWN_MS` (60 s)
after the time the room has waited for that member, and counts down while it is waited for. The
waited time is kept when the wait ends and forgiven at `WAIT_FORGIVENESS` (0.1) waited millisecond per
millisecond the member is not waited for: a member that answered after 30 s of a wait and drops again
100 s later starts at 40 s, and one that answered after 30 s gets the whole countdown again 300 s
later. A member that keeps ending its waits just in time therefore still reaches a vote once the room
has waited for it more than a short while: one silent for 2 s of every 6, so held a third of the time,
is votable in its waits after about 4 minutes. The clock's start clears every member's
waited time, so the load everyone was waited through before it counts against nobody, and the
`waiting` that follows its `clock` names who the room waits for once it runs. A wait is over as
soon as nobody is waited for: the dropped token returned, the silent one answered, or the diverged
one rebuilt. A client that never loads or stops answering pings is waited
for and can be voted out, before the start as after it; a member kicked before the start is not waited
for to start the clock. A client whose own link is lost reckons a countdown for itself, from the
drop of its socket or, on a socket that stays open, from the moment the relay stopped hearing it: the
client's `LINK_QUIET_MS` (equal to `SILENT_AFTER_MS`) without a relay message. In a game on screen, the app
then shows that countdown on a screen that takes no order until the relay is heard again. It counts
the whole `KICK_COUNTDOWN_MS` from the loss, while the relay carries over the waited time the member
still owes, so the client's countdown is an upper bound: the others may be offered the vote sooner
than its screen shows. Before the clock runs, a player that has not loaded and whose boot has not
moved for `LOADING_STALL_MS` (2 min, counted from the start, its last `loading`, its `loaded`, or its
drop or return) loses its seat the way a passed kick takes it: `kicked { cause: "loadingTimedOut" }`,
the seat follows `settings.kickedSeatMode`, and the clock starts once the others have loaded. A hidden
or frozen tab is an absent player: it never holds the others past the stall, nor ends their room. The
handover waits for the first `loaded`, which fixes the tick it lands on; until then every other player
is still booting too. Only when no player is left whose boot moves does the room end: every connected
member gets `error { loadingTimedOut, nick }` and `left`, and the players host again. Observers count
neither way. A player kicked while its socket was down, for this or by a vote, gets that `kicked` and
`left` once when its token next says `hello`, while the room lasts. The app shows no countdown for the
stall and offers no vote on its loading screen. A seated member that leaves the room before the clock
runs ends it at once, with `error { leftBeforeStart, nick }` and `left` to the others.

Observers cannot issue commands, change the shared clock or responsiveness, or vote to kick a player.
Their loading, disconnection and rendering speed never hold or pace the game. Their digests are
compared against the players without counting toward the majority; when only observers remain,
their reports decide the reference and the final result.

## Pacing

A member is judged by its backlog: how far its acknowledged tick trails the clock beyond the frames
a healthy client on its link still holds. Those are the frames of one smoothed round trip at the
speed the clock emits them, rounded up, which are on their way to the client or its acknowledgements
on their way back, and the room's [response reserve](#order-responsiveness), which the client holds
back before it applies a frame. A member on a 450 ms link in a room with a reserve of 2 therefore
trails by 7 or 8 ticks at speed 1 with a backlog of none. A member the relay follows (connected,
heard, loaded and in sync) is lagging while its backlog is more than `LAG_BEHIND_MS` (1 s) of frames
at the requested speed, 12 ticks at speed 1 and 12 times the speed otherwise. A lagging member
catches up alone and the room notices nothing. Once it has lagged for `SLOW_GRACE_MS` (4 s) of wall
time on end it is slow, and stays slow until its backlog is no more than `GOVERN_RELEASE_MS` (0.5 s)
of frames. A member whose backlog is more than `SLOW_AT_ONCE_MS` (`LAG_BEHIND_MS + SLOW_GRACE_MS`,
5 s) of frames is slow at once, without the grace. Its own measured `load.buffered` is not taken off:
a client that cannot keep up holds its backlog in that buffer.
A member the clock holds for is not judged while held, since the held clock adds no lag. It keeps its
verdict through the hold, and its grace pauses: wall time under a hold for it does not count toward
`SLOW_GRACE_MS`. The pause is per member: a hold for another member stops the clock, so a lagging
member closes its gap, but its own grace keeps running. A slow member that goes silent is slow again
on its return; one that had lagged 1 s has 3 s of grace left on its return, however long it was away.
Only leaving the room, or a world rebuilt from a snapshot after a resync or a return without one,
clears the verdict and the lag.

While any seated player is slow the relay governs the clock, whatever the requested speed. Each slow
member's bound is the lower of its sustainable speed with headroom, `TICK_MS / load.tickMs * GOVERNOR_HEADROOM` (0.8), or
`GOVERNOR_HEADROOM` times the requested speed before its first load report, and the catch-up share
of the requested speed, `CATCH_UP_SHARE` (0.8) times it. `cause` names the lower one, `lag` on a tie.
The bound is rounded to `GOVERNED_SPEED_STEP` (0.05), never above the requested speed and never below
`MIN_GOVERNED_SPEED` (0.25) unless the requested speed is; a member slower than that falls further
behind at it. The lowest bound wins, and a tie goes to the member furthest behind. The governed
speed drops at once but rises only by `GOVERNED_RISE_STEPS` (2) steps or more at a time, and while
the same member stays governed at the same speed its `cause` stays as announced, even when its other
bound becomes the lower one. A load report jittering across one rounding boundary, or across the
point where the two bounds cross, therefore does not become a `clock` broadcast per advance. Once
nobody is slow the clock runs at the requested speed again.

A seated member slow for `SLOW_WAIT_AFTER_MS` (30 s) of wall time on end is waited for as `slow`: a
seat that cannot keep up even at the floor would otherwise hold the room at it indefinitely, falling
further behind, with no way out. Wall time the clock holds for it for another reason, such as its
silence, does not count toward the 30 s, as for the grace. The clock holds for it like for any waited member, so it catches up
while the others wait, and its countdown and vote run as for every other reason. It is still judged
while waited: once its backlog is no more than `GOVERN_RELEASE_MS` it is released, no longer waited for
and no longer votable, and the clock runs again. A seat that is chronically slow therefore alternates
between governed play and holds, and the waited time it keeps between holds (see [Waiting](#waiting))
makes each later hold votable sooner: the others decide whether to wait for it or vote it out.

## Kick votes

Once a member's countdown has passed, any other member sends `kick { player, yes: true }` for its
seat; a repeat from the same member counts once. `kick { player, yes: false }` withdraws that
member's yes, and is refused with `noVoteToWithdraw` from a member that has none. Each yes and each
withdrawal is broadcast as `kickVote { player, nick, yes: [nicks], needed }`. A yes is cast only
while its target is waited for; a member that is slow, but not yet waited for as `slow`, is refused
with `notWaitedFor`. The yeses outlive the wait they were cast in while the target still owes waited
time (see [Waiting](#waiting)), and are dropped once it owes none: the yeses against a member that
drops in short waits add up across them, so two voters of three may each say yes in a different
wait. Between its target's waits a vote is hidden, as clients drop its tally with the wait, and the
relay broadcasts its tally again when the target is waited for again; its countdown must run out
again before it takes a yes or passes.

The electorate is the connected members other than the target, and `needed` is a strict majority of
it, `floor(others / 2) + 1` (`kickVotesNeeded`): both of two, 2 of 3, 3 of 4. A yes counts only while
its voter is connected. It stops counting when the voter drops and counts again if the voter returns
while the vote is open; a member that leaves the room loses its votes. Each drop, return or departure
recounts every open vote and broadcasts each tally that moved, so a vote can pass on a vote, on a
voter's return, or on another member dropping or leaving. A vote passes only while the relay would
still wait for its target at that moment with its countdown run out: a yes against a target that
answered or loaded since the last poll is refused with `notWaitedFor`, a recount passes no vote
against it, and its vote is hidden from the next poll.
A member whose `loaded` is accepted, on its return or after a reload, gets one `kickVote` per open
vote with its current tally right after its `waiting`, since it missed the broadcasts that built it.

Several members may be waited for at once. Each has its own countdown and its own vote, and the
electorate for each excludes every dropped member: with four players and two dropped, each vote needs
both of the two still connected, and the last connected member kicks each of the others alone. The
clock stays held until every waited member is back or kicked. Kicking one leaves the others'
countdowns and votes as they were; a dropped member that is no longer waited for after its return
hides only the vote against itself. With every member dropped nobody can vote: the room ends at the
history age limit (see [Resync and catching up](#resync-and-catching-up)), or after the 10 minutes a
room with nobody connected is kept when no frame is retained, whichever comes first.

When the yeses reach `needed` the relay broadcasts `kicked { player, nick, mode, cause, tick }` and
removes the member. A member whose link was down when the vote passed gets that `kicked` and `left`
once when its token next says `hello`, while the room lasts; afterwards, and once the room ended, its
token is a stranger. The seat goes to `settings.kickedSeatMode`
(`computer` or `idle`). An `idle` policy always applies; `computer` applies when the seat offers it,
otherwise a lobby AI seat stays AI and every other vacant mode falls back to `idle`,
whose settlers already stand. The room view reflects this mode. For
`mode: "computer"` the relay lands its `setAiControl` envelope on `tick`, the next unemitted one, outside
every budget, so the AI takes the seat on the same tick on every client. For `mode: "idle"` the seat
simply issues nothing more. A vote passed before any world has loaded holds its handover notice and
AI command until the first `loaded` fixes the built tick, and then names the first resumed tick.
`cause` says why the seat was left: `vote`, `loadingTimedOut` for a boot that stalled before the
clock ran (see [Waiting](#waiting)), or `left` for a member that left the started game itself.

## Manual save order capture

`saveOrders { id, tick, world }` completes a locally captured tick-boundary save with every room
command the relay has accepted but that saved world has not applied. The requester must be connected,
loaded and in sync, use its current world generation, and name a tick between the initial world and
both its acknowledged tick and the relay clock. Missing retained history is a refusal, never an
incomplete success. No pause, clock advance or queue drain occurs.

The reply is `saveOrders { id, tick, frames }`: the nonempty frames strictly after `tick`, in
ascending tick order, from the retained emitted frames and the accepted pending ones; sequence
numbers stay contiguous within a frame, and empty `frames` is a complete capture. A command accepted
after the request belongs to a later capture. The client stores the frames as the save's
continuation, with their apply ticks and within-tick order, against the world it captured before
asking.

A reply over `MAX_SAVE_ORDERS_BYTES` (16 MiB of serialized UTF-8 JSON) is refused whole. A refusal carries
`rejected { of: "saveOrders", requestId, reason }` whenever the request named a valid id, parser
refusals included.

## Blobs

`blob { type, to, tick, bytes }` carries opaque bytes: `bytes` is base64 of at most `MAX_BLOB_BYTES`
(32 MiB) decoded, `type` is `snapshot`, `save`, `initialSave`, or `map`, `to` names one member's nick or null for
everyone else in the room, and `tick` is required for a snapshot or a save. The relay never decodes
the bytes; it delivers them as `blob { type, from, tick, bytes }` with the sender's nick.

A `snapshot` upload also requires `world`, the donor's world generation at capture, as on an
acknowledgement. An upload from another generation is stale and ignored, even if its tick is newer
than the corrected cache; compression and delivery may have started before the donor's resync.

A `map` is accepted only from the current creator in the lobby, with a null tick and an explicit
immutable `mapOrigin: "mod" | "user" | "catalog"`. It is relayed as addressed. A `catalog` origin
comes with `catalogMap: { entryId, mapId, fingerprint, irVersion }`, naming the room's map, its map
catalogue entry, its terrain-and-script fingerprint and the content version it was converted for;
neither field is allowed without the other. A member without the map fetches that conversion from
the catalogue's server when its own content version matches, verifies the fingerprint, and asks the
creator through the relay only when the server cannot deliver it. The relay keeps the latest map
text the creator delivered for the room's life, replaced by the creator's next delivery. `requestMap`
answers with that text as the same `blob { type: "map", from }` the creator sent, in the lobby while
the creator still offers it under the same map fingerprint and after Start to any member, such as one
that returns without the map. Otherwise, in the lobby, it sends the connected creator
`mapRequest { from }` so a member can retry delivery; after Start it is refused with `mapNotKept`.
Map and initial-save requests each
have a two-second per-member cooldown to bound small-request/large-response amplification. The origin is advisory: clients must
validate source provenance, sender identity, payload schema and the expected map fingerprint.
Map replacement after Start is refused. A map's bytes are the clients' contract: gzip of the JSON
envelope `{ version: 2, mapId, map, script }`, so `MAX_BLOB_BYTES` bounds the compressed map; a
receiver refuses anything but a gzip stream and stops inflating past 64 MiB plus the envelope's keys.

An `initialSave` is creator-only, lobby-only, has `to: null` and the declared tick. The declaration is
`initialSave: { fingerprint, tick }` with `tick` at least 1, copied into every session descriptor.
Its fingerprint is SHA-256 of the exact base64 snapshot text. The relay hashes the opaque text,
refuses a mismatch, caches one bounded blob, and broadcasts it to every member, the uploader
included. `requestInitialSave` returns this cache, including after the creator leaves. Ready and
Start require the upload as well as matching reports; a client verifies the hash, the decoded save,
its tick and its map, and restores it against its own content before it reports `save` in its
compatibility report.

A saved start names `snapshotTick: initialSave.tick`; the relay seeds its clock and snapshot cache
there, and every world reported for it must carry that generation. Saved rules and diplomacy stay as
saved; each client queues the roster's seat control once on the first resumed tick. Local
post-result command grants and pending `continueMatch` commands are removed before inherited orders
run, so importing a single-player save never restores a defeated multiplayer seat's authority. The lobby
releases its cache at Start, and the room's snapshot retention takes over.

A `save` is relayed as addressed and never refreshes the room's cached snapshot: its persisted
continuation already includes accepted future orders, so adding replay frames would apply them twice.
A `snapshot` is not relayed on request: it refreshes the cache and reaches whoever
is waiting to be brought back (see below); `to` is ignored. Both a snapshot and a save are accepted
from a client in sync only, at a tick up to the clock's, and never at tick 0.

The encoding of a snapshot or a save is the clients' contract, not the relay's: gzip of the sim's
canonical save JSON (`serializeSaveGame(exportSaveGame(sim))`), taken at a tick boundary, restored
with `restoreSimulation` onto the world the descriptor names. A manual save contains locally queued
commands and the accepted relay continuation obtained by `saveOrders`. An automatic snapshot contains
only the simulation queue; retained relay frames reconstruct accepted orders after its tick.

A manual multiplayer save is written locally and shared through the relay as a `save` blob. What a
save records of its session (the descriptor and the public roster, never a token) is the save
format's contract in [`DATA-FORMAT.md`](DATA-FORMAT.md). A room created from a save offers the
saved human seats as vacant and each player claims one explicitly, with the saved seats' colors,
tribes and levels, since its world already stands; the new room's seats supersede a
seat handover the previous room had scheduled but not applied, and player orders keep their saved
ticks and order.

A client keeps the custom maps it verified in browser storage, capped at four maps and 64 MiB of
encoded transfer text (a delivered map is stored as the text it arrived in), and validates a copy again against its fingerprint and permitted origin before
playing it; base and unknown origins are never served from that store. A catalogue map fetched from
the catalogue's server joins the player's installed catalogue maps instead. A reload rejoins on the token,
fetches a map it no longer holds from the catalogue's server or else with `requestMap`, checks
compatibility, and rebuilds over that map from the relay's cached snapshot, or from the descriptor
while the relay still holds every frame.

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it. Until the first snapshot it
keeps every frame from the first one. Replay retention is limited to `MAX_HISTORY_BYTES` (16 MiB of
UTF-8 frame JSON) and `MAX_HISTORY_AGE_MS` (10 minutes of wall time since the oldest retained frame).

The relay requests a refresh every `SNAPSHOT_REFRESH_MS` (5 min), or once history reaches half its
byte or age budget. While any seated player remains, only seated players may donate snapshots;
observer uploads are refused and observers are not retried as donors. With no seated players,
observers maintain the cache. `snapshotRequest` goes to the eligible client in sync and not silent with the lowest
round trip, which answers with a `snapshot` blob at its current tick. An unanswered request is repeated every
`SNAPSHOT_RETRY_MS` (10 s) to the next eligible donor, at once when the asked donor drops, diverges or
goes silent, and one request is outstanding however many members wait for it. A snapshot prunes the frames it covers.
With no retained frames, a same-tick upload also satisfies a paused refresh. An older upload leaves
the cache unchanged.

When the cached snapshot's donor is found out of sync, the cache is held back: a drop forgets held
digests, so that tick may never have been judged. Reconnects then wait for a replacement while a
client in sync can send one; with none left, returning clients take the held copy and diverged ones
keep waiting for the next donor. The held copy's tick still marks the start of retained replay
history. A same-tick upload can replace it. Otherwise the first copy of a tick stays cached, so a
delayed same-tick duplicate cannot undo a correction.

A diverged member is served only a snapshot whose tick is later than its discarded world generation.
Otherwise it keeps waiting for a fresh donor upload, so a repeated resync cannot make that world's
in-flight acknowledgements or snapshot uploads current again.

If the age limit is reached or the next frame would exceed the byte limit, the relay ends that room:
connected members receive `error` with the `historyBytes` or `historyAge` reason, then `left`. All members,
including disconnected ones, lose their room association, and the snapshot and history are released.
Their connections remain usable and other rooms continue. The relay never silently discards a frame
needed to replay from its advertised snapshot.

A client told `desync` drops its world and waits. The relay asks the best-connected eligible donor in sync for
a fresh snapshot and, when it arrives, sends the diverged client `blob { type: "snapshot" }` followed
by every frame after the snapshot's tick. The client restores, replays those frames, and acknowledges
from the snapshot's tick on, catching up as any lagging member does (see [Pacing](#pacing)). A
diverged client that drops leaves the queue: on its return it asks with `loaded { tick: null }` and
takes the cache, or the next snapshot when none is cached yet or the cache is held back. Nothing is
sent to it before it asks.

A returning token gets `room`, `chatHistory`, its pending `desync` notice if it has one,
`start { session, snapshotTick }`, `clock` while the game runs, and `ended` once it has ended.
`snapshotTick` is the cached snapshot's tick, or null when the relay still holds every frame from the
first. The client answers `loaded`:

- `{ tick, world }` with the tick its world still stands at and that world's generation, and the
  relay sends the frames after it, or the cached snapshot and the frames after that when the frames
  before the cache are gone;
- `{ tick: null }` when it holds no world and a snapshot is cached, and the relay sends the snapshot
  and the frames after it. A cache more than `RETURN_SNAPSHOT_MAX_TICKS` (120 ticks, 10 s at normal
  speed) behind the clock would cost the client that long a replay and the room a governed clock
  meanwhile, so the relay asks a donor for a fresh snapshot instead, through the one outstanding
  request, and the clock holds for the client as `loading` until it arrives. With no eligible donor,
  or none answering within `SNAPSHOT_RETRY_MS`, the client takes the cache;
- `{ tick, world: 0 }` with the tick of a world freshly built from the descriptor when
  `snapshotTick` was null.

A client whose world is out of sync must ask with `null`. Whatever the path, a snapshot blob always
replaces the client's world, and the frames that follow are applied through the same transport. An
accepted `loaded` is answered with `ended` once the match has ended, else with `waiting` for the
current waited set followed by one `kickVote` per open vote (see [Kick votes](#kick-votes)).

A token voted out while its link was down gets its `kicked` and `left` once after `welcome`, while
the room lasts (see [Kick votes](#kick-votes)); one whose room ended meanwhile gets `welcome` alone.
The client therefore answers every
`welcome` while it holds a started room with `joinRoom` for that room and reads the refusal: a member
put back is refused `alreadyInRoom` and stays; `gameStarted` means the room goes on without it, and
`noRoom` that the room ended; on either the client ends its game with a notice and leaves the room
as the relay's `left` would have.

## Chat

`chat { text }` is broadcast to the room as `chat { from, text, at, tick }`, where `at` is the relay's
wall clock when it received the line, in Unix epoch milliseconds, and `tick` the clock's next tick
then, null before the clock has started. One printable line, at
most `MAX_CHAT_LENGTH` (500) characters, like every other string that reaches another person. Unicode
line and paragraph separators are refused along with control characters.

The relay keeps each room's lines, the lobby's included, up to the newest `MAX_CHAT_HISTORY_LINES`
(500); the log ends with the room. A member gets `chatHistory { lines: [{ from, text, at, tick }] }`, oldest
first, right after the room view each time it enters the room: on creating it, on joining it, and on
every return of its token, before `start` and `clock`.

## Limits

| Limit | Value |
| --- | --- |
| `MAX_CLIENT_MESSAGE_BYTES` | 513 KiB |
| `MAX_BLOB_BYTES` (decoded) | 32 MiB |
| kept map text per room | one delivery, up to `MAX_BLOB_BYTES` |
| `MAX_ENVELOPE_BYTES` | 512 KiB |
| `MAX_SEATS` (seat indices) | 16, the sim's `MAX_PLAYERS` |
| Observer slots per room | No slot limit |
| rooms per relay | `RELAY_MAX_ROOMS`, 64 by default |
| `HELLO_TIMEOUT_MS` | 10 s |
| `SILENT_SOCKET_MS` | 30 s |
| started room kept with nobody connected | 10 minutes |
| `MAX_COMMANDS_PER_TICK` per member | 20 |
| pending gestures per member, including paused rooms | 128 / 2 MiB |
| envelope bytes per member per tick | 1 MiB |
| retained history plus pending input at admission, including overhead | 12 MiB |
| members in one army gesture | 4096 |
| Auto reserve / manual reserves | 1..6 / 1, 2, 3 ticks |
| `MAX_SPEED` | 8 |
| `LAG_BEHIND_MS` / `GOVERN_RELEASE_MS` | 1 s / 0.5 s of frames |
| `SLOW_GRACE_MS` / `SLOW_AT_ONCE_MS` | 4 s / 5 s of frames |
| `GOVERNOR_HEADROOM` / `CATCH_UP_SHARE` / `MIN_GOVERNED_SPEED` | 0.8 / 0.8 / 0.25 |
| `GOVERNED_SPEED_STEP` / `GOVERNED_RISE_STEPS` | 0.05 / 2 steps |
| `MAX_REPORTED_TICK_MS` / `MAX_REPORTED_BUFFERED` in `load` | 60 s / an hour of ticks at `MAX_SPEED` |
| `SILENT_AFTER_MS` | 4 s |
| `KICK_COUNTDOWN_MS` | 60 s |
| `LOADING_STALL_MS` | 2 min |
| `SNAPSHOT_REFRESH_MS` / `SNAPSHOT_RETRY_MS` | 5 min / 10 s |
| nick / room name / chat line | 24 / 48 / 500 characters |
| `MAX_CHAT_HISTORY_LINES` per room | 500 |
| room id / world id / command kind / `malformed` detail | 32 / 128 / 64 / 200 characters |
| `MAX_SEED` | 2^32 - 1 |
| token | 16 to 128 URL-safe characters |

## The client

`packages/net-client` is the client half every host shares: `RelayClient` walks the lobby, opens the
world `start` names through a port the host supplies, runs it over `RelayTransport`, acknowledges
every tick, answers pings and snapshot requests, and asks a diverged world's host to restore. It runs
the sim behind the relay's clock by the room's [response reserve](#order-responsiveness), scaling the
time it feeds the driver without skipping ticks, so a late frame lands inside the buffer. Catch-up is
capped at 192 ticks/s using the effective governed speed, leaving room for commands and pongs within the
host's 256 messages/s budget; every applied tick still sends its digest. A wait for a frame keeps at
most one tick of owed time, so after a hold the pacer refills the buffer and a burst of late frames
runs one tick per display frame rather than five.

The client sends a gesture only while fewer than `MAX_COMMANDS_PER_TICK` of its own are in flight
(sent and not yet applied or refused) and their JSON bytes with its own stay within
`MAX_COMMAND_BYTES_PER_TICK` (1 MiB); the rest wait in order in a local outbox of 100 and leave as
earlier ones apply, so a long wall line, a run of orders given while paused or a few large army
orders land over successive ticks instead of being refused with `commandBudget`. A gesture past a
full outbox, an oversized one, and one issued with no world are refused locally with
`rejected { of: "command" }` (`commandBudget`, `envelopeTooLarge`, `notLoaded`); one issued while
disconnected waits in the outbox until the room admits the world again, also when the return is
served a snapshot or a desync rebuilds the world, since the restored world is the same game further
on. Leaving the room drops the outbox. When a socket is replaced or another world adopted, the
commands in flight stay counted but unmeasured for click-to-apply: the relay keeps what the old
socket delivered and lands it first, while some may be lost or inside a restored world. The outbox
sends nothing new until they are settled, so each of this seat's commands applied, dropped or
refused meanwhile is one of them, and the rest are forgotten once the world has run past the last
tick the relay could land them on: the tick the next `clock` (on a new socket) or the newest frame
(on a restored world) names, plus the input delay. An old command that lands later still, under a
delay raised on the lost socket, takes a newer command's stamp. A `snapshotRequest` is skipped
while the world stands behind the newest snapshot tick the client has seen the relay cache.

`RelaySocket` keeps
the connection and reopens it on the same token after a drop; a connection the relay replaced or
refused stays closed. A connection attempt that has not opened within 10 seconds is closed and retried
even if no socket close event arrives. An open socket that carried nothing from the relay for
`LINK_QUIET_MS` (4 s) is reported quiet, and the player sees the lost-link screen. A quiet poll
that runs more than two poll intervals after the one before found its thread blocked, by a world
build or restore for instance, with messages possibly queued behind it, so it counts the silence
from that moment instead of judging the link. A browser socket
reports a large message only once it is complete, so silence cannot tell a stalled route from a
transfer still arriving; what the client awaits decides. A socket quiet for `LINK_REPLACE_MS` (8 s)
is replaced by a new one on the same token, which rejoins within a second, while a link dropped
without a close would otherwise hold the room until the kick vote. While the client awaits a large
message (a map or initial save it requested, each until that blob or a refusal of every request for
it arrives, a `retryTooSoon` answering only the repeat; or a snapshot: after `desync`, after a `loaded
{ tick: null }`, or after a `loaded` whose tick stands behind `start`'s `snapshotTick`) the bound is
`TRANSFER_REPLACE_MS` (5 min), within which a full 32 MiB blob (about 45 MB as base64) arrives at
1.2 Mbit/s. The host hands the socket the client's `awaitsTransfer`; a socket without it keeps a quiet
link open. Each new socket forgets what the old one awaited and is served again from its own `start`.
A large message nobody asked for, such as a shared save or a broadcast initial save, counts as
silence, so a link slower than its size over 8 s loses it to a replacement; the room's state is
served again either way. The relay's own silence limit still applies to incoming traffic.
The client keeps the room's chat as the relay logs it: `chatHistory` replaces
it on every entry and return, each `chat` appends to it, up to `MAX_CHAT_HISTORY_LINES`. The desktop
and browser app plays through the `?relay=` entry, whose client, link and world run in a network
worker, the headless test client through an in-memory network. The app's client holds `loaded` until
the display has shown its first frame of the world and begun the next, or on a hidden page has
drawn it, and keeps the loading screen
up until the room's clock runs and nobody is still loading. The worker wakes and feeds its client at
the pace the client plays: the governed speed while the room is governed, and up to the catch-up cap
while it drains a backlog. It steps at most a couple of display frames past the tick the display drew,
a lead that grows with a catch-up pace while the display draws at least four frames a second, so a
display slower than that paces the room (see
[Acknowledgements](#acknowledgements-and-the-sync-check)). A display that has taken in nothing for
four of its frames, and for at least 500 ms, has stopped, as a hidden page's frame loop does: the worker
keeps stepping and acknowledging, and hands the display every tick since in one batch when it draws
again, without their momentary sound and effect events. It holds up to ten minutes of ticks at the top
speed that way, then waits for the display.

## Operations

Beside the WebSocket upgrade the relay serves one plain HTTP path, `GET /healthz`, answering
`{ ok, protocol, build, url, rooms, clients, uptimeSeconds }`: the version it speaks, the build it
came from, the `RELAY_PUBLIC_URL` it was given, and how busy it is. `GET` or `HEAD` of any other
path is a 404, any other method a 405. The image, its environment and its sizing are described in
[Development: Relay image](DEVELOPMENT.md#relay-image).

## Match termination

Room states are `lobby`, `running`, and `ended`, with no reverse transition. Start permanently
closes the lobby. New participants require a new room, optionally created from a save; reconnecting
an existing participant is distinct from joining a running match.

A local defeat does not pause the shared clock or end the match while other participants remain
undecided. Once the simulation decides every declared participant, each client stops exactly at
that tick and sends `finish { tick, hash, world }` after its tick acknowledgement. `hash` is the
full simulation state hash (eight lowercase hexadecimal digits), not the per-tick digest; a world
adopted already decided reports its loaded tick.

The relay compares result tick and hash from every connected participant with a loaded, synchronized
world, and holds the result while a connected member is still loading or out of sync. Stale world
generations do not count. Once those reports agree, it stops its clock at the
result tick, clears waiting notices, broadcasts the ended room view and `ended { tick, hash }`. Frames
already emitted beyond that tick are never simulated by clients that reached the shared result.
If every connected participant reports a result but the tick or full hash differs, the relay ends
the room with an explicit result-disagreement error rather than claiming a shared result.
Disconnected identities do not block agreement; reconnect retains the result and permits restoration
and replay up to the final tick without restarting the clock.

A returning client verifies the final hash before it shows the result. Leaving an ended session
releases membership without scheduling a seat handover. Commands, clock changes, kicks, lobby edits
and Start cannot restart the ended session; another match needs a new room.

## Background windows

Window focus and tab visibility do not change room membership: a client that stops ticking but
answers pings is paced for, and one that stops answering is waited for and can be voted out, under
the rules above. Neither is removed on its own, and both drain their buffered frames when they
resume. The desktop window disables Electron's background throttling so a minimized
client keeps ticking.

In a browser the network worker steps and acknowledges on its own `setTimeout` chain, so a hidden tab
whose frame loop stopped does not stop it (see [The client](#the-client)), but the browser slows it. Measured with a dedicated worker running a 20 ms timer chain
and a 20 ms interval, on a tab hidden behind another tab of the same window for seven minutes (macOS):

| Browser | Visible | Hidden |
| --- | --- | --- |
| Chrome 153 | 22 ms per firing | about 95 ms per firing from the moment the tab is hidden, steady for the whole seven minutes, no drop to once per second |
| Safari 27 | not measured, hidden from the start | about 100 ms per firing for four and a half minutes, then the tab stopped reporting at all and stayed silent |
| Firefox 155 | 24 ms per firing | not reached: behind another window and minimized the page never reported itself hidden and kept 24 ms |

The worker's clock owes at most five ticks of wall time per firing, so a clamped 100 ms firing still
delivers up to 50 ticks a second: derived from the clock, not measured in a browser, a hidden Chrome
tab keeps pace up to about speed 4 and trails beyond it. The room is then paced for it, and on return
it drains its buffered frames at the client's catch-up rate. A Safari tab
suspended this way acknowledges nothing and is `silent` after `SILENT_AFTER_MS`; nothing distinguishes
it from a crashed client. Neither case is designed around: the desktop build is the primary target.

## Public relay security boundary

The relay accepts anonymous players. A client-generated token is a bearer secret for reconnecting,
not an account or a ban-resistant identity. The official client generates 24 random bytes; the
relay never publishes tokens in room views or logs. Protect tokens in transit with WSS. Room ids
and nicknames are public, and anyone can enter an open lobby. A modified client can lie about its
simulation or sabotage its own match; digest agreement is not an anti-cheat guarantee.

The host bounds application and unsolicited WebSocket control traffic together at 256 messages/s with a
512-message burst, and 1 MiB/s with a two-blob burst. Recovery requests (`loaded`, `saveOrders`,
`requestInitialSave`) share a separate four-request burst, refilling one request every two seconds,
before relay dispatch. A `saveOrders` or `requestInitialSave` past it is answered `rejected` with
`retryTooSoon` and the connection stays; a `loaded` past it closes the connection as a traffic excess
does, since a refused `loaded` would leave the room waiting for that world, and the reconnect reports
it again. Exceeding a traffic budget disconnects the sender. WebSocket compression is
disabled, payloads are capped, an unacknowledged close is terminated after one second, and a socket
with no incoming transport data for 30 s is closed. Incoming bytes keep a progressing upload alive
before its complete message can be parsed, and keep its sender heard by the relay; application traffic
is still validated and budgeted.
Large outgoing text messages use 32 KiB WebSocket fragments with a control ping after each, so a
passive receiver answers while downloading: at 16 KiB/s an answer comes every two seconds for the
whole message, and the answer to the last one says it has read the message. Matching requested
pongs spend only the byte budget; unsolicited or excess pongs still spend both budgets. Outstanding
ping credits are capped at twice the fragments a full send buffer holds (5462), so every fragment of
a message the buffer accepts gets its ping.
Fragmentation preserves one application message and does not change the game protocol.

The HTTP host caps all TCP connections at the configured WebSocket limit plus 16, including sockets
that have not sent upgrade headers. Headers have a five-second deadline, a request ten seconds, an
idle keep-alive socket Node's default of five seconds, and a keep-alive connection serves at most
100 requests. These bounds do not reserve capacity for legitimate users when an attacker fills every
slot. Limits apply per connection or room, not to process memory or network throughput; sizing a
deployment is covered with the image in [Development: Relay image](DEVELOPMENT.md#relay-image).

A public deployment needs an updated Node/container base, TLS, edge connection/upgrade rate limits,
and explicit process memory/CPU and log limits. Bind the relay only to the proxy's private network
or loopback, block direct public access to its port, run it without root, and give it no host mounts,
secrets or Docker socket. The image already runs as `node` and needs no writable game data; use a
read-only filesystem and drop capabilities. The host does not trust `X-Forwarded-For`; per-address
controls belong at the proxy with a correctly configured trusted-proxy chain. Reconnecting creates a
new socket budget, so edge limits must also cover connection churn. Bandwidth DDoS protection
belongs upstream.
