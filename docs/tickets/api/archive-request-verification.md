# Bound archive verification work for public requests

**Area:** api · **Priority:** P2

`ConversionService.keptFile` verifies the entire retained archive before `serveKeptFile` handles
HEAD or `If-None-Match`. A conditional request for an 8 MiB synthetic archive reads and hashes all
8 MiB before returning a zero-body 304. Archives can be 64 MiB. Unauthenticated repeated requests
can consume disk bandwidth and CPU without receiving an archive; disconnects do not cancel the
verification pass.

## Scope

- Coalesce simultaneous verification and reuse a successful result only while the immutable file's
  identity and relevant metadata remain unchanged. Keep the verified file handle as the response
  source and preserve refusal of replaced or corrupt archives.
- Bound verification concurrency and stop unnecessary work when requesting clients disconnect.
- Keep HEAD and conditional responses correct without an unconditional full read per request.

## Verify

Instrument reads of a synthetic retained archive: repeated and concurrent HEAD/conditional requests
perform bounded verification passes. Corruption and atomic replacement invalidate the result; a
replacement during verification cannot pair one file's hash with another file's stream. Disconnects
and failures close all handles. Run focused API storage and HTTP tests.
