# Explain a refused worker assignment

**Area:** sim, app · **Focus:** `packages/sim/src/systems/orders/work/employment.ts`, `packages/app/src/hud/tool-panel/messages` · **Priority:** P2

`assignWorker` (`packages/sim/src/systems/orders/work/employment.ts`) returns without a word when
`openWorkerJobFromList` finds no trade the settler may take at the building. The app sends the order:
a right-click on a workplace with a settler selected enqueues `assignWorkerGroup` with the building's
trades as `jobPriority`. So the settler simply stays where he was. The workplace pick from the action
ring ("Przydziel miejsce pracy") lights the building red and drops the click, also without a reason.

The player meets this in `tutorial_003`: page 11 asks for a new miller, and only a settler with
farmer experience may become one (`Simulation.canChooseJob`). A right-click on the mill with an idle
Viking selected does nothing at all. The baker at the bakery is gated the same way.

That is an action that neither succeeds nor explains its refusal, the defect class of
[defeated-seat orders](defeated-seat-orders-are-silent.md) and [contested ground](contested-ground-feedback.md).

## Scope

- The sim reports a refused worker assignment through one event naming the settler, the building and
  a reason from a closed union: the trade lacks the settler's experience, the workplace is full, or the
  building offers no trade the settler's player may take. The reason comes from the gate that refused,
  never from a second evaluation in the app.
- The message centre shows the local seat's refusal as a short localized line in all four catalogs,
  naming the settler and, for missing experience, the trade whose experience he lacks.
- The ring's workplace pick gives the same line instead of a red light without explanation.

## Verify

- Sim: assigning an idle settler to a mill emits the event with the experience reason; a full farm
  emits the full reason; a successful assignment emits nothing.
- App: the event produces one message line for the local seat and none for another seat.
- Browser `?map=tutorial_003`: after the mill stands, right-click it with an idle Viking selected and
  read the line; the farmer is accepted without one.
