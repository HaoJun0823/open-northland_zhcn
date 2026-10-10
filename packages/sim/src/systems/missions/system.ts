import {
  createMissionState,
  MISSION_LOAD_CLOCK,
  type MissionRecord,
  missionClock,
  missionRecords,
  missionStateExists,
  missionsEnabled,
  writeMissionState,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { checkMission } from './check.js';
import type { MissionPass } from './pass.js';
import { settleLandscapePass } from './results/landscape.js';
import type { MissionScript } from './script.js';

/**
 * The script clock period between two evaluation passes, 3 seconds at 12 ticks per second. Original
 * behavior (byte-level): a pass runs when the game-time counter is a multiple of 36.
 */
export const MISSION_EVALUATION_TICKS = 36;

/**
 * Which (mission, opcode, kind) triples already reported, so a script reaching an opcode this build
 * cannot run says so once instead of every pass. Diagnostic only - the events it gates are
 * presentation - so it is world-keyed rather than saved state, and a restored run reports again.
 */
const reported = new WeakMap<World, Set<string>>();

/**
 * Runs the map's `[MissionData]` script: it loads the records on the first tick the script is enabled
 * and passes over them at once, then whenever the {@link missionClock} reaches a multiple of
 * {@link MISSION_EVALUATION_TICKS}. A pass visits the active missions in index order and fires the
 * results of each whose goals satisfy its `successfullif` rule. Inert without a script or with
 * `MissionRules` off, which is every world that does not opt in.
 *
 * The load pass is a deliberate deviation: the original's first pass comes 35 ticks after load, so its
 * opening briefing appears three seconds into the map. Here the map opens on it.
 */
export const missionSystem: System = (world, ctx) => {
  const script = ctx.missions;
  if (script === undefined || script.missions.length === 0 || !missionsEnabled(world)) return;
  const loadPass = !missionStateExists(world);
  if (loadPass) loadMissionState(world, script, ctx.tick);
  const clock = missionClock(world, ctx.tick);
  if (!loadPass && clock % MISSION_EVALUATION_TICKS !== 0) return;
  // A script with nothing active has no pass to run, and taking the write seam anyway would dirty the
  // world - and every cache derived from it - every three seconds for the rest of a finished map.
  if (!missionRecords(world).some((record) => record.active)) return;
  writeMissionState(world, (records) => {
    runPass(world, ctx, script, records, clock);
  });
};

function loadMissionState(world: World, script: MissionScript, tick: number): void {
  createMissionState(
    world,
    tick,
    script.missions.map(
      (definition): MissionRecord => ({
        active: definition.active,
        visible: definition.visible,
        activationClock: definition.active ? MISSION_LOAD_CLOCK : 0,
        goalsHeld: definition.goals.map(() => false),
        randomSeconds: definition.goals.map(() => 0),
        evaluated: false,
      }),
    ),
  );
}

/**
 * One pass in index order. A mission activated by an earlier mission's results is visited later in
 * this same pass, exactly as the original's single forward walk does, unless a result halted the
 * pass, after which the rest wait for the next one.
 */
function runPass(
  world: World,
  ctx: SystemContext,
  script: MissionScript,
  records: MissionRecord[],
  clock: number,
): void {
  const pass: MissionPass = {
    world,
    ctx,
    script,
    records,
    clock,
    report: (mission, opcode) => report(world, ctx, 'missionUnsupported', mission, opcode),
    reportFailed: (mission, opcode) => report(world, ctx, 'missionResultFailed', mission, opcode),
    checking: new Set(),
    halted: false,
  };
  for (let index = 0; index < records.length && !pass.halted; index++) {
    if (records[index]?.active === true) checkMission(pass, index, true);
  }
  settleLandscapePass(pass);
  if (pass.subMission !== undefined)
    ctx.events.emit({ kind: 'missionSubMission', transition: pass.subMission });
}

function report(
  world: World,
  ctx: SystemContext,
  kind: 'missionUnsupported' | 'missionResultFailed',
  mission: number,
  opcode: string,
): void {
  let seen = reported.get(world);
  if (seen === undefined) {
    seen = new Set<string>();
    reported.set(world, seen);
  }
  const key = `${kind}:${mission}:${opcode}`;
  if (seen.has(key)) return;
  seen.add(key);
  ctx.events.emit({ kind, mission, opcode });
}
