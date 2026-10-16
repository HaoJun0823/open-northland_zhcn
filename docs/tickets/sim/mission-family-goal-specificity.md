# Verify named spouses and their shared home in family lessons

**Area:** sim · **Focus:** authored family goals · **Priority:** P2

Tutorial002 asks Bjoern to marry Ragna and move into the eastern coastal home. Its home goal checks
six housed adults globally and Ragna's proximity to the coast. Neither condition verifies marriage,
the named partner, or residence in that home. During normal play it completed while the couple lived
in Ragna's western home. Merely moving adults near the coast can also satisfy the old child goal;
the corrected child step now requires an owned infant of either sex instead.

The existing mission goal vocabulary cannot query a named person's spouse, a pair's shared residence,
or a child's parents. The infant check establishes that an owned infant is present, excluding the
initial baby after its owner transfer; it does not identify the parents or birth time. Another
family's birth can satisfy it. Do not disguise these gaps with additional population or proximity counts.

## Scope

Provide a generic, explicitly specified mission-content mechanism to express these family relations,
then revise the lesson's home and child conditions. Decide its format and compatibility deliberately;
do not change the semantics or argument meanings of existing opcodes, or key engine behavior on this
map. Preserve the existing all-language instructions and ordinary marriage/home/child commands.

## Verify

Run focused mission regressions, the standard gates and real-content checks. Cover these cases:

- Six housed adults and an unrelated visit to the target area do not satisfy the couple/home task.
- The named spouses sharing another home do not satisfy the requested-home condition.
- The correct named couple sharing the requested finished home does satisfy it.
- An unrelated family's newborn does not satisfy the named couple's child task; their own child does,
  including while indoors and independently of the location where the birth occurred.
- Save/restore retains the necessary evidence and continues these conditions identically.
