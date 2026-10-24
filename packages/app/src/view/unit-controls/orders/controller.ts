import type { UiCue } from '@open-northland/audio';
import { type ContentSet, type EquipCategory, lastByTypeId } from '@open-northland/data';
import type { ElevationField, OrderMarkerKind, TargetFlashTone } from '@open-northland/render';
import {
  type Command,
  type Entity,
  type EquipPickEntry,
  entityById,
  type FormationSlotGroup,
  type HalfCellNode,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  type PlayerCommand,
  systems,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  canOpenChest,
  chestKindOf,
  commandedVehicleOf,
  isBuilding,
  isSettler,
  isVehicle,
  num,
  positionOf,
  settlerJobType,
  vehicleSeatsOf,
  workplaceOf,
} from '../../../game/snapshot/index.js';
import type { GoodIconPainter } from '../../../hud/dom/good-art.js';
import { clampTile, nodeBounds, pickNearestAt, pickTopAt, type Tile, worldToTile } from '../../picking.js';
import { tradeHousePick } from '../highlights/index.js';
import { selectionEquipCommands } from '../panels/equip-picker.js';
import { openSchoolDialog, type SchoolDialog } from '../panels/school-dialog.js';
import type { TechnologyStatusRead } from '../types.js';
import type { UnitTargetKind, UnitTargets } from '../unit-targets.js';
import type { AnsweredOrders } from './answered.js';
import { createBuildingOrders } from './building.js';
import { assignFormation, type FormationUnit, pairFormation } from './formation.js';
import { enqueueArmyOrder, enqueueUnitSelection } from './group.js';
import { afterClickAnswer, createPendingGroundOrders, type PendingGroundOrders } from './pending-ground.js';

