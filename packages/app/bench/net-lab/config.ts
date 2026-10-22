/**
 * The load lab's inputs: what `npm run bench:net-lab -- <flags>` asks for, parsed strictly so a typo
 * fails the run instead of measuring a different session than the caller named.
 */
import { components } from '@open-northland/sim';
import type { LinkOptions } from '../../../net-server/test/support/virtual-network.js';
import { DEFAULT_ORDER_WEIGHTS, ORDER_KINDS, type OrderKind } from './orders.js';

export type ComputerDifficulty = (typeof components.COMPUTER_DIFFICULTIES)[number];

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;

/** Named link profiles: round trip, peak-to-peak jitter of each one-way trip, and the client's upload
 *  and download rates in bytes per second. Approximations of the named connection kinds, not
 *  measurements of a real network. */
export const LINK_PROFILES = {
  lan: {
    latencyMs: 2,
    jitterMs: 1,
    uploadBytesPerSecond: 12 * MEBIBYTE,
    downloadBytesPerSecond: 12 * MEBIBYTE,
  },
  home: { latencyMs: 40, jitterMs: 10, uploadBytesPerSecond: MEBIBYTE, downloadBytesPerSecond: 6 * MEBIBYTE },
  far: {
    latencyMs: 180,
    jitterMs: 40,
    uploadBytesPerSecond: 512 * KIBIBYTE,
    downloadBytesPerSecond: 2 * MEBIBYTE,
  },
  bad: {
    latencyMs: 350,
    jitterMs: 150,
    uploadBytesPerSecond: 32 * KIBIBYTE,
    downloadBytesPerSecond: 128 * KIBIBYTE,
  },
} as const satisfies Record<string, Required<LinkOptions>>;
export type LinkProfileName = keyof typeof LINK_PROFILES;

export interface ClientLink extends Required<LinkOptions> {
  readonly profile: LinkProfileName;
}

/** One scripted disturbance, fired once the relay's clock reaches `atTick`. */
export type ChaosEvent =
  /** Blackhole both directions for `ms`, then reconnect over a fresh link as a client does once its
   *  socket goes quiet. */
  | { readonly kind: 'cut'; readonly atTick: number; readonly client: number; readonly ms: number }
  /** Close the socket (the relay learns at once), stay away `ms`, then reconnect. */
  | { readonly kind: 'relink'; readonly atTick: number; readonly client: number; readonly ms: number }
  /** Run nothing and read nothing for `ms`, as a frozen tab does, then take the held messages and the
   *  whole elapsed time in one frame. */
  | { readonly kind: 'freeze'; readonly atTick: number; readonly client: number; readonly ms: number }
  /** Close the socket and come back after `ms` as a reloaded page: a new client with the same identity
   *  and no world, which the relay brings back from the room's snapshot. */
  | { readonly kind: 'reload'; readonly atTick: number; readonly client: number; readonly ms: number };
export type ChaosKind = ChaosEvent['kind'];
const CHAOS_KINDS: readonly ChaosKind[] = ['cut', 'relink', 'freeze', 'reload'];
/** Kinds whose `ms` may be left out: the client comes back at once. */
const INSTANT_CHAOS_KINDS: readonly ChaosKind[] = ['relink', 'reload'];

export interface LabConfig {
  readonly mapId: string;
  /** A gzipped canonical save the room starts from instead of a fresh world; its map is the room's. */
  readonly save: string | null;
  readonly humans: number;
  /** Computer seats taken from the claimable seats left after the humans; null takes all of them. */
  readonly computers: number | null;
  readonly difficulty: ComputerDifficulty;
  /** Ticks every client must run: from tick 0, or from the save's tick. */
  readonly ticks: number;
  readonly speed: number;
  /** The session seed of a fresh room; a saved room keeps the save's. */
  readonly seed: number;
  /** One per human client. */
  readonly links: readonly ClientLink[];
  /** Orders each human client issues per minute of game time. */
  readonly ordersPerMinute: number;
  readonly orderWeights: Readonly<Record<OrderKind, number>>;
  readonly chaos: readonly ChaosEvent[];
  /** Time each sim system per tick, for the spike breakdown. */
  readonly systems: boolean;
  /** Virtual milliseconds between samples of the lag and buffer timeline. */
  readonly sampleMs: number;
  /** The JSON report's path; null prints the summary only. */
  readonly out: string | null;
}

export const DEFAULT_LAB_CONFIG: Omit<LabConfig, 'links'> = {
  mapId: 'magiczny_las',
  save: null,
  humans: 2,
  computers: null,
  difficulty: 'hard',
  ticks: 1200,
  speed: 1,
  seed: 7,
  ordersPerMinute: 20,
  orderWeights: DEFAULT_ORDER_WEIGHTS,
  chaos: [],
  systems: true,
  sampleMs: 1000,
  out: null,
};
const DEFAULT_PROFILE: LinkProfileName = 'home';

