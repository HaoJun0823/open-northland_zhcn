import type { ContentSet } from '@open-northland/data';
import { Owner, ownerOf, Position, Settler, Sheltering } from '../../../components/index.js';
import { indexAboveId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { ShelterSites } from '../../defence/index.js';
import { beatKeyOf, IDLE_REPLAN_PERIOD_TICKS, idleBeatOf } from './idle-replan.js';
import {
  type IdleRelease,
  idleRelease,
  RELEASE_IDLE_MEMBERSHIP,
  RELEASE_IDLE_VALUES,
  releaseStaleIntent,
  shelterHasRoom,
  takesCoverFrom,
} from './replan.js';

const byId = (e: Entity): number => e;

/**
 * The positioned settlers split by what their planner visit may do, each list in ascending id:
 * `acting` holds every one {@link idleRelease} does not pass by, wildlife included since the release
 * is the only failed-route recovery a parked creature has; `travellingByOwner` holds the quiet walkers
 * only an alarm can divert, by owner; `idle` holds the idlers whose visit does something only on their
 * re-plan beat, alarm or cut-off check, also split by the beat of {@link beatKeyOf} and by owner. The
 * owner split lets an alarm scan only its owner's settlers. Kept across ticks per world from a change feed.
 */
class SweepCandidates {
  private readonly acting: Entity[] = [];
  private readonly travellingByOwner = new Map<number, Entity[]>();
  private readonly idle: Entity[] = [];
  private readonly idleByOwner = new Map<number, Entity[]>();
  private readonly idleByBeat: Entity[][] = Array.from({ length: IDLE_REPLAN_PERIOD_TICKS }, () => []);
  /** How each positioned settler is filed, so a change that leaves its release, beat and owner as they
   *  were edits no list, and a re-owned or re-beaten one leaves its old lists. */
  private readonly filed = new Map<Entity, Filing>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);
  /** List edits so far: a remembered index stays a valid start for a later cursor while this holds
   *  still, so a pass walks forward instead of searching. */
  private edits = 0;
  private readonly actingAt = new ForwardIndex();
  private readonly idleAt = new ForwardIndex();

  constructor(private readonly world: World) {
    this.feed = world.watchChanges(
      [Settler, Position, Owner, ...RELEASE_IDLE_MEMBERSHIP],
      RELEASE_IDLE_VALUES,
    );
    this.rebuild();
  }

  /**
   * The first settler above `cursor` to visit, caught up first, so one another's plan woke earlier in
   * this pass is still reached in id order. An idler counts on `beat`, or on every beat when that is
   * undefined. With `shelters` on alarm a quiet walker or an idler of an alarmed owner counts too when
   * {@link takesCoverFrom} holds and it has no shelter yet, a walker only while its owner has a place
   * left; each is looked at about once per pass, since a scan stops at the next settler already chosen.
   */
  after(
    cursor: number,
    content: ContentSet,
    shelters: ShelterSites,
    beat: number | undefined,
  ): Entity | undefined {
    this.catchUp();
    const idlers = beat === undefined ? this.idle : this.idlersOn(beat);
    let next = earlier(
      this.acting[this.actingAt.above(this.acting, cursor, this.edits)],
      idlers[this.idleAt.above(idlers, cursor, this.edits)],
    );
    if (shelters.size === 0) return next;
    for (const owner of shelters.keys()) {
      // A walker's visit only claims a place, so it waits while its owner has none left.
      if (shelterHasRoom(shelters, owner)) {
        next = this.firstTakingCover(this.travellingByOwner.get(owner), cursor, next, content, shelters);
      }
      if (beat !== undefined) {
        next = this.firstTakingCover(this.idleByOwner.get(owner), cursor, next, content, shelters);
      }
    }
    return next;
  }

  /** The first of `ids` above `cursor` and below `bound` whose owner's cover may draw it and that holds
   *  no shelter yet, else `bound`. */
  private firstTakingCover(
    ids: readonly Entity[] | undefined,
    cursor: number,
    bound: Entity | undefined,
    content: ContentSet,
    shelters: ShelterSites,
  ): Entity | undefined {
    if (ids === undefined) return bound;
    for (let i = indexAboveId(ids, cursor, byId); i < ids.length; i++) {
      const e = ids[i];
      if (e === undefined || (bound !== undefined && e > bound)) break;
      if (this.world.has(e, Sheltering)) continue;
      if (takesCoverFrom(this.world, content, e, shelters)) return e;
    }
    return bound;
  }

  private catchUp(): void {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
  }

  private refresh(e: Entity): void {
    const positioned = this.world.has(e, Settler) && this.world.has(e, Position);
    const release = positioned ? idleRelease(this.world, e) : undefined;
    const beat = release === 'idle' ? idleBeatOf(beatKeyOf(this.world, e)) : undefined;
    const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
    const filing = this.filed.get(e);
    const priorRelease = filing?.release;
    const priorBeat = filing?.beat;
    const priorOwner = filing?.owner;
    if (release === priorRelease && beat === priorBeat && owner === priorOwner) return;
    if (release !== priorRelease) {
      if (release === null || priorRelease === null) this.editMember(this.acting, e, release === null);
      if (release === 'idle' || priorRelease === 'idle') this.editMember(this.idle, e, release === 'idle');
    }
    if (beat !== priorBeat) {
      if (priorBeat !== undefined) this.editMember(this.idlersOn(priorBeat), e, false);
      if (beat !== undefined) this.editMember(this.idlersOn(beat), e, true);
    }
    if (owner !== priorOwner || release !== priorRelease) {
      if (priorOwner !== undefined) this.editMember(this.ownerListOf(priorRelease, priorOwner), e, false);
      if (owner !== undefined) this.editMember(this.ownerListOf(release, owner), e, true);
    }
    if (release === undefined) this.filed.delete(e);
    else if (filing === undefined) this.filed.set(e, { release, beat, owner });
    else {
      filing.release = release;
      filing.beat = beat;
      filing.owner = owner;
    }
  }

  /** Insert `e`, which the filing says `ids` lacks, or remove it, which the filing says `ids` holds. */
  private editMember(ids: Entity[], e: Entity, present: boolean): void {
    if (present) insertSortedById(ids, e, byId);
    else removeSortedById(ids, e, byId);
    this.edits++;
  }

  /** The owner list a walker or idler of `owner` is filed in. */
  private ownerListOf(release: IdleRelease | null | undefined, owner: number): Entity[] {
    return ownerList(release === 'travelling' ? this.travellingByOwner : this.idleByOwner, owner);
  }

  private rebuild(): void {
    this.edits++;
    this.acting.length = 0;
    this.idle.length = 0;
    this.travellingByOwner.clear();
    this.idleByOwner.clear();
    this.filed.clear();
    for (const beat of this.idleByBeat) beat.length = 0;
    for (const e of this.world.canonicalQuery(Settler, Position)) {
      const release = idleRelease(this.world, e);
      let beat: number | undefined;
      if (release === null) this.acting.push(e);
      else if (release === 'idle') {
        beat = idleBeatOf(beatKeyOf(this.world, e));
        this.idle.push(e);
        this.idlersOn(beat).push(e);
      }
      const owner = release === 'travelling' || release === 'idle' ? ownerOf(this.world, e) : undefined;
      this.filed.set(e, { release, beat, owner });
      if (owner !== undefined) this.ownerListOf(release, owner).push(e);
    }
  }

  private idlersOn(beat: number): Entity[] {
    const idlers = this.idleByBeat[beat];
    if (idlers === undefined) throw new Error(`plannerSweep: no idle beat ${beat}`);
    return idlers;
  }

  verify(): string[] {
    this.catchUp();
    const all = this.world.canonicalQuery(Settler, Position);
    const acting = all.filter((e) => idleRelease(this.world, e) === null);
    const idle = all.filter((e) => idleRelease(this.world, e) === 'idle');
    const problems: string[] = [];
    if (
      this.filed.size !== all.length ||
      all.some((e) => this.filed.get(e)?.release !== idleRelease(this.world, e))
    )
      problems.push('plannerSweep filed releases diverge from a fresh scan');
    if (!sameIds(acting, this.acting))
      problems.push('plannerSweep acting settlers diverge from a fresh scan');
    if (!sameIds(idle, this.idle)) problems.push('plannerSweep idlers diverge from a fresh scan');
    this.idleByBeat.forEach((ids, beat) => {
      const fresh = idle.filter((e) => idleBeatOf(beatKeyOf(this.world, e)) === beat);
      if (!sameIds(fresh, ids))
        problems.push(`plannerSweep idlers on beat ${beat} diverge from a fresh scan`);
    });
    const byOwner = (release: IdleRelease): Map<number, Entity[]> => {
      const lists = new Map<number, Entity[]>();
      for (const e of all) {
        const owner = ownerOf(this.world, e);
        if (owner !== undefined && idleRelease(this.world, e) === release) ownerList(lists, owner).push(e);
      }
      return lists;
    };
    if (!sameOwnerLists(byOwner('travelling'), this.travellingByOwner)) {
      problems.push('plannerSweep quiet walkers by owner diverge from a fresh scan');
    }
    if (!sameOwnerLists(byOwner('idle'), this.idleByOwner)) {
      problems.push('plannerSweep idlers by owner diverge from a fresh scan');
    }
    return problems;
  }
}

