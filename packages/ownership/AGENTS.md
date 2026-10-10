# Ownership package contract

`packages/ownership` decides whether a folder is an installed original game (*Cultures 2*,
*Cultures: Northland*, *Cultures - 8th Wonder of the World*). The desktop shell runs it on
detected and picked folders, the web build on a folder the player picks.
The root [`AGENTS.md`](../../AGENTS.md) applies.

## Boundary

- No runtime dependency and no `fs`, `electron` or DOM import: every read goes through the
  `FolderReader` interface, which the shell implements with Node and the app with browser file
  handles. The package reads only directory listings and file heads, never a whole data file.
- Name matching is case-insensitive at every level: release folders differ in case
  (`DM2`/`Dm2`, `GAME.EXE`).
- The rule keys on data file headers and bundle identifiers, never on an executable: the games
  ship different executables and patched installs replace theirs.
- `releases.ts` labels a recognized install from its library size. A size outside the table is
  still an install; the label only feeds the dialog.