export const LAB_USAGE = `usage: npm run bench:net-lab -- [flags]
  --map <id>                decoded map (default ${DEFAULT_LAB_CONFIG.mapId})
  --save <file>             start from this gzipped save (build-save writes one); humans take over
                            the seats its computers held, and the map and seed are the save's
  --humans <n>              headless human clients (default ${DEFAULT_LAB_CONFIG.humans})
  --computers <n>           computer seats from the claimable seats left (default: all of them)
  --difficulty <level>      easy | medium | hard (default ${DEFAULT_LAB_CONFIG.difficulty})
  --ticks <n>               ticks every client must run, from the start or the save (default ${DEFAULT_LAB_CONFIG.ticks})
  --speed <x>               room speed (default ${DEFAULT_LAB_CONFIG.speed})
  --seed <n>                session seed; also seeds jitter and orders (default ${DEFAULT_LAB_CONFIG.seed})
  --links <p,p,...>         link profile per client, cycled (${Object.keys(LINK_PROFILES).join(', ')}; default ${DEFAULT_PROFILE})
  --link <i>=<p>[,latencyMs=n][,jitterMs=n][,up=n][,down=n]
                            one client's profile and overrides (bytes per second), repeatable
  --orders-per-minute <n>   orders per human client per game minute (default ${DEFAULT_LAB_CONFIG.ordersPerMinute})
  --mix <kind=w,...>        order weights over ${ORDER_KINDS.join(', ')}
  --chaos <kind@tick:client:ms,...>
                            ${CHAOS_KINDS.join(' | ')} at a tick counted from the room's start, for
                            client index (from 0)
  --systems on|off          time each sim system for the spike breakdown (default on)
  --sample-ms <n>           virtual ms between timeline samples (default ${DEFAULT_LAB_CONFIG.sampleMs})
  --out <path>              write the JSON report there`;

export function integerArg(flag: string, raw: string, min: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min)
    throw new Error(`${flag} must be an integer >= ${min}, got '${raw}'`);
  return value;
}