function ownerList(lists: Map<number, Entity[]>, owner: number): Entity[] {
  let ids = lists.get(owner);
  if (ids === undefined) {
    ids = [];
    lists.set(owner, ids);
  }
  return ids;
}

/** Whether `held` files the same settlers per owner as `fresh`; an emptied list counts as absent. */
function sameOwnerLists(fresh: Map<number, Entity[]>, held: Map<number, Entity[]>): boolean {
  const owners = new Set([...fresh.keys(), ...held.keys()]);
  return [...owners].every((owner) => sameIds(fresh.get(owner) ?? [], held.get(owner) ?? []));
}

function earlier(a: Entity | undefined, b: Entity | undefined): Entity | undefined {
  if (a === undefined) return b;
  return b === undefined || a < b ? a : b;
}

/** Where {@link SweepCandidates} files one positioned settler: its release, and its idle beat and
 *  owner where its release files it by them. */
interface Filing {
  release: IdleRelease | null;
  beat: number | undefined;
  owner: number | undefined;
}

/** An index into one ascending-id list remembered between asks: while the list holds still and the
 *  cursor does not fall below the remembered answer, the next answer is a forward walk from it. */
class ForwardIndex {
  private list: readonly Entity[] | undefined;
  private at = 0;
  private edits = -1;

