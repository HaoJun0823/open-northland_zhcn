import type { ContentSet } from '@open-northland/data';
import type { ElevationField, OrderMarkerKind, TargetFlashTone } from '@open-northland/render';
import {
  type Entity,
  entityById,
  hexDistanceBetween,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  ONE,
  type PlayerCommand,
  positionedWithin,
  positionOfNode,
  systems,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  commandedVehicleOf,
  isVehicle,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
} from '../../../game/snapshot/index.js';
import { pickableSeat, type ViewerSeat } from '../../../game/viewer-seat.js';
import { clampTile, nodeBounds, pickTopAt, type Tile, worldToTile } from '../../picking.js';
import type { UnitTargetKind, UnitTargets } from '../unit-targets.js';
import type { AnsweredOrders } from './answered.js';
import {
  type Berth,
  type BerthShip,
  berthReach,
  DOCK_PICK_SNAP_NODES,
  type Hull,
  type MooringRule,
  planBerths,
  RIGHT_CLICK_SNAP_NODES,
} from './berths.js';
import { formationTiles } from './formation.js';
import { enqueueArmyOrder, enqueueUnitSelection } from './group.js';
import { afterClickAnswer, type PendingGroundOrders } from './pending-ground.js';

/** How far apart a group's goals lie: past a catapult's footprint disc (`logicsize 1`) and a lane
 *  beside it, so no two marched vehicles contend for one goal. */
const VEHICLE_FORMATION_SPACING_NODES = 4;

export interface VehicleOrderDeps {
  readonly onOrderLimit?: (() => void) | undefined;
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField | undefined;
  /** Whose vehicles the orders command: the viewer seat's, or any when the viewer watches the whole map. */
  readonly viewer: ViewerSeat;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  /** The sim's attach rule, asked as the click lands; absent, every own vehicle under the cursor takes
   *  the attach click. */
  readonly askAttachToVehicle?: ((settler: number, vehicle: number) => Promise<boolean>) | undefined;
  /** A ship's mooring rule (`SessionHost.mooringProbe`), asked as the click lands; absent, the dock
   *  click moors where it lands and a ship's right-click is always a goto. */
  readonly askMooring?: ((vehicle: number) => Promise<MooringRule | null>) | undefined;
  /** The same rule's last answer, which the berth preview under the cursor reads; undefined while it is
   *  being answered. */
  readonly mooring?: ((vehicle: number) => MooringRule | null | undefined) | undefined;
  /** Where the orders a host answer decides wait for it. */
  readonly answered: AnsweredOrders;
  /** Puts a mooring answer's order in click order among the vehicle's other orders: a Shift click waits
   *  for the earlier clicks of the same ship, and a newer plain order calls an unanswered one off. Absent,
   *  the order applies as its answer lands. */
  readonly pendingGroundOrders?: PendingGroundOrders | undefined;
  /** Acknowledges a drive, mooring or bombardment on the ground where it was aimed; absent, nothing is
   *  drawn. */
  readonly markOrder?: ((node: Tile, kind: OrderMarkerKind) => void) | undefined;
  /** Flashes an order's target once; absent, nothing is drawn. */
  readonly flashTarget?: ((entity: number, tone: TargetFlashTone) => void) | undefined;
}

/**
 * The orders a selected vehicle takes from the world view: the right-click defaults and the resolutions
 * of the vehicle window's armed picks. Every order reports whether it commanded the vehicle, for the
 * caller's click feedback.
 */
