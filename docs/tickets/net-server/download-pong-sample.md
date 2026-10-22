# Skip the round-trip sample of a pong that queued behind a download

**Area:** net-server · **Focus:** relay/input-delay · **Priority:** P3

The relay's input-delay estimator (`relay/input-delay.ts`) samples the client's answer to the
once-a-second `ping`. That ping shares the socket with every message the relay sends the client, so
while a snapshot or map is in flight to it, the ping waits behind the 32 KiB fragments still queued
(`TEXT_FRAGMENT_BYTES` in `host/socket-budget.ts`) and its `pong` measures the download, not the link.
The upload side already drops such a sample: `Relay.heard` calls `held()` on the probe while
`client.uploading`, so the pong to a ping outstanding during an upload gives no sample. The download
side has no equivalent. A member that receives a large message, a returning player's snapshot or a
joiner's map, sees its smoothed round trip, its jitter and its assigned input delay rise by about a
tick, and recover only over the following samples. A 512 KiB upload on a 256 KiB/s link raised the
delay to 31 ticks before the upload-side fix; the download path is symmetric and was not measured.

## Scope

Mark the outstanding ping held while a fragmented send to that client is still in flight, so that
pong gives no sample, as the upload side does. The host knows when it fragments a message and when
the last fragment's control pong arrives. Keep the loss to that one sample and leave the smoothing,
the clamp and the reserve unchanged.

## Verify

A net-server test: a client that is downloading a multi-fragment message answers the outstanding
`ping` only once the download ends; its assigned delay does not move. The headless load lab's
`reload` chaos on a `bad` link shows the returning client's input delay unchanged after it received
its snapshot.
