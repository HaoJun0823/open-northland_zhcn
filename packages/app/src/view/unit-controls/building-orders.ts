import { lastByTypeId } from '@open-northland/data';
import type { GroupMember, GroupWorker, UnitSelectionCommand } from '@open-northland/sim';
import { type Entity, entityById, systems } from '@open-northland/sim';
import {
  assignmentPriorityFor,
  canonicalJobType,
  trainsRatherThanEmploys,
} from '../../game/sandbox/index.js';
import {
  builderCrewSize,
  buildingTypeOf,
  buildSiteOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../game/snapshot.js';
import { pickTopAt, type Tile } from '../picking.js';
import type { FormationUnit } from './formation.js';
import { enqueueUnitSelection } from './group-orders.js';
import type { UnitOrderDeps } from './orders.js';

/** What the right-click ladder over an own building or site needs from the order controller. */
export interface BuildingOrderDeps
  extends Pick<UnitOrderDeps, 'snapshot' | 'content' | 'targets' | 'enqueue' | 'flashTarget'> {
  readonly onOrderLimit: () => void;
  /** A walk to `tile`, behind each unit's current order when `queued`. */
  readonly walkTo: (tile: Tile, units: readonly FormationUnit[], queued: boolean) => boolean;
  readonly openSchool: (house: number, units: readonly number[]) => boolean;
}

/** The right-click ladder's building rungs: an own building's crew, posts, homes and drills, and the
 *  builders a wall or road site takes. */
export function createBuildingOrders(deps: BuildingOrderDeps) {
  const { onOrderLimit, walkTo, openSchool } = deps;
  const buildingsByType = lastByTypeId(deps.content.buildings);

  /** An own wall segment or road site still to be built under the cursor. */
  const siteAt = (wx: number, wy: number): number | null => {
    const snapshot = deps.snapshot();
    const walls = deps.targets
      .owned('palisade')
      .filter((target) => entityById(snapshot, target.ref)?.components.UnderConstruction !== undefined);
    return pickTopAt([...walls, ...deps.targets.owned('roadsite')], wx, wy);
  };

  /** A wall or road site pins the builders among `commanded` to it; the rest walk there. */
  const orderAtSite = (
    commanded: readonly FormationUnit[],
    site: number,
    tile: Tile,
    queued: boolean,
  ): boolean => {
    const snapshot = deps.snapshot();
    const builders = commanded.filter((unit) => {
      const self = entityById(snapshot, unit.ref);
      const job = self !== undefined ? settlerJobType(self) : undefined;
      return job !== undefined && systems.jobCanBuild(deps.content, job);
    });
    assignBuilders(builders, site, queued);
    const walkers = commanded.filter((unit) => !builders.includes(unit));
    if (walkers.length > 0) walkTo(tile, walkers, queued);
    return true;
  };

  /** Pin `builders` to `site`, each behind its current order when `queued`, and flash the site. */
  const assignBuilders = (builders: readonly FormationUnit[], site: number, queued: boolean): boolean => {
    const commands = builders.map(
      (unit): UnitSelectionCommand => ({
        kind: 'assignBuilder',
        entity: unit.ref as Entity,
        site: site as Entity,
        ...(queued ? { queued } : {}),
      }),
    );
    const sent = enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    if (sent) deps.flashTarget?.(site, 'assign');
    return sent;
  };

  /**
   * The builders among `commanded` that join `building`'s crew: a foundation or damaged building takes
   * a builder before anything else, as in the original, while a standing building's repair crew has
   * room. A site's own worker takes a workplace post and carries materials while it is built, then keeps
   * the seat when it stands, so only a builder without a matching workplace slot joins the crew.
   */
  const crewAmong = (commanded: readonly FormationUnit[], building: number): FormationUnit[] => {
    const snapshot = deps.snapshot();
    const entity = entityById(snapshot, building);
    if (entity === undefined) return [];
    const underConstruction = entity.components.UnderConstruction !== undefined;
    if (!underConstruction && entity.components.Damaged === undefined) return [];
    const type = buildingTypeOf(entity);
    const slots = type === undefined ? undefined : buildingsByType.get(type)?.workers;
    const employsTrade = (jobType: number): boolean =>
      (slots ?? []).some((slot) => canonicalJobType(slot.jobType) === canonicalJobType(jobType));
    let crewRoom = underConstruction
      ? Number.POSITIVE_INFINITY
      : systems.REPAIR_CREW_LIMIT - builderCrewSize(snapshot, building);
    return commanded.filter((target) => {
      const self = entityById(snapshot, target.ref);
      const currentJob = self !== undefined ? settlerJobType(self) : undefined;
      if (
        currentJob === undefined ||
        !systems.jobCanBuild(deps.content, currentJob) ||
        employsTrade(currentJob)
      )
        return false;
      if (self !== undefined && buildSiteOf(self) === building) return true;
      if (crewRoom <= 0) return false;
      crewRoom--;
      return true;
    });
  };

  /** A hero takes no building: no home, post, drill or lesson. */
  const takesBuilding = (self: SnapshotEntity | undefined): boolean =>
    self === undefined || !systems.isHeroJob(deps.content, settlerJobType(self) ?? null);

  /** A Shift click on an own building: its crew and its barracks recruits line their order up behind
   *  their current one, and the rest walk there queued, a post or a home being a standing setting. */
  const queueAtBuilding = (commanded: readonly FormationUnit[], building: number, tile: Tile): boolean => {
    const snapshot = deps.snapshot();
    const entity = entityById(snapshot, building);
    const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
    const def = type !== undefined ? buildingsByType.get(type) : undefined;
    const crew = crewAmong(commanded, building);
    assignBuilders(crew, building, true);
    const recruits: FormationUnit[] = [];
    const walkers: FormationUnit[] = [];
    for (const target of commanded) {
      if (crew.includes(target)) continue;
      const self = entityById(snapshot, target.ref);
      const recruit =
        def !== undefined &&
        !systems.isSchoolType(def) &&
        self !== undefined &&
        takesBuilding(self) &&
        trainsRatherThanEmploys(def, settlerJobType(self));
      (recruit ? recruits : walkers).push(target);
    }
    const drills = recruits.map(
      (unit): UnitSelectionCommand => ({
        kind: 'trainSoldier',
        entity: unit.ref as Entity,
        house: building as Entity,
        queued: true,
      }),
    );
    if (enqueueUnitSelection(drills, deps.enqueue, onOrderLimit)) deps.flashTarget?.(building, 'assign');
    if (walkers.length > 0) walkTo(tile, walkers, true);
    return true;
  };

  /** The right-click ladder over an own building; true when it opened the school dialog or enqueued an
   *  order, so a building that takes none of the selection stays silent. */
  const orderAtBuilding = (
    event: MouseEvent,
    commanded: readonly FormationUnit[],
    building: number,
  ): boolean => {
    const snapshot = deps.snapshot();
    const entity = entityById(snapshot, building);
    const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
    const def = type !== undefined ? buildingsByType.get(type) : undefined;
    const slots = def?.workers;
    const crew = crewAmong(commanded, building);
    const pending = crew.map(
      (target): UnitSelectionCommand => ({
        kind: 'assignBuilder',
        entity: target.ref as Entity,
        site: building as Entity,
      }),
    );
    const rest = commanded.filter(
      (target) => !crew.includes(target) && takesBuilding(entityById(snapshot, target.ref)),
    );
    if (def !== undefined && systems.isSchoolType(def)) {
      const ordered = enqueueUnitSelection(pending, deps.enqueue, onOrderLimit);
      if (ordered) deps.flashTarget?.(building, 'assign');
      if (rest.length === 0) return ordered;
      const opened = openSchool(
        building,
        rest.map((t) => t.ref),
      );
      // The press's default would pull focus off the modal it just opened.
      if (opened) event.preventDefault();
      return opened || ordered;
    }
    // Homes and workplaces have limited room, so each goes out as one group order and the sim seats
    // the homeless and the unemployed first.
    const movers: GroupMember[] = [];
    const workers: GroupWorker[] = [];
    for (const target of rest) {
      const self = entityById(snapshot, target.ref);
      const currentJob = self !== undefined ? settlerJobType(self) : undefined;
      // A home may be reserved before it stands; its household drives wait for completed construction.
      if (def?.kind === 'home') {
        movers.push({ entity: target.ref as Entity });
        continue;
      }
      // A recruit sent to a foundation waits at its door until it stands.
      if (trainsRatherThanEmploys(def, currentJob)) {
        pending.push({ kind: 'trainSoldier', entity: target.ref as Entity, house: building as Entity });
        continue;
      }
      // The sim gates every candidate in the priority list, so an unoffered or full trade falls through.
      const jobPriority = assignmentPriorityFor(currentJob, slots);
      if (jobPriority.length > 0) workers.push({ entity: target.ref as Entity, jobPriority });
    }
    let ordered = enqueueUnitSelection(pending, deps.enqueue, onOrderLimit);
    if (movers.length > 0) {
      deps.enqueue({ kind: 'assignHouseGroup', members: movers, house: building as Entity });
      ordered = true;
    }
    if (workers.length > 0) {
      deps.enqueue({ kind: 'assignWorkerGroup', building: building as Entity, members: workers });
      ordered = true;
    }
    if (ordered) deps.flashTarget?.(building, 'assign');
    return ordered;
  };

  return { siteAt, orderAtSite, queueAtBuilding, orderAtBuilding };
}