export interface VehicleOrderController {
  /** The one owned vehicle the selection holds, itself or through its commander aboard it, when it
   *  holds nothing else that takes orders. */
  selectedVehicle(): number | null;
  /** The owned siege vehicles selected themselves, the ones an attack-move marches. */
  selectedSiegeVehicles(): number[];
  /** The owned vehicles selected themselves, the ones a right click drives. */
  selectedOwnVehicles(): number[];
  /**
   * The original's default right-click for a vehicle: an enemy human, vehicle or house is attacked, an
   * own moored ship is boarded by a land vehicle, anything else is driven to. Named approximations: the
   * attack defaults apply to an armed vehicle only, since the sim drops an unarmed one's attack order
   * silently, the original's per-vehicle gate not being read; a ship's right-click on a shore its
   * mooring rule accepts docks there, where the original's goto is refused.
   *
   * A marquee's group of vehicles, or vehicles selected beside settlers, is an addition: the armed ones
   * attack the enemy under the cursor, its ships dock along the shore there, each at its own berth
   * (`planBerths`), and the rest drive to their own slots of a spaced formation there. A group never
   * boards.
   *
   * Shift queues the attack, the load, the drive or the dock behind each vehicle's current order.
   */
  issueRightClick(event: MouseEvent): boolean;
  /** A `queued` order waits behind the vehicle's current one (`VehicleOrderQueue`). */
  issueMoveTo(vehicle: number, target: Tile, queued?: boolean): boolean;
  /** Drive the selection's vehicles to `target` as a right-click on open ground does: one vehicle drives
   *  there, or docks where a ship's mooring rule accepts the shore, and a group drives in formation. */
  issueDriveTo(target: Tile, queued?: boolean): boolean;
  /** March `vehicles` to `target`, each to its own slot of a spaced formation around it, fighting
   *  whatever they meet on the way. */
  issueAttackMove(vehicles: readonly number[], target: Tile, queued?: boolean): boolean;
  /** Moor `vehicle` at the shore its mooring rule accepts nearest `target`, within the dock pick's loose
   *  aim; a spot with no such shore near it orders nothing. */
  issueDock(vehicle: number, target: Tile, queued?: boolean): boolean;
  /** Where `ships` would moor for a dock order aimed at `target` within `snap` nodes, read off the
   *  mooring rules' last answers: the berths the cursor previews. Empty while a rule is being answered. */
  previewBerths(ships: readonly number[], target: Tile, snap: number): readonly Berth[];
  /** The selection's ships a right-click docks: the one selected ship, or a group's ships. */
  rightClickShips(): number[];
  issueAttackPosition(vehicle: number, target: Tile, queued?: boolean): boolean;
  /** Aim `vehicle` at the enemy of `kind` under the cursor; a click that hits none orders nothing. */
  issueAttackTarget(event: MouseEvent, vehicle: number, kind: UnitTargetKind, queued?: boolean): boolean;
  /** Load `vehicle` into the own ship under the cursor. */
  issueLoadInto(event: MouseEvent, vehicle: number, queued?: boolean): boolean;
  /** Attach `settler` to the own vehicle under the cursor (the ring's "Assign Vehicle") once the attach
   *  rule admits it; a vehicle it refuses orders nothing, the way a red building cancels a building
   *  pick. A `queued` attach waits behind the settler's current order. */
  issueAttach(event: MouseEvent, settler: number, queued?: boolean): boolean;
  /** The same attach from the vehicle's side: the own settler under the cursor takes a seat on
   *  `vehicle`, the commander's first. */
  issueSeatRider(event: MouseEvent, vehicle: number, queued?: boolean): boolean;
  /** Drive the own land vehicle under the cursor onto `ship`'s deck. */
  issueDeckLoad(event: MouseEvent, ship: number, queued?: boolean): boolean;
  /** The selected settlers' right-click on an own vehicle: each one the attach rule admits is assigned
   *  to it (approximation, owner's choice: the original assigns through the ring's pick only). False when
   *  no vehicle lies under the cursor, an own settler or an enemy drawn there takes the click first (a
   *  crew waiting by the door stands over the hull), or nobody is selected. `onNoneBoards` runs once the
   *  rule refused every selected settler, so the click can take its usual order instead. Shift queues
   *  each attach behind the settler's current order. */
  issueAttachSelected(event: MouseEvent, onNoneBoards: () => void): boolean;
}

