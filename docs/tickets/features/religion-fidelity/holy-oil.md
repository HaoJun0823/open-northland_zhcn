# Verify household oil depletion and damage response

**Area:** sim · **Priority:** P3

Oil delivery permission now stops women's household supply while stored oil keeps burning and enables
prayer. The settlement-wide control and current calibration remain: +1000 per oil, capacity 5000,
fetch below 3000, cost 3 per game second, minimum zero-based home level 2.

## Scope

Two edge behaviors need confirmation against the running original before changing them:

- The pool pays only a full cost, leaving a remainder of 1 or 2. Fire activity tests positive stock,
  so this remainder can keep a flame and prayer available indefinitely.
- Finished damaged homes currently continue consuming oil. Confirm whether damage pauses consumption
  and how repair resumes it.

## Verify

Compare oil values 0, 1, 2, 3, 999, 1000 and 3000, then damage/repair, with deliveries prohibited.
Keep consumption, visible fire, HUD and prayer eligibility consistent. The existing home-quality and
holy-fire suites, plus the household-goods acceptance scene, cover the delivery/fire separation.
