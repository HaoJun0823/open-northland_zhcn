# Load a map from the player's own file

**Area:** app, desktop · **Priority:** P2
**Blocked by:** [Browse, download and play catalogue maps](map-catalogue-client.md)

A player with a map folder, a `.zip`/`.rar` from elsewhere or a `.c2m` editor export cannot play it:
nothing in the app reads a file the user picks. `MapProvenance.kind` already has `user` and the lobby
already allows delivering a `user` map, so only the import path is missing. Reference:
[API architecture and flow](../../API.md).

## Scope

- "Load from file" on the catalogue screen and drag-and-drop onto it: an archive or a folder
  (`webkitdirectory` on the web, the native dialog over a narrow IPC on desktop).
- Conversion runs in a Worker with `@open-northland/map-import`, with progress and the typed failures
  shown in words; the same size limits the API uses, as the shared named constants.
- The result is installed through the client ticket's storage with `provenance.kind = 'user'`, the
  archive kept beside it so an `IR_VERSION` bump re-converts locally instead of asking for the file
  again. A re-import of the same fingerprint replaces the entry.
- A user map in a lobby still travels through the relay transfer, as today.

## Verify

- Worker conversion test with a synthetic archive; a browser pass loading a zip, a c2m and a folder;
  the desktop dialog path under `npm run test:desktop`.
- `npm run check`, `npm run build`, `npm test`, browser preview.
