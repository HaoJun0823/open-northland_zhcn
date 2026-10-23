import {
  type AnimalType,
  ATTACK_FRONTS,
  type AttackAlertVoice,
  type SoundBank,
  type SoundStaticGroup,
  type TribeType,
} from '@open-northland/data';
import { z } from 'zod';
import { errorMessage } from '../../errors.js';
import {
  collectSourceFiles,
  DATA_ATTACK_ALERTS_DIR,
  readSourceFile,
  resolveSourceFile,
  type SourceRoots,
} from '../../roots.js';

/** The pools' manifest inside the pack's optional attack alert namespace (docs/DATA-PACK.md). */
export const ATTACK_ALERTS_FILE = `${DATA_ATTACK_ALERTS_DIR}/alerts.json`;
const ATTACK_ALERTS_VERSION = 1;
const MAX_VOLUME = 100;
const WAV_SUFFIX = '.wav';

/**
 * Appends the pack's attack alert pools to `bank`: each group as a static group whose wavs are served
 * under `sounds/attack-alerts/`, and each tribe's two fronts as `attackAlerts` rows. An authored
 * addition; the original sounds no attack alert. A pack without the namespace adds nothing.
 */
export async function addAttackAlerts(
  roots: SourceRoots,
  bank: SoundBank,
  tribes: readonly TribeType[],
  animals: readonly Pick<AnimalType, 'tribeType'>[],
): Promise<SoundBank> {
  const path = await resolveSourceFile(roots, ATTACK_ALERTS_FILE);
  if (path === undefined) return bank;
  const text = new TextDecoder().decode(await readSourceFile(roots, path));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${ATTACK_ALERTS_FILE}: invalid JSON: ${errorMessage(err)}`);
  }
  const wavs = await collectSourceFiles(
    roots,
    (rel) => rel.startsWith(`${DATA_ATTACK_ALERTS_DIR}/`) && rel.endsWith(WAV_SUFFIX),
  );
  const pools = parseAttackAlerts(json, {
    bankGroups: new Set(bank.staticGroups.map((group) => group.name)),
    wavs: new Set(wavs.map(({ rel }) => rel.slice(DATA_ATTACK_ALERTS_DIR.length + 1))),
    settlerTribes: settlerTribeIds(tribes, animals),
  });
  return {
    ...bank,
    staticGroups: [...bank.staticGroups, ...pools.groups],
    attackAlerts: [...bank.attackAlerts, ...pools.voices],
  };
}

/** Tribe type ids by their `tribetypes.ini` slug, without the wildlife tribes. */
function settlerTribeIds(
  tribes: readonly TribeType[],
  animals: readonly Pick<AnimalType, 'tribeType'>[],
): ReadonlyMap<string, number> {
  const wildlife = new Set(animals.map((animal) => animal.tribeType));
  return new Map(
    tribes.filter((tribe) => !wildlife.has(tribe.typeId)).map((tribe) => [tribe.id, tribe.typeId]),
  );
}

interface AttackAlertContext {
  readonly bankGroups: ReadonlySet<string>;
  /** Wav paths relative to the namespace, spelled as on disk. */
  readonly wavs: ReadonlySet<string>;
  readonly settlerTribes: ReadonlyMap<string, number>;
}

interface AttackAlertPools {
  readonly groups: readonly SoundStaticGroup[];
  readonly voices: readonly AttackAlertVoice[];
}

const nonEmpty = z.string().min(1);

/** The pack's `alerts.json` layout; checks that need the bank, the namespace or the tribes follow. */
const AttackAlertsDocument = z.strictObject({
  version: z.literal(ATTACK_ALERTS_VERSION),
  groups: z.array(
    z.strictObject({
      name: nonEmpty,
      volume: z.number().int().min(0).max(MAX_VOLUME),
      files: z.array(nonEmpty).min(1),
    }),
  ),
  tribes: z.array(z.strictObject({ tribe: nonEmpty, base: nonEmpty, units: nonEmpty })),
});
type AttackAlertGroup = z.infer<typeof AttackAlertsDocument>['groups'][number];

function parseAttackAlerts(json: unknown, context: AttackAlertContext): AttackAlertPools {
  const fail = (why: string): never => {
    throw new Error(`${ATTACK_ALERTS_FILE}: ${why}`);
  };
  const parsed = AttackAlertsDocument.safeParse(json);
  if (!parsed.success) return fail(z.prettifyError(parsed.error));
  const doc = parsed.data;

  // The sound index keys groups lower-cased, so names differing only in case would overwrite each other.
  const bankGroups = new Set([...context.bankGroups].map((name) => name.toLowerCase()));
  const names = new Set<string>();
  for (const { name } of doc.groups) {
    const key = name.toLowerCase();
    if (names.has(key)) fail(`group "${name}" is listed twice`);
    if (bankGroups.has(key)) fail(`group "${name}" clashes with a sound bank group`);
    names.add(key);
  }
  const groups = doc.groups.map((group, i) => toStaticGroup(group, `groups[${i}]`, context.wavs, fail));

  const declared = new Set(doc.groups.map(({ name }) => name));
  const seenTribes = new Set<string>();
  const voices = doc.tribes.flatMap((row, i) => {
    const where = `tribes[${i}]`;
    const typeId =
      context.settlerTribes.get(row.tribe) ?? fail(`${where} names unknown settler tribe "${row.tribe}"`);
    if (seenTribes.has(row.tribe)) fail(`tribe "${row.tribe}" is listed twice`);
    seenTribes.add(row.tribe);
    return ATTACK_FRONTS.map((front) => {
      const group = row[front];
      if (!declared.has(group)) fail(`${where}.${front} names unknown group "${group}"`);
      return { tribe: typeId, front, group };
    });
  });
  return { groups, voices };
}

function toStaticGroup(
  { name, volume, files }: AttackAlertGroup,
  where: string,
  wavs: ReadonlySet<string>,
  fail: (why: string) => never,
): SoundStaticGroup {
  return {
    name,
    sfx: files.map((file, i) => {
      if (file !== file.toLowerCase() || !file.endsWith(WAV_SUFFIX)) {
        fail(`${where}.files[${i}] "${file}" must be a lower-case ${WAV_SUFFIX} path`);
      }
      if (!wavs.has(file)) fail(`${where}.files[${i}] "${file}" is not under ${DATA_ATTACK_ALERTS_DIR}/`);
      return { file: `${DATA_ATTACK_ALERTS_DIR}/${file}`, params: [volume] };
    }),
  };
}