export interface UnitOrderDeps {
  readonly uiscale?: number;
  /** Fresh legal destinations from the simulation, requested only as a ground click lands. */
  readonly requestFormationSlots?:
    | ((
        target: HalfCellNode,
        members: readonly Entity[],
        rowSpacing: 1 | 2,
      ) => Promise<readonly FormationSlotGroup[] | null>)
    | undefined;
  readonly pendingGroundOrders?: PendingGroundOrders | undefined;
  /** The selected vehicles the vehicle controller drives on the same right click. */
  readonly drivenVehicles?: (() => readonly number[]) | undefined;
  /** Defer this press's normal acknowledgement until its queried formation is accepted. */
  readonly deferGroundConfirmation?: (() => () => void) | undefined;
  readonly technologyStatus?: TechnologyStatusRead | undefined;
  /** Bumped when a `technologyStatus` answer changes, which the school dialog rebuilds on. */
  readonly technologyVersion?: (() => number) | undefined;
  /** The sim's equip pick-list (`SessionHost.equipPickList`), asked as the click lands; absent, a click
   *  on a goods heap is a walk. */
  readonly requestEquipPicks?:
    | ((entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>)
    | undefined;
  /** Where the orders a host answer decides wait for it. */
  readonly answered: AnsweredOrders;
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly onOrderLimit?: (() => void) | undefined;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  readonly selectOwnSettler: (id: number) => void;
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
  /** The GUI click the school dialog's buttons confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
  /** Paints the school dialog's goods; absent, it lists names alone. */
  readonly icons?: GoodIconPainter;
  /** Answers a walk none of its movers can take; absent, the fail click does. */
  readonly refuse?: ((movers: readonly number[]) => void) | undefined;
  /** The sim's trade-stop rule, asked as the click lands; absent, a trader's right-click puts no house on
   *  its route. */
  readonly askAttachTradeHouse?: ((trader: number, house: number) => Promise<boolean>) | undefined;
  /** Acknowledges a walk or march on the ground where it was aimed; absent, nothing is drawn. */
  readonly markOrder?: ((node: Tile, kind: OrderMarkerKind) => void) | undefined;
  /** Flashes an order's target once; absent, nothing is drawn. */
  readonly flashTarget?: ((entity: number, tone: TargetFlashTone) => void) | undefined;
}

/**
 * Every order reports whether it commanded anyone: a press that finds no settler in the selection, or
 * no target under the cursor, issues nothing, and the caller's click feedback follows that answer.
 */
export interface UnitOrderController {
  /** `onBuilding` is a building resolved from a marker rather than the world pixel under the cursor
   *  (a garrison flag hangs far above the tower it stands for). True when the press selected a settler
   *  or gave the selected settlers an order. With Shift, each settler's order waits behind its current
   *  one; one whose order is a standing setting (a post, a home, a lesson, a gathered good or a trade
   *  stop) walks to the spot instead. */
  issueRightClick(event: MouseEvent, onBuilding?: number | null): boolean;
  /** The trade-route toggle for the selected traders off the map (riding inside a cart, or inside a
   *  house), which the settlers' click skips, and for the crew of a selected cart, whose window shows its
   *  trader's route. True when any of them took the click; `onNoneTook` runs once the sim refused every
   *  one asked about, so the cart can take the click instead. A trade stop is a standing setting, so a
   *  Shift click leaves a cart's trader to the cart, which drives there queued; a trader inside a house
   *  has nowhere to walk and still toggles the stop. */
  issueRiderTradeHouse(
    event: MouseEvent,
    onBuilding: number | null | undefined,
    onNoneTook: () => void,
  ): boolean;
  /** Move the selected gatherers' work flags to a world click; clicking a resource also narrows their
   *  gathering filter to that resource's good. */
  issueSetWorkFlagAt(event: MouseEvent): boolean;
  /** The ground orders name a half-cell node rather than a cursor, so the map overview can issue them
   *  for a spot the camera is nowhere near. Off-map nodes clamp into the map here. `units`, when given,
   *  narrows these orders to the selected settlers an armed order was issued for. A `queued` walk waits
   *  behind each settler's current order (shift-click). */
  issueSetWorkFlag(target: Tile, units?: readonly number[], unassignFirst?: boolean): boolean;
  /** `vehicles` are the ones the same press drives itself. */
  issueMoveTo(
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles?: readonly number[],
  ): boolean;
  /** `vehicles` are the ones the same press marches itself. */
  issueAttackMove(
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles?: readonly number[],
  ): boolean;
  /** Strike one enemy of an accepted kind under the cursor; a click that hits none orders nothing. A
   *  `queued` strike waits behind each settler's current order. */
  issueAttackTarget(
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
    queued?: boolean,
  ): boolean;
  /** Strike the wild creature under the cursor; a click that hits none orders nothing. */
  issueAttackAnimal(event: MouseEvent, units?: readonly number[], queued?: boolean): boolean;
  /** Offer `units` the courses of the school `house`; false when none of them may learn there. */
  openSchool(house: number, units: readonly number[]): boolean;
  refresh(): void;
  setUiScale(scale: number): Promise<void>;
  dispose(): void;
}

type WalkOrderKind = Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>['kind'];

/** What a right-click lands on, read as it lands: an order decided later still aims there. */
interface RightClickAim {
  /** Any building under the cursor, a trader's route candidate. */
  readonly house: number | null;
  /** An own building under the cursor, the ladder's building rung. */
  readonly building: number | null;
  /** An own wall or road site under the cursor, which the selected builders take as their site. */
  readonly site: number | null;
  readonly tile: Tile;
}

/** Whether the snapshot settler's fixed `group` slot already holds `goodType`, worn or not. */
function wearsGood(
  components: Readonly<Record<string, unknown>>,
  group: Exclude<EquipCategory, 'misc'>,
  goodType: number,
): boolean {
  const equipment = components.Equipment as
    | Partial<Record<Exclude<EquipCategory, 'misc'>, { readonly goodType?: unknown } | null>>
    | undefined;
  return equipment?.[group]?.goodType === goodType;
}

export function createUnitOrderController(deps: UnitOrderDeps): UnitOrderController {
  const pending = deps.pendingGroundOrders ?? createPendingGroundOrders();
  if (deps.pendingGroundOrders === undefined) {
    const enqueue = deps.enqueue;
    deps = { ...deps, enqueue: (command) => pending.submit(command, enqueue) };
  }
  let disposed = false;
  let school: SchoolDialog | undefined;
  let uiScale = deps.uiscale ?? 1;
  const goodsByType = lastByTypeId(deps.content.goods);
  const vehiclesByType = lastByTypeId(deps.content.vehicles);
  const onOrderLimit = (): void => {
    deps.onOrderLimit?.();
    deps.cue?.('fail');
  };

  const standingTile = (ref: number): Tile | undefined => {
    const entity = entityById(deps.snapshot(), ref);
    const position = entity === undefined ? undefined : positionOf(entity);
    if (position === undefined) return undefined;
    const node = nodeOfPosition(position.x, position.y);
    return { col: node.hx, row: node.hy };
  };

  const occupiedTiles = (exclude: ReadonlySet<number>): ((col: number, row: number) => boolean) => {
    const occupied = new Set<string>();
    for (const entity of deps.snapshot().entities) {
      if (exclude.has(entity.id)) continue;
      if (!isSettler(entity) && !isBuilding(entity)) continue;
      const position = positionOf(entity);
      if (position === undefined) continue;
      const node = nodeOfPosition(position.x, position.y);
      occupied.add(`${node.hx},${node.hy}`);
    }
    return (col, row) => occupied.has(`${col},${row}`);
  };

  // A carrying settler stays in the formation: the sim makes it set its load down before walking, so
  // there is no client-side filtering.
  const issueWalkOrder = (
    target: Tile,
    allMovers: readonly FormationUnit[],
    kind: WalkOrderKind,
    queued = false,
    drivenVehicles: ReadonlySet<number> = new Set(),
  ): boolean => {
    // A commander's queued walk would queue a drive of its vehicle beside the one the same press gives
    // the vehicle itself, so it stays out; an unqueued one only replaces that drive.
    const movers = queued ? withoutDrivenCommanders(allMovers, drivenVehicles) : allMovers;
    if (movers.length === 0) return allMovers.length > 0;
    if (movers.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const { width, height } = nodeBounds(deps.mapSize);
    const seat = clampTile(target, width, height);
    const snapshot = deps.snapshot();
    const military = movers.some((mover) => {
      const self = entityById(snapshot, mover.ref);
      return self !== undefined && systems.isFighterJob(deps.content, settlerJobType(self) ?? null);
    });
    const dispatch = (
      currentMovers: readonly FormationUnit[],
      groups: readonly FormationSlotGroup[] | null,
    ): boolean => {
      const orders =
        groups === null
          ? assignFormation(
              currentMovers,
              seat,
              width,
              height,
              occupiedTiles(new Set(currentMovers.map((mover) => mover.ref))),
              military ? 2 : 1,
            )
          : groups.flatMap((group) => {
              const ids = new Set<number>(group.members);
              return pairFormation(
                currentMovers.filter((mover) => ids.has(mover.ref)),
                seat,
                group.slots.map(({ hx, hy }) => ({ col: hx, row: hy })),
              );
            });
      const members = orders.map((order) => ({
        entity: order.ref as Entity,
        x: order.tile.col,
        y: order.tile.row,
      }));
      if (members.length === 0) {
        if (deps.refuse !== undefined) deps.refuse(currentMovers.map((mover) => mover.ref));
        else deps.cue?.('fail');
        return false;
      }
      const accepted = enqueueArmyOrder(
        {
          kind: kind === 'moveUnit' ? 'moveUnitGroup' : 'attackMoveUnitGroup',
          members,
          ...(queued ? { queued: true } : {}),
        },
        deps.enqueue,
        onOrderLimit,
      );
      if (!accepted) return false;
      deps.markOrder?.(seat, kind === 'attackMoveUnit' ? 'attack' : 'move');
      return true;
    };
    const request = deps.requestFormationSlots;
    if (request === undefined) return dispatch(movers, null);
    const vehicles = new Map<number, number[]>();
    for (const { ref } of movers) {
      const self = entityById(snapshot, ref);
      const vehicle = self === undefined ? undefined : commandedVehicleOf(snapshot, self);
      if (vehicle !== undefined) vehicles.set(ref, [vehicle]);
    }
    const ticket = pending.begin([...movers.map(({ ref }) => ref), ...[...vehicles.values()].flat()], queued);
    const current = ({ ref }: FormationUnit): boolean => {
      const aliases = vehicles.get(ref);
      return pending.current(ticket, ref) && (aliases?.every((id) => pending.current(ticket, id)) ?? true);
    };
    const acknowledge = deps.deferGroundConfirmation?.();
    // The query reads the actual terrain and structure bodies on its simulation thread. A newer
    // unqueued command cancels only its own actors; a captain also follows its vehicle's intent.
    // Shift waits for overlapping predecessors, including those same vehicle aliases.
    const refused = (): void =>
      pending.settle(ticket, () => {
        if (!disposed && movers.some(current)) deps.cue?.('fail');
      });
    try {
      void request(
        { hx: seat.col, hy: seat.row },
        movers.map(({ ref }) => ref as Entity),
        military ? 2 : 1,
      ).then((groups) => {
        for (const group of groups ?? []) {
          if (group.commandedVehicle === undefined) continue;
          for (const entity of group.members) {
            if (!pending.current(ticket, entity)) continue;
            const aliases = vehicles.get(entity) ?? [];
            if (!aliases.includes(group.commandedVehicle)) aliases.push(group.commandedVehicle);
            vehicles.set(entity, aliases);
          }
        }
        // Keep earlier aliases too: unloading after the click must not revive it as a foot order.
        pending.includeActors(ticket, [...vehicles.values()].flat());
        pending.settle(ticket, () => {
          if (disposed) return;
          const currentMovers = movers.filter(current);
          if (currentMovers.length > 0 && dispatch(currentMovers, groups)) acknowledge?.();
        });
      }, refused);
    } catch {
      refused();
    }
    return true;
  };

  const openSchool = (house: number, units: readonly number[]): boolean => {
    school?.dispose();
    school = openSchoolDialog({
      content: deps.content,
      snapshot: deps.snapshot,
      settlers: units,
      house,
      enqueue: deps.enqueue,
      status: deps.technologyStatus,
      answersVersion: deps.technologyVersion,
      cue: deps.cue,
      icons: deps.icons,
      onOrderLimit,
      scale: uiScale,
    });
    return school !== undefined;
  };

  const issueRightClick = (event: MouseEvent, onBuilding?: number | null): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const own = pickTopAt(deps.targets.owned('settler'), world.x, world.y);
    if (own !== null) {
      deps.selectOwnSettler(own);
      deps.openActions({ x: event.clientX, y: event.clientY });
      return true;
    }
    // A selected building, flag or signpost takes no orders: nobody to command, nothing to confirm.
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
    if (commanded.length === 0) return false;
    if (commanded.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const chest = pickTopAt(deps.targets.chests(), world.x, world.y);
    const animal = pickTopAt(deps.targets.claimableLivestock(), world.x, world.y);
    const goods = deps.targets.goods();
    const pile = pickTopAt(goods, world.x, world.y);
    const pileGood = pile === null ? undefined : goods.find((target) => target.ref === pile)?.goodType;
    const queued = event.shiftKey;
    // The scouts go after a claimable animal; the rest take the ladder, which strikes an enemy's animal.
    // An animal the scouts are claiming is struck by nobody: the others take their order under it.
    const unclaiming = animal === null ? commanded : claimAnimal(commanded, animal, queued);
    if (unclaiming.length === 0) return true;
    const claimed = unclaiming.length < commanded.length ? animal : null;
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null && enemy !== claimed) return strike(unclaiming, enemy, queued);
    const prey = pickTopAt(deps.targets.wildlife(), world.x, world.y);
    const rest = prey === null || prey === claimed ? unclaiming : huntWithFighters(unclaiming, prey, queued);
    if (rest.length === 0) return true;
    // A chest nobody selected may open is walked to like any ground.
    if (chest !== null && openChest(rest, chest, queued)) return true;
    if (
      pile !== null &&
      pileGood !== undefined &&
      systems.isFoodIn(deps.content, systems.edibleGoodFormOf(deps.content, pileGood))
    ) {
      const eating = enqueueArmyOrder(
        {
          kind: 'unitActionGroup',
          members: rest.map((unit) => ({ entity: unit.ref as Entity })),
          action: { kind: 'orderNeed', need: 'hunger', ...(queued ? { queued } : {}) },
        },
        deps.enqueue,
        onOrderLimit,
      );
      if (eating) deps.flashTarget?.(pile, 'order');
      return eating;
    }
    const aim: RightClickAim = {
      house: onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y),
      building: onBuilding ?? pickTopAt(deps.targets.owned('building'), world.x, world.y),
      site: siteAt(world.x, world.y),
      // A marker's building is walked to where it stands, not to the ground under its flag.
      tile:
        (onBuilding === null || onBuilding === undefined ? undefined : standingTile(onBuilding)) ??
        worldToTile(world.x, world.y, deps.elevation),
    };
    if (
      pile !== null &&
      pileGood !== undefined &&
      wearFromGround(rest, pile, pileGood, (unworn) => rightClickRest(event, unworn, aim, queued), queued)
    ) {
      return true;
    }
    // A gathered good is a standing setting, so a Shift click on a resource walks there.
    const others = queued ? rest : gatherFromResource(rest, world.x, world.y);
    if (others.length === 0) return true;
    return rightClickRest(event, others, aim, queued);
  };