export function createVehicleOrderController(deps: VehicleOrderDeps): VehicleOrderController {
  const ours = (e: SnapshotEntity): boolean => {
    const owner = ownerPlayerOf(e);
    const seat = pickableSeat(deps.viewer);
    return owner !== undefined && (seat === null || owner === seat);
  };

  const vehicleTypeOf = (e: SnapshotEntity): ContentSet['vehicles'][number] | undefined => {
    const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
    return typeId === undefined ? undefined : deps.content.vehicles.find((v) => v.typeId === typeId);
  };

  const selectedVehicle = (): number | null => {
    const snapshot = deps.snapshot();
    let found: number | null = null;
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e === undefined) continue;
      let vehicle = id;
      if (!isVehicle(e)) {
        if (e.components.Settler === undefined) continue; // a building or signpost takes no orders
        // A settler standing on the map takes the click itself (the sim hands a commander's walk order
        // to its vehicle); one aboard the vehicle it commands stands for that vehicle, so the click
        // drives it either way. Any other settler aboard is nobody's to order from here.
        const commanded = positionOf(e) === undefined ? commandedVehicleOf(snapshot, e) : undefined;
        if (commanded === undefined) return null;
        vehicle = commanded;
      }
      const self = entityById(snapshot, vehicle);
      if (self === undefined || !ours(self) || (found !== null && found !== vehicle)) return null;
      found = vehicle;
    }
    return found;
  };

  /** The owned vehicles selected themselves, in id order. */
  const selectedVehicles = (): SnapshotEntity[] => {
    const snapshot = deps.snapshot();
    const vehicles: SnapshotEntity[] = [];
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e !== undefined && isVehicle(e) && ours(e)) vehicles.push(e);
    }
    return vehicles.sort((a, b) => a.id - b.id);
  };

  const isSiege = (e: SnapshotEntity): boolean => {
    const type = vehicleTypeOf(e);
    return type !== undefined && systems.isSiegeVehicle(type);
  };

  const selectedOwnVehicles = (): number[] => selectedVehicles().map((e) => e.id);

  const selectedSiegeVehicles = (): number[] =>
    selectedVehicles()
      .filter(isSiege)
      .map((e) => e.id);

  const clampNode = (target: Tile): Tile => {
    const { width, height } = nodeBounds(deps.mapSize);
    return clampTile(target, width, height);
  };

  const isShip = (e: SnapshotEntity): boolean => {
    const type = vehicleTypeOf(e);
    return type !== undefined && systems.isShipVehicle(type);
  };

  /** `ships` as the berth planner reads them, each with its rule; a ship off the map, or one whose rule
   *  has no answer or takes no dock order, is left out. */
  const berthShips = (
    ships: readonly number[],
    rules: readonly (MooringRule | null | undefined)[],
  ): BerthShip[] => {
    const snapshot = deps.snapshot();
    const out: BerthShip[] = [];
    ships.forEach((vehicle, i) => {
      const rule = rules[i];
      const e = entityById(snapshot, vehicle);
      const position = e === undefined ? undefined : positionOf(e);
      const type = e === undefined ? undefined : vehicleTypeOf(e);
      const doorDistance = type?.passengerVector?.distance;
      if (rule === null || rule === undefined || position === undefined || type === undefined) return;
      if (doorDistance === undefined) return;
      const { hx, hy } = nodeOfPosition(position.x, position.y);
      out.push({ vehicle, at: { col: hx, row: hy }, logicSize: type.logicSize, doorDistance, rule });
    });
    return out;
  };

  /** The ships outside `fleet` within `radius` nodes of `around`, whose hulls a berth keeps clear of. */
  const hullsNear = (fleet: readonly BerthShip[], around: Tile, radius: number): Hull[] => {
    const low = positionOfNode(around.col - radius, around.row - radius);
    const high = positionOfNode(around.col + radius, around.row + radius);
    const box: TileBox = { minX: low.x / ONE, minY: low.y / ONE, maxX: high.x / ONE, maxY: high.y / ONE };
    const hulls: Hull[] = [];
    for (const e of positionedWithin(deps.snapshot(), box, [])) {
      if (!isVehicle(e) || !isShip(e) || fleet.some((ship) => ship.vehicle === e.id)) continue;
      const position = positionOf(e);
      const type = vehicleTypeOf(e);
      if (position === undefined || type === undefined) continue;
      const { hx, hy } = nodeOfPosition(position.x, position.y);
      if (hexDistanceBetween(around.col, around.row, hx, hy) <= radius)
        hulls.push({ at: { col: hx, row: hy }, logicSize: type.logicSize });
    }
    return hulls;
  };

  /** The hulls outside `fleet` in the water its berths around `at` may spread over. */
  const othersAround = (fleet: readonly BerthShip[], at: Tile, snap: number): Hull[] => {
    const door = Math.max(0, ...fleet.map((ship) => ship.doorDistance + ship.logicSize));
    return hullsNear(fleet, at, snap + berthReach(fleet) + door);
  };

  const planFor = (fleet: readonly BerthShip[], target: Tile, snap: number): Berth[] => {
    const at = clampNode(target);
    return planBerths(fleet, at, snap, othersAround(fleet, at, snap));
  };

  /** Ask every ship's mooring rule as the click lands, then plan their berths around `target`. */
  const afterBerths = (
    ask: NonNullable<VehicleOrderDeps['askMooring']>,
    ships: readonly number[],
    target: Tile,
    snap: number,
    queued: boolean,
    then: (berths: readonly Berth[], current: (actor: number) => boolean) => void,
  ): void =>
    afterAnswer(ships, queued, Promise.all(ships.map((ship) => ask(ship))), (rules, current) =>
      then(planFor(berthShips(ships, rules), target, snap), current),
    );

  let previewKey = '';
  let preview: readonly Berth[] = [];
  const previewBerths = (fleet: readonly number[], target: Tile, snap: number): readonly Berth[] => {
    const read = deps.mooring;
    if (read === undefined || fleet.length === 0) return [];
    const rules = fleet.map(read);
    // Planned once every rule has answered, for the ships whose rule takes a dock order, as the click is.
    if (rules.includes(undefined)) return [];
    const planned = berthShips(fleet, rules);
    const at = clampNode(target);
    const others = othersAround(planned, at, snap);
    const ships = planned.map((ship) => `${ship.vehicle}@${ship.at.col},${ship.at.row}/${ship.rule.key}`);
    const hulls = others.map((hull) => `${hull.at.col},${hull.at.row}`);
    const key = `${at.col},${at.row}:${snap}:${ships.join(';')}:${hulls.join(';')}`;
    if (key !== previewKey) {
      previewKey = key;
      preview = planBerths(planned, at, snap, others);
    }
    return preview;
  };

  const rightClickShips = (): number[] => {
    const vehicle = selectedVehicle();
    if (vehicle !== null) {
      const self = entityById(deps.snapshot(), vehicle);
      return self !== undefined && isShip(self) ? [vehicle] : [];
    }
    const group = selectedVehicles();
    return group.length > MAX_UNIT_ORDER_MEMBERS ? [] : group.filter(isShip).map((e) => e.id);
  };

  const issueMoveTo = (vehicle: number, target: Tile, queued = false): boolean => {
    const node = clampNode(target);
    deps.enqueue({
      kind: 'moveVehicle',
      vehicle: vehicle as Entity,
      x: node.col,
      y: node.row,
      ...(queued ? { queued } : {}),
    });
    deps.markOrder?.(node, 'move');
    return true;
  };

  const afterAnswer = <T>(
    actors: readonly number[],
    queued: boolean,
    answer: Promise<T>,
    then: (value: T, current: (actor: number) => boolean) => void,
  ): void => afterClickAnswer(deps.pendingGroundOrders, deps.answered, actors, queued, answer, then);

  /** One goal per vehicle around `target`, formation slots on a lattice as wide as the group, each
   *  scaled out to the spacing. */
  const formationGoals = (count: number, target: Tile): Tile[] => {
    const slots = formationTiles(
      { col: count, row: count },
      count,
      2 * count + 1,
      2 * count + 1,
      () => false,
    );
    return Array.from({ length: count }, (_, i) => {
      const slot = slots[i] ?? { col: count, row: count };
      return clampNode({
        col: target.col + (slot.col - count) * VEHICLE_FORMATION_SPACING_NODES,
        row: target.row + (slot.row - count) * VEHICLE_FORMATION_SPACING_NODES,
      });
    });
  };

  const driveInFormation = (
    vehicles: readonly number[],
    target: Tile,
    attackMove: boolean,
    queued: boolean,
  ): boolean => {
    if (vehicles.length === 0) return false;
    if (vehicles.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const goals = formationGoals(vehicles.length, target);
    const accepted = enqueueArmyOrder(
      {
        kind: 'moveVehicleGroup',
        members: vehicles.map((vehicle, i) => {
          const node = goals[i] ?? clampNode(target);
          return { entity: vehicle as Entity, x: node.col, y: node.row };
        }),
        ...(attackMove ? { attackMove: true } : {}),
        ...(queued ? { queued: true } : {}),
      },
      deps.enqueue,
      deps.onOrderLimit,
    );
    if (accepted) deps.markOrder?.(clampNode(target), attackMove ? 'attack' : 'move');
    return accepted;
  };

  const issueAttackMove = (vehicles: readonly number[], target: Tile, queued = false): boolean =>
    driveInFormation(vehicles, target, true, queued);

  /** `at`, a dock node of the point's ring, is where the hull lies; absent, the sim takes its ring's first. */
  const dock = (vehicle: number, node: Tile, queued: boolean, at?: Tile): void => {
    deps.enqueue({
      kind: 'dockVehicle',
      vehicle: vehicle as Entity,
      x: node.col,
      y: node.row,
      ...(at === undefined ? {} : { dock: { x: at.col, y: at.row } }),
      ...(queued ? { queued } : {}),
    });
    deps.markOrder?.(node, 'move');
  };

  const dockAt = (berths: readonly Berth[], current: (actor: number) => boolean, queued: boolean): void => {
    for (const berth of berths) if (current(berth.vehicle)) dock(berth.vehicle, berth, queued, berth.dock);
  };

  const issueDock = (vehicle: number, target: Tile, queued = false): boolean => {
    const ask = deps.askMooring;
    if (ask === undefined) dock(vehicle, clampNode(target), queued);
    else
      afterBerths(ask, [vehicle], target, DOCK_PICK_SNAP_NODES, queued, (berths, current) =>
        dockAt(berths, current, queued),
      );
    return true;
  };

  const issueAttackPosition = (vehicle: number, target: Tile, queued = false): boolean => {
    const node = clampNode(target);
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'ground', hx: node.col, hy: node.row },
      ...(queued ? { queued } : {}),
    });
    deps.markOrder?.(node, 'attack');
    return true;
  };

  const strike = (vehicle: number, enemy: number, queued: boolean): boolean => {
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'entity', entity: enemy as Entity },
      ...(queued ? { queued } : {}),
    });
    deps.flashTarget?.(enemy, 'attack');
    return true;
  };

  const issueAttackTarget = (
    event: MouseEvent,
    vehicle: number,
    kind: UnitTargetKind,
    queued = false,
  ): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemy = pickTopAt(
      deps.targets.enemies().filter((p) => p.kind === kind),
      world.x,
      world.y,
    );
    return enemy !== null && strike(vehicle, enemy, queued);
  };

  /** Whether `carrier` is one of our moored ships, the only thing a land vehicle may be loaded into. */
  const isMooredShip = (carrier: number): boolean => {
    const e = entityById(deps.snapshot(), carrier);
    if (e === undefined || !isVehicle(e) || !ours(e)) return false;
    const type = vehicleTypeOf(e);
    if (type === undefined || !systems.isShipVehicle(type)) return false;
    return (e.components.Vehicle as { moored?: unknown } | undefined)?.moored === true;
  };

  const loadInto = (vehicle: number, carrier: number, queued = false): boolean => {
    if (vehicle === carrier || !isMooredShip(carrier)) return false;
    deps.enqueue({
      kind: 'loadIntoVehicle',
      vehicle: vehicle as Entity,
      carrier: carrier as Entity,
      ...(queued ? { queued } : {}),
    });
    deps.flashTarget?.(carrier, 'order');
    return true;
  };

  const issueLoadInto = (event: MouseEvent, vehicle: number, queued = false): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const carrier = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    return carrier !== null && loadInto(vehicle, carrier, queued);
  };

  const issueAttach = (event: MouseEvent, settler: number, queued = false): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const vehicle = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    if (vehicle === null) return false;
    return attachWhenAdmitted([settler], vehicle, () => undefined, queued);
  };

  /** Attach each of `settlers` the rule admits, once it answered, in click order among their other
   *  pending clicks; `onNone` when it admitted nobody. */
  const attachWhenAdmitted = (
    settlers: readonly number[],
    vehicle: number,
    onNone: () => void,
    queued: boolean,
  ): boolean => {
    if (settlers.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const attach = (recipients: readonly number[]): boolean => {
      const sent = enqueueUnitSelection(
        recipients.map((entity) => ({
          kind: 'attachToVehicle',
          entity: entity as Entity,
          vehicle: vehicle as Entity,
          ...(queued ? { queued } : {}),
        })),
        deps.enqueue,
        deps.onOrderLimit,
      );
      if (sent) deps.flashTarget?.(vehicle, 'order');
      return sent;
    };
    const ask = deps.askAttachToVehicle;
    if (ask === undefined) {
      return attach(settlers);
    }
    afterAnswer(
      settlers,
      queued,
      Promise.all(settlers.map((settler) => ask(settler, vehicle))),
      (verdicts, current) => {
        // Only the rule's refusal hands the click on: a settler a newer order took is no one's to replay.
        const admitted = settlers.filter((_settler, index) => verdicts[index] === true);
        attach(admitted.filter(current));
        if (admitted.length === 0) onNone();
      },
    );
    return true;
  };

  const issueSeatRider = (event: MouseEvent, vehicle: number, queued = false): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const settler = pickTopAt(deps.targets.owned('settler'), world.x, world.y);
    if (settler === null) return false;
    return attachWhenAdmitted([settler], vehicle, () => undefined, queued);
  };

  const issueDeckLoad = (event: MouseEvent, ship: number, queued = false): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const vehicle = pickTopAt(
      deps.targets.owned('vehicle').filter((target) => target.ref !== ship),
      world.x,
      world.y,
    );
    return vehicle !== null && loadInto(vehicle, ship, queued);
  };

  const issueAttachSelected = (event: MouseEvent, onNoneBoards: () => void): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const vehicle = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
    if (vehicle === null) return false;
    if (pickTopAt(deps.targets.owned('settler'), world.x, world.y) !== null) return false;
    if (pickTopAt(deps.targets.enemies(), world.x, world.y) !== null) return false;
    const settlers = deps.targets.ownedSettlersIn(deps.selected()).map((target) => target.ref);
    if (settlers.length === 0) return false;
    return attachWhenAdmitted(settlers, vehicle, onNoneBoards, event.shiftKey);
  };

  /** A group's right-click (see {@link VehicleOrderController.issueRightClick}). An own settler under
   *  the cursor is left to the settlers' click, which selects it. */
  const issueGroupRightClick = (event: MouseEvent): boolean => {
    const group = selectedVehicles();
    if (group.length === 0) return false;
    if (group.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const world = deps.toWorld(event.clientX, event.clientY);
    if (pickTopAt(deps.targets.owned('settler'), world.x, world.y) !== null) return false;
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    const striking = enemy === null ? [] : group.filter(isSiege);
    if (
      enemy !== null &&
      striking.length > 0 &&
      enqueueArmyOrder(
        {
          kind: 'attackWithVehicleGroup',
          members: striking.map((e) => ({ entity: e.id as Entity })),
          target: { kind: 'entity', entity: enemy as Entity },
          ...(event.shiftKey ? { queued: true } : {}),
        },
        deps.enqueue,
        deps.onOrderLimit,
      )
    )
      deps.flashTarget?.(enemy, 'attack');
    const driving = group.filter((e) => !striking.includes(e));
    const target = worldToTile(world.x, world.y, deps.elevation);
    const ships = driving.filter(isShip).map((e) => e.id);
    const ask = deps.askMooring;
    if (ships.length === 0 || ask === undefined) {
      driveInFormation(
        driving.map((e) => e.id),
        target,
        false,
        event.shiftKey,
      );
      return true;
    }
    // The ships wait on their mooring rules; the rest of the group drives off at once.
    driveInFormation(
      driving.filter((e) => !isShip(e)).map((e) => e.id),
      target,
      false,
      event.shiftKey,
    );
    // A ship the shore there has no berth for sails with the rest.
    afterBerths(ask, ships, target, RIGHT_CLICK_SNAP_NODES, event.shiftKey, (berths, current) => {
      dockAt(berths, current, event.shiftKey);
      const sailing = ships.filter(
        (ship) => current(ship) && !berths.some((berth) => berth.vehicle === ship),
      );
      if (sailing.length > 0) driveInFormation(sailing, target, false, event.shiftKey);
    });
    return true;
  };

  const issueRightClick = (event: MouseEvent): boolean => {
    const vehicle = selectedVehicle();
    if (vehicle === null) return issueGroupRightClick(event);
    const self = entityById(deps.snapshot(), vehicle);
    const type = self === undefined ? undefined : vehicleTypeOf(self);
    const queued = event.shiftKey;
    const armed = type !== undefined && systems.isSiegeVehicle(type);
    const land = type !== undefined && !systems.isShipVehicle(type);
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemies = deps.targets.enemies();
    if (armed) {
      const human = pickTopAt(
        enemies.filter((p) => p.kind === 'settler'),
        world.x,
        world.y,
      );
      if (human !== null) return strike(vehicle, human, queued);
    }
    if (land) {
      const carrier = pickTopAt(deps.targets.owned('vehicle'), world.x, world.y);
      if (carrier !== null && loadInto(vehicle, carrier, queued)) return true;
    }
    if (armed) {
      const enemy = pickTopAt(enemies, world.x, world.y);
      if (enemy !== null) return strike(vehicle, enemy, queued);
    }
    return driveTo(vehicle, worldToTile(world.x, world.y, deps.elevation), queued);
  };

  /** Drive `vehicle` to `target`: a ship docks at the shore its mooring rule, asked as the click lands,
   *  accepts within a right-click's reach of the target, and sails there otherwise. */
  const driveTo = (vehicle: number, target: Tile, queued: boolean): boolean => {
    const self = entityById(deps.snapshot(), vehicle);
    const type = self === undefined ? undefined : vehicleTypeOf(self);
    const ask = deps.askMooring;
    if ((type !== undefined && !systems.isShipVehicle(type)) || ask === undefined) {
      return issueMoveTo(vehicle, target, queued);
    }
    afterBerths(ask, [vehicle], target, RIGHT_CLICK_SNAP_NODES, queued, (berths, current) => {
      if (!current(vehicle)) return;
      if (berths.length > 0) dockAt(berths, current, queued);
      else issueMoveTo(vehicle, target, queued);
    });
    return true;
  };

  const issueDriveTo = (target: Tile, queued = false): boolean => {
    const vehicle = selectedVehicle();
    if (vehicle !== null) return driveTo(vehicle, target, queued);
    return driveInFormation(selectedOwnVehicles(), target, false, queued);
  };

  return {
    selectedVehicle,
    selectedSiegeVehicles,
    selectedOwnVehicles,
    issueRightClick,
    issueMoveTo,
    issueDriveTo,
    issueAttackMove,
    issueDock,
    previewBerths,
    rightClickShips,
    issueAttackPosition,
    issueAttackTarget,
    issueLoadInto,
    issueAttach,
    issueSeatRider,
    issueDeckLoad,
    issueAttachSelected,
  };
}