  /** The index of the first id in `list` above `cursor`; `edits` is the owner's count of list edits. */
  above(list: readonly Entity[], cursor: number, edits: number): number {
    let at = this.at;
    const previous = list[at - 1];
    if (this.list !== list || this.edits !== edits || (previous !== undefined && previous > cursor)) {
      at = indexAboveId(list, cursor, byId);
    } else {
      while ((list[at] ?? Number.POSITIVE_INFINITY) <= cursor) at++;
    }
    this.list = list;
    this.at = at;
    this.edits = edits;
    return at;
  }
}

function sameIds(a: readonly Entity[], b: readonly Entity[]): boolean {
  return a.length === b.length && a.every((e, i) => b[i] === e);
}

const candidates = new WeakMap<World, SweepCandidates>();

/**
 * The settlers the planner sweep visits this pass, in ascending id, read live between visits: the
 * ones whose {@link releaseStaleIntent} may change something, and the idlers due on `idleBeat`, or all
 * of them when that is undefined. The pass's claim maps hand out targets first come, first served, so
 * this order decides who wins. Only settlers positioned when the sweep starts take part; a settler
 * never loses either component while alive, so one created mid-pass is the only newcomer.
 */
export function sweepOrder(
  world: World,
  content: ContentSet,
  shelters: ShelterSites,
  idleBeat: number | undefined,
): PlannerSweep {
  let held = candidates.get(world);
  if (held === undefined) {
    const created = new SweepCandidates(world);
    world.registerCacheVerifier('plannerSweep', () => created.verify());
    candidates.set(world, created);
    held = created;
  }
  return new PlannerSweep(held, content, shelters, idleBeat, world.nextEntityId);
}

/** A cursor over {@link sweepOrder}'s settlers: a pass asks for the next one after each visit, so the
 *  walk allocates nothing per settler. */
export class PlannerSweep {
  private cursor = 0;
  private done = false;

  constructor(
    private readonly held: SweepCandidates,
    private readonly content: ContentSet,
    private readonly shelters: ShelterSites,
    private readonly idleBeat: number | undefined,
    private readonly createdMidPass: number,
  ) {}

  /** The next settler to visit, or undefined once the sweep is over. */
  next(): Entity | undefined {
    if (this.done) return undefined;
    const e = this.held.after(this.cursor, this.content, this.shelters, this.idleBeat);
    if (e === undefined || e >= this.createdMidPass) {
      this.done = true;
      return undefined;
    }
    this.cursor = e;
    return e;
  }
}