  /** The fighters among `commanded` strike a wild animal; returns the rest for the usual ladder. Original
   *  behavior: the right click offers every settler the attack-animal order; here only fighters take it. */
  const huntWithFighters = (
    commanded: readonly FormationUnit[],
    prey: number,
    queued: boolean,
  ): readonly FormationUnit[] => {
    const snapshot = deps.snapshot();
    const fighters: FormationUnit[] = [];
    const others: FormationUnit[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      const fighter = self !== undefined && systems.isFighterJob(deps.content, settlerJobType(self) ?? null);
      (fighter ? fighters : others).push(unit);
    }
    // Fighters whose strike is refused take the click's normal order with the rest.
    if (fighters.length === 0 || !strike(fighters, prey, queued)) return commanded;
    return others;
  };

  /** A right click on a resource switches the gatherers among `commanded` that gather its good to it,
   *  leaving their work flag where it stands (Ctrl moves the flag too); returns the rest. */
  const gatherFromResource = (
    commanded: readonly FormationUnit[],
    wx: number,
    wy: number,
  ): readonly FormationUnit[] => {
    const resources = deps.targets.resources();
    const resource = pickNearestAt(resources, wx, wy);
    const goodType =
      resource === null ? undefined : resources.find((target) => target.ref === resource)?.goodType;
    if (goodType === undefined) return commanded;
    const snapshot = deps.snapshot();
    const gathers = (unit: FormationUnit): boolean => {
      const self = entityById(snapshot, unit.ref);
      const job = self === undefined ? undefined : settlerJobType(self);
      return (
        job !== undefined &&
        systems.jobChangesProduction(deps.content, job) &&
        systems.jobGathersGood({ content: deps.content }, job, goodType)
      );
    };
    const others: FormationUnit[] = [];
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      if (gathers(unit)) commands.push({ kind: 'setGatherGood', entity: unit.ref as Entity, goodType });
      else others.push(unit);
    }
    enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    return others;
  };

  /** The ladder past the goods heap: a trader's route toggle, then the building, then the walk. A trader
   *  the sim then refuses the house to takes the rest of the ladder once the answer lands. A route stop is
   *  a standing setting, so a `queued` click skips the toggle. */
  const rightClickRest = (
    event: MouseEvent,
    commanded: readonly FormationUnit[],
    aim: RightClickAim,
    queued: boolean,
  ): boolean => {
    if (queued) return orderPastRoute(event, commanded, aim, true);
    const routed = routeTradeHouse(commanded, aim.house, (refused) =>
      orderPastRoute(event, refused, aim, false),
    );
    const others = routed.size === 0 ? commanded : commanded.filter((unit) => !routed.has(unit.ref));
    if (others.length === 0) return true;
    return orderPastRoute(event, others, aim, false) || routed.size > 0;
  };

  const orderPastRoute = (
    event: MouseEvent,
    units: readonly FormationUnit[],
    aim: RightClickAim,
    queued: boolean,
  ): boolean => {
    if (aim.building !== null) {
      return queued
        ? queueAtBuilding(units, aim.building, aim.tile)
        : orderAtBuilding(event, units, aim.building);
    }
    if (aim.site !== null) return orderAtSite(units, aim.site, aim.tile, queued);
    return walkTo(aim.tile, units, queued);
  };

  /** A `queued` walk leaves out the commanders of the vehicles the same press drives (`issueWalkOrder`). */
  const walkTo = (tile: Tile, units: readonly FormationUnit[], queued: boolean): boolean =>
    issueWalkOrder(tile, units, 'moveUnit', queued, queued ? new Set(deps.drivenVehicles?.()) : undefined);

  const { siteAt, orderAtSite, queueAtBuilding, orderAtBuilding } = createBuildingOrders({
    ...deps,
    onOrderLimit,
    walkTo,
    openSchool,
  });

  /**
   * Original behavior: a trader's right-click on a standing house puts it on the trade route, another
   * tribe's house included, and takes it off when the route already names it. Which houses a route
   * takes is the sim's rule, asked as the click lands. The traders that took the click are returned,
   * those asked about included; the rest of the selection handles the click as usual, and the asked
   * traders the sim refuses reach `onRefused` once the answer lands.
   */
  const routeTradeHouse = <U extends { readonly ref: number }>(
    commanded: readonly U[],
    house: number | null,
    onRefused: (refused: readonly U[]) => void,
  ): Set<number> => {
    const routed = new Set<number>();
    const ask = deps.askAttachTradeHouse;
    if (house === null) return routed;
    const snapshot = deps.snapshot();
    const asked: U[] = [];
    const detached: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !systems.isTraderJob(deps.content, settlerJobType(self) ?? null)) continue;
      if (tradeHousePick.onRoute(snapshot, house, unit.ref)) {
        detached.push({ kind: 'detachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      } else if (ask !== undefined) asked.push(unit);
      else continue;
      routed.add(unit.ref);
    }
    enqueueUnitSelection(detached, deps.enqueue, onOrderLimit);
    if (ask === undefined || asked.length === 0) return routed;
    deps.answered.after(Promise.all(asked.map((unit) => ask(unit.ref, house))), (verdicts) => {
      const refused = asked.filter((_unit, index) => verdicts[index] !== true);
      const attached: UnitSelectionCommand[] = [];
      for (const unit of asked) {
        if (refused.includes(unit)) continue;
        attached.push({ kind: 'attachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      }
      enqueueUnitSelection(attached, deps.enqueue, onOrderLimit);
      if (refused.length > 0) onRefused(refused);
    });
    return routed;
  };

  /** A house click for the selected settlers off the map and the riders of a selected cart. A ship's
   *  passengers are left out: the ship takes the click itself, as its window has no Trade tab. */
  const issueRiderTradeHouse = (
    event: MouseEvent,
    onBuilding: number | null | undefined,
    onNoneTook: () => void,
  ): boolean => {
    const queued = event.shiftKey;
    const snapshot = deps.snapshot();
    const traders: { readonly ref: number }[] = [];
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e === undefined) continue;
      if (!isVehicle(e)) {
        const riding = e.components.Rider !== undefined;
        if (positionOf(e) === undefined && !(queued && riding)) traders.push({ ref: id });
        continue;
      }
      if (queued) continue;
      const v = e.components.Vehicle as { vehicleType?: unknown; passengers?: unknown };
      const type = vehiclesByType.get(num(v.vehicleType) ?? -1);
      if (type === undefined || systems.isShipVehicle(type)) continue;
      for (const seat of vehicleSeatsOf(v.passengers)) traders.push({ ref: seat.entity });
    }
    const uniqueTraders = [...new Map(traders.map((unit) => [unit.ref, unit])).values()];
    if (uniqueTraders.length === 0) return false;
    if (uniqueTraders.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const world = deps.toWorld(event.clientX, event.clientY);
    const house = onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y);
    const took = routeTradeHouse(uniqueTraders, house, (refused) => {
      if (refused.length === took.size) onNoneTook();
    });
    return took.size > 0;
  };

  /** Send every commanded settler that may open the chest; true when anyone was sent. Filtered here as
   *  the original's default click offers it only to a settler that may open it, and so a settler the
   *  sim would refuse never lands in the replay log; the sim re-checks each on arrival, so two senders
   *  race and the loser walks back into autonomy. A `queued` chest waits behind each one's current order. */
  const openChest = (commanded: readonly FormationUnit[], chest: number, queued = false): boolean => {
    const snapshot = deps.snapshot();
    const target = entityById(snapshot, chest);
    const kind = target === undefined ? undefined : chestKindOf(target);
    if (kind === undefined) return false;
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !canOpenChest(self, kind, deps.content)) continue;
      commands.push({
        kind: 'openChest',
        entity: unit.ref as Entity,
        chest: chest as Entity,
        ...(queued ? { queued } : {}),
      });
    }
    const sent = enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    if (sent) deps.flashTarget?.(chest, 'order');
    return sent;
  };

  /** Send every commanded scout after `animal`, queued behind its current order when `queued`, and flash
   *  the animal; returns the units that are not scouts. The sim judges the animal when each order starts. */
  const claimAnimal = (
    commanded: readonly FormationUnit[],
    animal: number,
    queued = false,
  ): readonly FormationUnit[] => {
    const snapshot = deps.snapshot();
    const others: FormationUnit[] = [];
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !systems.isScoutJob(deps.content, settlerJobType(self) ?? null)) {
        others.push(unit);
        continue;
      }
      commands.push({
        kind: 'claimAnimal',
        entity: unit.ref as Entity,
        animal: animal as Entity,
        ...(queued ? { queued } : {}),
      });
    }
    if (enqueueUnitSelection(commands, deps.enqueue, onOrderLimit)) deps.flashTarget?.(animal, 'order');
    return others;
  };

  /**
   * Send every commanded settler that may wear the clicked good to put it on; true when anyone was sent.
   * The original's default click on a good lying on the ground (a landscape
   * of a good's `landscapetype`): each selected human who can equip the good now and does
   * not already wear that item type gets the equip order by good type, so the sim fetches its nearest
   * reachable unit rather than this exact heap. A misc good (mead, potions, amulets) skips the worn
   * check, as its slots stack. The gate is the sim's pick list, the same read the equip window shows.
   * Unlike an order from the equip window or the ring, the settler does not walk back to where it stood.
   * `queued` waits behind each settler's current order.
   */
  const wearFromGround = (
    commanded: readonly FormationUnit[],
    pile: number,
    goodType: number,
    onNoneWears: (commanded: readonly FormationUnit[]) => void,
    queued = false,
  ): boolean => {
    const request = deps.requestEquipPicks;
    const group = goodsByType.get(goodType)?.equip?.category;
    if (request === undefined || group === undefined) return false;
    const snapshot = deps.snapshot();
    const candidates = commanded
      .map((unit) => unit.ref)
      .filter((ref) => {
        const self = entityById(snapshot, ref);
        return self !== undefined && (group === 'misc' || !wearsGood(self.components, group, goodType));
      });
    if (candidates.length === 0) return false;
    // The pick lists are asked as the click lands and answered in click order; with nobody able to wear
    // it the click walks on.
    const lists = Promise.all(candidates.map((ref) => request(ref, group)));
    afterClickAnswer(pending, deps.answered, candidates, queued, lists, (answers, current) => {
      const wearers = candidates.filter(
        (ref, index) => current(ref) && answers[index]?.some((row) => row.goodType === goodType),
      );
      const commands = selectionEquipCommands(
        deps.snapshot(),
        wearers,
        { goodType, group },
        { skipReturn: true, queued },
      );
      if (enqueueUnitSelection(commands, deps.enqueue, onOrderLimit)) deps.flashTarget?.(pile, 'order');
      if (commands.length === 0)
        onNoneWears(commanded.filter(({ ref }) => !candidates.includes(ref) || current(ref)));
    });
    return true;
  };

  const withoutDrivenCommanders = (
    movers: readonly FormationUnit[],
    vehicles: ReadonlySet<number>,
  ): readonly FormationUnit[] => {
    if (vehicles.size === 0) return movers;
    const snapshot = deps.snapshot();
    return movers.filter(({ ref }) => {
      const self = entityById(snapshot, ref);
      const vehicle = self === undefined ? undefined : commandedVehicleOf(snapshot, self);
      return vehicle === undefined || !vehicles.has(vehicle);
    });
  };

  /** The selected settlers an order goes to: all of them, or only `units` among them. */
  const commandedAmong = (units?: readonly number[]): FormationUnit[] => {
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
    if (units === undefined) return commanded;
    const eligible = new Set(units);
    return commanded.filter((unit) => eligible.has(unit.ref));
  };

  const strike = (commanded: readonly FormationUnit[], enemy: number, queued = false): boolean => {
    const accepted = enqueueArmyOrder(
      {
        kind: 'attackUnitGroup',
        members: commanded.map((unit) => ({ entity: unit.ref as Entity })),
        target: enemy as Entity,
        ...(queued ? { queued } : {}),
      },
      deps.enqueue,
      onOrderLimit,
    );
    if (accepted) deps.flashTarget?.(enemy, 'attack');
    return accepted;
  };

  const issueAttackTarget = (
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
    queued = false,
  ): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const accepts =
      typeof kind === 'string'
        ? (candidate: UnitTargetKind) => candidate === kind
        : (candidate: UnitTargetKind) => kind.includes(candidate);
    const enemy = pickTopAt(
      deps.targets
        .enemies({ neutralWalls: true })
        .filter((p) =>
          p.kind === 'settler' || p.kind === 'building' || p.kind === 'palisade' || p.kind === 'vehicle'
            ? accepts(p.kind)
            : false,
        ),
      world.x,
      world.y,
    );
    return enemy !== null && strike(commandedAmong(units), enemy, queued);
  };

  const issueAttackAnimal = (event: MouseEvent, units?: readonly number[], queued = false): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const prey = pickTopAt(deps.targets.wildlife(), world.x, world.y);
    return prey !== null && strike(commandedAmong(units), prey, queued);
  };

  const issueMoveTo = (
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles: readonly number[] = [],
  ): boolean => issueWalkOrder(target, commandedAmong(units), 'moveUnit', queued, new Set(vehicles));

  const issueAttackMove = (
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles: readonly number[] = [],
  ): boolean => issueWalkOrder(target, commandedAmong(units), 'attackMoveUnit', queued, new Set(vehicles));

  const setWorkFlags = (
    movers: readonly FormationUnit[],
    target: Tile,
    goodType?: number,
    unassignFirst = false,
  ): boolean => {
    if (movers.length === 0) return false;
    const { width, height } = nodeBounds(deps.mapSize);
    const flag = clampTile(target, width, height);
    const commands: UnitSelectionCommand[] = [];
    for (const mover of movers) {
      const entity = entityById(deps.snapshot(), mover.ref);
      if (unassignFirst && entity !== undefined && workplaceOf(entity) !== undefined) {
        commands.push({ kind: 'unassignWorker', entity: mover.ref as Entity });
      }
      commands.push({
        kind: 'setWorkFlag',
        entity: mover.ref as Entity,
        x: flag.col,
        y: flag.row,
      });
      if (goodType === undefined) continue;
      // This is player intent; the sim is the authority on whether each selected settler may gather the
      // clicked good. Keeping the app out of that gate also avoids dropping the filter against a stale
      // render/snapshot pair while still letting setWorkFlag reject non-gatherers normally.
      commands.push({ kind: 'setGatherGood', entity: mover.ref as Entity, goodType });
    }
    return enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
  };

  const issueSetWorkFlag = (target: Tile, units?: readonly number[], unassignFirst = false): boolean =>
    setWorkFlags(commandedAmong(units), target, undefined, unassignFirst);

  const issueSetWorkFlagAt = (event: MouseEvent): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const resources = deps.targets.resources();
    const resource = pickNearestAt(resources, world.x, world.y);
    const goodType =
      resource === null ? undefined : resources.find((target) => target.ref === resource)?.goodType;
    return setWorkFlags(commandedAmong(), worldToTile(world.x, world.y, deps.elevation), goodType);
  };

  return {
    refresh: () => school?.refresh(),
    setUiScale: async (scale) => {
      uiScale = scale;
      await school?.setUiScale(scale);
    },
    dispose: () => {
      disposed = true;
      if (deps.pendingGroundOrders === undefined) pending.dispose();
      school?.dispose();
    },
    issueRightClick,
    issueRiderTradeHouse,
    issueSetWorkFlagAt,
    issueSetWorkFlag,
    issueMoveTo,
    issueAttackMove,
    issueAttackTarget,
    issueAttackAnimal,
    openSchool,
  };
}
