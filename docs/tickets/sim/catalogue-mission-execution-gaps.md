# Resolve remaining catalogue mission execution failures

**Area:** sim, app · **Priority:** P2

`IsLandscapePlayer10ConstructionSignOnPoint`, authored by SPECJALNY CTF: CZTERY PORY ROKU, remains
unsupported (`packages/sim/test/systems/missions/opcode-support.test.ts`). Other catalogue-start warnings
reported failed `SetLandscape` and `SetHouse` actions; these require reproduction and do not alone
prove an implementation defect. Entry points are `packages/sim/src/systems/missions/` and
`packages/app/src/view/runtime/script-presentation.ts`.

## Scope

- Establish and implement the construction-sign goal using verified data/behavior and deterministic
  simulation rules. Record any remaining approximation explicitly.
- Reproduce `SetLandscape` failures in Piaski Niezgody, PDP 03, Kraina lawy and Wilczy Ląd, and
  `SetHouse` in DOLINA PEŁNA NIESPODZIANEK. Separate unavailable types, invalid targets, legitimate
  placement refusal and execution defects; report the actual reason and fix confirmed defects.
- Rerun the affected map starts to establish the remaining warnings. Do not weaken goal checks or
  fabricate placements to silence a warning. Keep unrelated result fidelity work in
  [the existing ticket](../features/mission-result-world-approximations.md).

## Verify

Exercise the construction-sign goal through mission progression, positive and negative cases, and
save/hash consistency. Cover confirmed failed-action reasons at the owning layer and rerun affected
map starts. Existing continent-goal regressions continue passing.
