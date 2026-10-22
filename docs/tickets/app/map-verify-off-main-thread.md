# Verify a delivered map off the page's main thread

**Area:** app · **Focus:** content/transfer · **Priority:** P3

A delivered map blob is inflated as a stream, then `JSON.parse`d and verified by `verifyMapDocuments`
(`content/transfer/codec.ts`, `content/transfer/documents.ts`: schema parse and fingerprint) on the
main thread of the lobby page. Measured in Node on the three largest shipped maps, the verify alone
takes 167 ms (czarnoksieznik_z_szeolu), 236 ms (wyspy_polnocy) and 1142 ms (wielka_kolonizacja_iii_1_0);
in a browser on a weak laptop it is several times longer. For that long the lobby draws nothing, the
chat and the ready button do not answer, and the network worker's messages queue. The same verify
runs again on every return to a started room before the world rebuilds.

## Scope

Inflate, parse and verify the map where it does not block the page: in the network worker that
builds the world, or in a worker of its own, handing the main thread the verified documents it needs
for rendering and the lobby's compatibility report. The verify's rules do not change: the same
refusals (not gzip, oversized, wrong fingerprint, schema) reach the player with the same wording.
Count the transfer of the verified documents to the main thread; a structured clone of a large map
may cost as much as the parse, and the measurement decides the seam.

## Verify

The map transfer tests keep passing with the verify moved. In the browser lab, the lobby's long task
count during a map delivery of wielka_kolonizacja_iii_1_0 drops from one task above a second to
none above 50 ms, measured with a `PerformanceObserver` for `longtask` on the creator's and a joiner's
page.
