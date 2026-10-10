# Ship the API as its own image

**Area:** api, tooling · **Priority:** P2
**Blocked by:** [Serve the catalogue](catalogue-service.md)

Without an image and a documented runtime the API exists only on a developer's machine, and the
client tickets have no `ON_API_URL` to point at.

## Scope

- `packages/api/Dockerfile` in the shape of `packages/net-server/Dockerfile`: build on the builder's
  platform, copy only the compiled workspace packages the API imports (`api`, `map-import`, `data`,
  the pipeline decoders it reaches through `map-import`) and their runtime dependencies, run as
  `node`, `HEALTHCHECK` on `/healthz`, labels and license as the relay. The image holds no content
  tree and no mod file; the data dir is a volume.
- Document in `docs/DEVELOPMENT.md` next to the relay section: the `api` and `api:image` root scripts (as `relay` and `relay:image`), the environment
  variables, the volume layout, and how the image is built and pushed the way the relay's is today.
- Compose or run notes for the VPS: memory limit sized from the conversion ticket's peak RSS, the
  volume, `api.opennorthland.org` behind the existing TLS termination, and a request rate limit on
  `/v1` at the edge.

## Verify

- The image builds for `linux/amd64` and `linux/arm64`, starts with an empty volume, syncs, converts
  one entry and answers `/v1/catalog` from a browser page on another origin (CORS).
- `/healthz` fails while the first sync has not completed and passes after.
- `npm run check:docs`.
