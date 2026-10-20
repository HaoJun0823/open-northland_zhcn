# Establish crop clearing behavior and show a building site's cost

**Area:** app, render · **Priority:** P2
**Needs user:** observe whether the original destroys, keeps, or warns about wheat under a new building.

A building site over standing wheat is accepted. `destroyFieldsUnderBuilding`
(`packages/sim/src/systems/economy/fields.ts`) then destroys crops beneath its footprint without an
event, unlike `berryBushRazed` in `berries.ts`. The allowed/refused build ghost does not distinguish
crops from bare grass, so the player loses farming labor without seeing the cost before the click.

The intended crop behavior is unconfirmed. Readable `landscapetypes.ini` data establishes that the
field does not refuse the site; it does not establish whether the original removes the plants,
leaves them harvestable, or gives feedback.

## Scope

- Observe building placement over standing wheat in the owned original, including plant survival,
  harvestability and any warning or sound. Record that basis before choosing the behavior.
- If crop destruction is confirmed, emit one `fieldRazed` event per cleared field and distinguish
  affected crops in the placement preview. Match observed feedback or name a quiet preview highlight
  as an approximation; do not assume a confirmation dialog.
- If crops survive, correct the destructive path and update the preview to match the established
  behavior instead of adding feedback for a disproved mechanic.

## Verify

A registered building-over-farmland scene and focused tests exercise the established behavior. If
clearing remains, each destroyed field emits one event and the ghost distinguishes the crop cost
before placement. Check the running preview against the recorded observation.