function positive(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${flag} must be a positive number, got '${raw}'`);
  return value;
}

function profileOf(raw: string): LinkProfileName {
  if (!Object.hasOwn(LINK_PROFILES, raw)) {
    throw new Error(
      `unknown link profile '${raw}', expected one of ${Object.keys(LINK_PROFILES).join(', ')}`,
    );
  }
  return raw as LinkProfileName;
}

function linkOf(profile: LinkProfileName): ClientLink {
  return { profile, ...LINK_PROFILES[profile] };
}

const LINK_OVERRIDES = {
  latencyMs: 'latencyMs',
  jitterMs: 'jitterMs',
  up: 'uploadBytesPerSecond',
  down: 'downloadBytesPerSecond',
} as const satisfies Record<string, keyof LinkOptions>;

/** `<i>=<profile>[,key=value...]`: client `i`'s link. */
function linkOverride(raw: string): { readonly client: number; readonly link: ClientLink } {
  const [index, spec] = raw.split('=', 2);
  if (index === undefined || spec === undefined)
    throw new Error(`--link must be <i>=<profile>[,...], got '${raw}'`);
  const [name, ...pairs] = raw.slice(index.length + 1).split(',');
  let link = linkOf(profileOf(name ?? ''));
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key === undefined || value === undefined || !Object.hasOwn(LINK_OVERRIDES, key)) {
      throw new Error(
        `--link override must be one of ${Object.keys(LINK_OVERRIDES).join(', ')}=<n>, got '${pair}'`,
      );
    }
    const field = LINK_OVERRIDES[key as keyof typeof LINK_OVERRIDES];
    link = { ...link, [field]: integerArg(`--link ${key}`, value, 0) };
  }
  return { client: integerArg('--link index', index, 0), link };
}

function orderWeights(raw: string): Record<OrderKind, number> {
  const weights = Object.fromEntries(ORDER_KINDS.map((kind) => [kind, 0])) as Record<OrderKind, number>;
  for (const pair of raw.split(',')) {
    const [kind, value] = pair.split('=');
    if (kind === undefined || value === undefined || !ORDER_KINDS.includes(kind as OrderKind)) {
      throw new Error(`--mix wants <kind>=<weight> over ${ORDER_KINDS.join(', ')}, got '${pair}'`);
    }
    weights[kind as OrderKind] = integerArg(`--mix ${kind}`, value, 0);
  }
  if (Object.values(weights).every((weight) => weight === 0))
    throw new Error('--mix gives every kind weight 0');
  return weights;
}

const CHAOS_PATTERN = /^([a-z]+)@(\d+):(\d+)(?::(\d+))?$/;

function chaosEvents(raw: string, humans: number): ChaosEvent[] {
  return raw.split(',').map((item) => {
    const match = CHAOS_PATTERN.exec(item.trim());
    const [, kind, atTick, client, ms] = match ?? [];
    if (match === null || kind === undefined || atTick === undefined || client === undefined) {
      throw new Error(`--chaos wants <kind>@<tick>:<client>[:<ms>], got '${item}'`);
    }
    if (!CHAOS_KINDS.includes(kind as ChaosKind)) {
      throw new Error(`--chaos kind '${kind}' is not one of ${CHAOS_KINDS.join(', ')}`);
    }
    const index = integerArg('--chaos client', client, 0);
    if (index >= humans) throw new Error(`--chaos names client ${index}, but only ${humans} run`);
    if (!INSTANT_CHAOS_KINDS.includes(kind as ChaosKind) && ms === undefined)
      throw new Error(`--chaos ${kind} needs a duration: '${item}'`);
    return {
      kind: kind as ChaosKind,
      atTick: integerArg('--chaos tick', atTick, 1),
      client: index,
      ms: ms === undefined ? 0 : integerArg('--chaos ms', ms, 0),
    };
  });
}

const DIFFICULTIES: readonly string[] = components.COMPUTER_DIFFICULTIES;

/** Parse `argv` (without the node and script entries). */
export function parseLabArgs(argv: readonly string[]): LabConfig {
  const values = new Map<string, string>();
  const linkOverrides: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || !flag.startsWith('--'))
      throw new Error(`expected a --flag, got '${flag}'\n${LAB_USAGE}`);
    if (value === undefined) throw new Error(`${flag} needs a value\n${LAB_USAGE}`);
    if (flag === '--link') linkOverrides.push(value);
    else values.set(flag, value);
  }
  const take = (flag: string): string | undefined => {
    const value = values.get(flag);
    values.delete(flag);
    return value;
  };
  const config: { -readonly [K in keyof typeof DEFAULT_LAB_CONFIG]: (typeof DEFAULT_LAB_CONFIG)[K] } = {
    ...DEFAULT_LAB_CONFIG,
  };
  const read = <K extends keyof typeof config>(
    flag: string,
    key: K,
    parse: (raw: string) => (typeof config)[K],
  ): void => {
    const raw = take(flag);
    if (raw !== undefined) config[key] = parse(raw);
  };
  if (values.has('--map') && values.has('--save'))
    throw new Error('--map and --save exclude each other: the save names its map');
  read('--map', 'mapId', (raw) => raw);
  read('--save', 'save', (raw) => raw);
  read('--humans', 'humans', (raw) => integerArg('--humans', raw, 1));
  read('--computers', 'computers', (raw) => integerArg('--computers', raw, 0));
  read('--difficulty', 'difficulty', (raw) => {
    if (!DIFFICULTIES.includes(raw))
      throw new Error(`--difficulty must be one of ${DIFFICULTIES.join(', ')}`);
    return raw as ComputerDifficulty;
  });
  read('--ticks', 'ticks', (raw) => integerArg('--ticks', raw, 1));
  read('--speed', 'speed', (raw) => positive('--speed', raw));
  read('--seed', 'seed', (raw) => integerArg('--seed', raw, 0));
  read('--orders-per-minute', 'ordersPerMinute', (raw) => positive('--orders-per-minute', raw));
  read('--mix', 'orderWeights', orderWeights);
  read('--systems', 'systems', (raw) => {
    if (raw !== 'on' && raw !== 'off') throw new Error(`--systems must be on or off, got '${raw}'`);
    return raw === 'on';
  });
  read('--sample-ms', 'sampleMs', (raw) => integerArg('--sample-ms', raw, 1));
  read('--out', 'out', (raw) => raw);
  const chaos = take('--chaos');
  const profiles = (take('--links') ?? DEFAULT_PROFILE).split(',').map(profileOf);
  if (values.size > 0) throw new Error(`unknown flag ${[...values.keys()].join(', ')}\n${LAB_USAGE}`);
  const links = Array.from({ length: config.humans }, (_, i) =>
    linkOf(profiles[i % profiles.length] ?? DEFAULT_PROFILE),
  );
  for (const raw of linkOverrides) {
    const { client, link } = linkOverride(raw);
    if (client >= config.humans)
      throw new Error(`--link names client ${client}, but only ${config.humans} run`);
    links[client] = link;
  }
  return { ...config, links, chaos: chaos === undefined ? [] : chaosEvents(chaos, config.humans) };
}

/** A config with every human on `profile`, for callers that build one in code. */
export function labConfig(overrides: Partial<LabConfig> & { readonly humans: number }): LabConfig {
  const links = overrides.links ?? Array.from({ length: overrides.humans }, () => linkOf(DEFAULT_PROFILE));
  return { ...DEFAULT_LAB_CONFIG, ...overrides, links };
}
