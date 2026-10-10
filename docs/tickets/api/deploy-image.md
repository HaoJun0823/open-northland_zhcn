# Run the API on the VPS

**Area:** api, tooling · **Priority:** P2

`packages/api/Dockerfile` builds and starts (documented under "API image" in `docs/DEVELOPMENT.md`),
but nothing runs it: the client's default `ON_API_URL` points at `https://api.opennorthland.org`, which
does not exist yet.

## Scope

- Compose or run notes for the VPS beside the relay's: the `/data` volume, a memory limit sized from
  the measured full conversion (peak RSS 1.06 GB, 1.8 GB of data for the whole catalogue),
  `api.opennorthland.org` behind the existing TLS termination, a request rate limit on `/v1` at the
  edge, and the image published the way the relay's is.
- `API_BUILD` set from the build at publish time.

## Verify

- `https://api.opennorthland.org/healthz` reports the build and a fresh sync; `/v1/catalog` answers a
  browser page on another origin; a converted map's terrain document arrives gzipped.
