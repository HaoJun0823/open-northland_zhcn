# Prayer and religion fidelity

Religion already has the main economic loop, but its production cost, action permissions and prayer
locations need correction before tuning balance. Keep this work in the following order; the later
behavior changes require the original-game observations specified in their tickets.

## Evidence and limits

- **Data confirmed:** inspected the owned `jobtypes.ini`, `goodtypes.ini`, decoded base
  `housetypes.cif`, `atomicanimations.cif` and house graphics table; compared the relevant mod
  overrides with the pipeline and generated IR. The owned English manual's Religion, Oil and Temple
  sections corroborate the economic roles. No original content belongs in these tickets.
- **Code confirmed:** the current sim, content joins, HUD and existing tests establish what this
  implementation does. Passing tests do not establish fidelity.
- **Original behavior, pending observation:** the numeric aura rules, site-search details, oil-policy
  semantics and outdoor stand selection below have not been confirmed against the running owned
  original. Treat them as candidates for the prescribed comparison, not completed acceptance.

## What is already present

| Mechanic | Evidence and current implementation |
| --- | --- |
| Religion-dependent trades | `needsReligionFlag` marks `joiner`, `armorer` and `smith`; the autonomous prayer drive reads it. `sewer` can spend religion without that flag. A clip named `carpenter` does not identify a separate runtime trade: resolve its `setatomic` binding. |
| Active prayer | Base and mod prayer clips last 100 ticks and have five channel-4 pulses of +800 at frames 20, 40, 60, 80 and 95. `applyAtomicNeedEvents` applies these pulses, rather than resetting the bar. The sim uses 12 ticks/s. |
| Production cost | Weapon/armour clips carry channel-4 costs, commonly -1500 or -3000. Religion has no passive time drain in the sim. The cost application has defects described below. |
| Oil production | `holy_oil` takes one mushroom; the small druid hut produces oil and the larger hut also produces potions. These recipes and worker slots reach generated content. |
| Temple economy | Owned data and the mod declare no temple workers, stock or products. Its construction includes one oil. The manual also lists no operating inputs or workers. Do not introduce a mandatory priest or recurring temple-oil deliveries. |
| Home provision | Women fetch household goods, including oil. The sim has a durable oil pool and a visible holy-fire overlay. Viking fire anchors start at zero-based house level 2. Other tribes need their own level/graphics comparison. |
| Site hierarchy | The sim tries the resident's lit home, then temple/headquarters. It uses a 40-map-point temple preference and own-player sites. Exact search ordering remains to be observed. |
| Temple aura | The sim gives +250 religion units while reserve is at most 8000, and +50 HP, once/s within 50 hex map points; HP can reach 150%. A damaged temple stops the aura. These exact rules remain pending original-game observation. |

## Differences and change order

| Order | Current difference and consequence | Work |
| --- | --- | --- |
| 1 | A visible craft can pay its channel-4 cost through `applyAtomicNeedEvents` and again through `chargeMilitaryPietyCost`. Conversely, the joiner's wooden spear resolves no production clip and pays zero. This changes how often workers leave production. | [Charge each production event once](production-events.md); coordinate with the existing [product atomic lookup](../../data/production-atomic-disagrees-with-trade.md) task. |
| 2 | `orderNeed` and the prayer drive do not check the resolved atomic permissions. A soldier explicitly forbids prayer; a woman has no prayer permission. The generic civilist clip fallback still resolves prayer for both. The HUD shows a clickable religion row and raises low-religion warnings without the job's religion flag. | [Respect prayer permissions and warnings](prayer-permissions.md); retain the existing [non-praying trade row](../religion-row-for-non-praying-trades.md) observation. |
| 3 | `prayAtHome` enters the dwelling and joins the authored indoor top-up chain. Public prayer uses the normal interaction cell. Original behavior to confirm: pray outside, choosing a usable point from the house's authored work area. Site candidates here are ranked by Manhattan distance to interaction cells, not the original's hex search around building anchors. | [Use outdoor prayer positions](prayer-positions.md). |
| 4 | The oil toggle is settlement-wide and stops demand, delivery, consumption and effects immediately. Original behavior to confirm: a per-house delivery policy leaves an existing fire burning. The sim also burns oil in damaged homes; the original's damaged-house update appears to pause this consumption. | [Separate oil supply from burning](holy-oil.md). |
| 5 | Overlapping temples bless a person only once/s. Original behavior to confirm: each eligible temple contributes, checking the religion threshold for each contribution. The sim also exempts some people's religion bars through its general needs gate. | [Match overlapping temple blessings](temple-blessings.md). |

## Druid boundary

The data binds a heal action with a +1500 target-HP event and a bless action with three +500
target-religion events. The sim has production and carried potion effects, but no druid target-heal
or target-bless planner/effect. That is a missing capability, **not sufficient evidence that both
actions are reachable in normal play**. In particular, the temple declares no druid workplace slot.

Before scheduling druid field behavior, observe an unassigned druid near a wounded person, then a
producing druid under the same conditions; record automatic versus player-issued actions, target
ownership/range, interruption and whether blessing occurs at all. Preserve any confirmed healing
as a separate task. Do not invent priest employment or a religious service loop from the presence
of animation data alone.

## Acceptance across the loop

Use an otherwise identical small settlement in the original and here: a joiner making wooden
spears, a smith making light/heavy weapons, a sewer making armour, a druid producing oil, a woman
supplying a mature home, a headquarters and two temples. Record production count, prayer departure
and return, reserve changes, oil consumption, prayer position and damage response. Repeat with
one temple removed, a blocked door, a damaged building and oil deliveries forbidden.

Check both owned base behavior and supported mod data, keeping intentional mod differences separate.
Run sim determinism/save-restore checks and the applicable gates in [TESTING](../../../TESTING.md).
Each player-visible implementation step needs a muted browser preview; a complete-loop acceptance
scene should exercise production-to-prayer and oil-to-home supply rather than only preset bars.
