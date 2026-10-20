# Cover need-drive thresholds in the integration golden

**Area:** sim · **Priority:** P3

`packages/sim/test/core/golden-trace.test.ts` runs its economy slice for 1000 ticks without an authored
high starting need or an assertion that eating or sleeping occurs. Its trace covers work and short
work-rest clips, but contains neither the eat atomic (10) nor sleep atomic (8). Rising needs are
hashed as component state; their drives are not exercised by this integration golden.

Starting deficits are seeded below half a bar (`NEED_INIT_SPREAD_UNITS` in
`systems/lifecycle/needs/system.ts`). The short run does not raise them to `NEED_DRIVE_THRESHOLD`;
check the current fixture's clip spending when selecting the new setup.

## Scope

- Make the integration slice reach both drives, either by lengthening the run past the crossings or
  by authoring a high starting deficit. Keep the trace readable and provide the food/rest setup
  required to complete the actions.
- Assert eat (10) and sleep (8) entries in the atomic-action trace, alongside the existing economy
  assertions.
- Move the golden hash and trace deliberately, naming the newly covered behavior as required by
  `packages/sim/AGENTS.md`.

## Verify

Run `npm test`. Confirm the new trace completes both needs atomics and still proves the slice's goods
chain and invariants; the deliberately updated golden then holds on repeated runs.
