# Resolve catalogue mission commands that cannot execute

**Area:** sim, app · **Priority:** P2

The catalogue startup audit emitted 18 mission execution warnings on 13 maps. Recognized goals
BuildHouseOnContinent (Wyspiarskie królestwo) and IsLandscapePlayer10ConstructionSignOnPoint
(SPECJALNY CTF: CZTERY PORY ROKU) are reported as unsupported. Other warnings are failed
SetLandscape and SetHouse actions, which do not by themselves prove an implementation defect.
Entry points are `packages/sim/src/systems/missions/` and
`packages/app/src/view/runtime/script-presentation.ts`.

## Scope

- Establish and implement the two unsupported goals using verified data/behavior and deterministic
  simulation rules. Record any remaining approximation explicitly.
- Reproduce SetLandscape failures in Piaski Niezgody, PDP 03, Kraina lawy and Wilczy Ląd, and
  SetHouse in DOLINA PEŁNA NIESPODZIANEK. Separate unavailable types, invalid targets, legitimate
  placement refusal and execution defects; report the actual reason and fix confirmed defects.
- Do not weaken goal checks or fabricate placements to silence a warning. Keep unrelated result
  fidelity work in [the existing ticket](../features/mission-result-world-approximations.md).

## Verify

Exercise both goals through mission progression, positive and negative cases, and save/hash
consistency. Cover failed action reasons at the owning layer and rerun affected map starts.
