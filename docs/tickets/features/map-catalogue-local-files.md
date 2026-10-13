# Complete local map import on desktop

**Area:** app, desktop · **Priority:** P2

Web ZIP/RAR/C2M and folder import is implemented through a conversion Worker, retained source
storage, reconversion after IR changes and the installed-map store. Desktop local import is still
disabled in `catalogue/view.ts` and `network/map-pick.ts`. Its storage adapter returns no retained
source and refuses local-source writes, so simply showing the web controls would not complete it.

## Scope

- Expose file/folder selection and drag-and-drop for desktop with a narrow validated native dialog
  boundary. Reuse the shared conversion Worker and typed progress/failure presentation.
- Persist original input and source metadata alongside converted map generations. Keep replacement
  atomic and reject unsafe paths, symlinks and excessive input before reading or writing it.
- Implement source reads, removal and reconversion after an IR bump in the desktop storage adapter.
  Preserve map IDs and reject stale replacements; retain a usable earlier install on failure.
- Make the controls available in the catalogue and multiplayer map picker once the full path works.
  Keep existing per-import limits; desktop has no aggregate browser storage budget.

## Verify

Desktop E2E chooses a ZIP, C2M and folder through the native path, imports, starts the map, quits,
relaunches and starts it again. Verify retained-source rebuild, duplicate import, cancellation and
failed replacement without losing an existing pack. Cover malicious path/input cases with synthetic
fixtures. Run desktop tests and the applicable standard gates.
