# Fetch catalogue files hosted outside culturesnation.pl

**Area:** api · **Priority:** P3

23 of the 329 catalogue entries point at a file on another host (upstream `mapLauncherFileType`
is null, `/v1/catalog` serves them as `file.kind: 'external'`): hostuje.net (14), moddb.com (5),
Google Drive (2), mediafire.com (2). The API cannot fetch a download page, so these maps never
convert and the client lists them as "download yourself" with the page link. Among them are the
campaign "DOLINA PEŁNA NIESPODZIANEK" (Drive) and the "PDP" campaign series (hostuje.net). Reference:
[API architecture and flow](../../API.md).

## Scope

- One resolver per host in `packages/api/src/catalog/`, turning the entry's page URL into the direct
  file URL the page offers (Drive's export download with its confirm step, moddb's start-download
  mirror, mediafire's download link, hostuje.net's file page). Each resolver is written against the
  host's current page shape and fails closed: an unrecognized page leaves the entry a manual download.
- A resolved file then takes the normal path: kept under its sha256, converted, served at
  `/v1/content/...` and `/v1/maps/<id>/file`; the entry keeps `file.kind: 'external'` with its page
  `url` and gains the kept file's `bytes`, `path` and a `conversion`, so the client treats it like an
  archive entry once converted.
- Resolution runs in the sync with the same download limits and retry rules as upstream archives;
  a host answering with an HTML page instead of an archive counts as a failed download.
- The upstream mock serves the recorded pages and files so the offline run still covers them.

Failure classification and user-facing availability are owned by
[unavailable catalogue links](catalogue-unavailable-links.md).

Non-goals: hosts that need an account or a browser-only step, and any retry schedule that polls a
host more often than the catalogue sync itself.

## Verify

- Tests with recorded page fixtures per host: resolved URL, failed-closed on an unrecognized page,
  HTML-instead-of-archive is `download-failed`.
- One sync against the upstream converts the resolvable entries; report which of the 23 still fail
  and why.
- The client shows a resolved entry as downloadable and a failed one as a manual download.

- Include War of the Sands Legend of the Golden Pharaoh: its downloaded archive is 69,814,638
  bytes, exceeding the deliberate 64 MiB default web import cap. Verify the server/desktop route
  under its applicable limits and clearly explain a refusal; do not raise the browser cap merely
  to admit this archive. Download success alone does not establish conversion or startup success.
