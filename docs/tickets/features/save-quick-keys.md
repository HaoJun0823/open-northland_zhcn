# Add quicksave and quickload without opening a panel

**Area:** app · **Focus:** save/load, controls · **Priority:** P2

Escape opens the system menu, and F3/F4 open the load/save panels through the stored key bindings.
There is still no quicksave that writes a reserved slot without opening a panel, or quickload that
restores that slot. Reuse the existing save controller and configurable input path.

## Scope

- Bind a rebindable quicksave action that writes a reserved slot without opening a panel, and a
  quickload action that restores it through the existing confirm dialog.
- Report success and failure through the HUD because no save panel is open. Keep the current menu,
  save-panel and load-panel bindings working.
- The reserved slot is an ordinary save file, visible and loadable in both browser and desktop lists.
- Follow the existing controller's load eligibility, session restrictions and cross-world relaunch
  behavior; do not introduce a separate restoration path.

## Verify

- Quicksave then quickload restores the captured world state hash, and the slot appears in both stores.
- Rebinding works; a missing quicksave and a refused save/load report a useful HUD message.
- Quickload of another world's slot follows the same relaunch and validation path as panel loading,
  including leaving the running game intact when validation fails.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass on a real map.
