# Bind the human body's authored idle fidgets

**Area:** app, render · **Priority:** P3

`gfxWaitProgramsBySeq` (`packages/app/src/content/ir/joins.ts`) keeps one standing-wait program per
bobseq, preferring `gfxanimmode 1`. The human binding (`content/settler-gfx/bindings-character.ts`)
therefore loses the other authored one-shot wait actions (2..7): a standing human cannot show those
stretch, glance and scratch programs.

## Scope

- Preserve the human wait ladder per bobseq: a base wait plus its authored one-shot programs.
- Bind those programs to the existing `idleFidgets` presentation scheduler in
  `packages/render/src/data/sprites/settler.ts`; reuse its deterministic per-entity timing and named
  cadence approximation. A fidget plays once before returning to the base wait.
- Preserve bodies without fidget programs and matching head frames. Animal `idleChoices` and extra
  gestures already have their own binding; keep this task to the missing human join.
- No simulation or IR schema changes; the programs already exist in the IR.

## Verify

- Synthetic join/binding tests retain the base wait and all valid one-shot choices, including bodies
  with no fidgets. Frame-selection tests show one complete gesture followed by the base wait and equal
  output for equal entity/tick input.
- Browser: a standing crowd mostly breathes, with occasional complete gestures and neighbouring
  settlers out of step. Run the applicable gates from `docs/TESTING.md`.
