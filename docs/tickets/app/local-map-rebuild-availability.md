# Keep installed maps accessible while local sources rebuild

**Area:** app · **Priority:** P2

`map-source/sources.ts` awaits `prepareLocal` before listing any installed maps.
`restoreLocalMaps` rebuilds stale sources sequentially without a deadline or cancellation, and
`local-import/client.ts` only terminates its Worker on completion, error or caller abort. A stalled
RAR WASM request or conversion therefore blocks every installed map lookup. The catalogue loads
installed records only after this preparation, preventing removal or manual retry of the bad source.

## Scope

Make rebuilds bounded and cancellable, and expose their progress/failure without withholding unrelated
valid installations. Keep source identity and atomic replacement guards; stale maps must not start
with incompatible data. A failed source remains removable and manually retryable. Do not introduce
an unbounded background worker pool.

## Verify

A never-resolving converter and stalled worker dependency cannot hide unrelated installed maps.
Cancellation terminates the worker, keeps the previous source/pack, and allows explicit retry.
Exercise stale-source rebuild and healthy installed-map selection together in the catalogue.
