import { formatMessage, messages } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import type { RelayPing } from './ping.js';
import { fastestRegion, RELAY_REGIONS, type RelayRegion, type RelayRegionId } from './regions.js';

/** Upper bounds of the green and amber reading. Approximation: chosen for the display, not measured
 *  against how a relayed game plays. */
const GOOD_PING_MS = 90;
const FAIR_PING_MS = 180;
const REMEASURE_MS = 15_000;

type PingQuality = 'good' | 'fair' | 'poor' | 'unknown';

function pingQuality(ms: number | null | undefined): PingQuality {
  if (ms === undefined || ms === null) return 'unknown';
  if (ms < GOOD_PING_MS) return 'good';
  return ms < FAIR_PING_MS ? 'fair' : 'poor';
}

/**
 * The official regions as one radio group, each with its last measured ping. `onMeasured` hears
 * the first round in which every region answered or failed.
 */
export function regionPicker(
  ping: RelayPing,
  onPick: (region: RelayRegion) => void,
  onMeasured: (fastest: RelayRegion | undefined) => void,
) {
  const copy = messages().network;
  const element = node('div', 'network-server');
  element.setAttribute('role', 'radiogroup');
  element.setAttribute('aria-label', copy.serverRegion);
  const pings = new Map<RelayRegionId, number | null>();
  let selected: RelayRegionId | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstRound = true;
  let paused = false;

  const cards = RELAY_REGIONS.map((region) => {
    const card = node('button', 'network-server__region');
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.dataset.region = region.id;
    const name = node('span', 'network-server__name', copy.regions[region.id]);
    const latency = node('span', 'network-server__ping');
    const bars = node('span', 'network-server__bars');
    bars.setAttribute('aria-hidden', 'true');
    bars.append(node('i'), node('i'), node('i'));
    const reading = node('span', 'network-server__reading');
    reading.append(bars, latency);
    card.append(name, reading);
    card.addEventListener('click', () => {
      select(region.id);
      onPick(region);
    });
    return { region, card, latency };
  });
  element.append(...cards.map(({ card }) => card));

  function paint(): void {
    for (const { region, card, latency } of cards) {
      const ms = pings.get(region.id);
      card.classList.toggle('is-selected', region.id === selected);
      card.setAttribute('aria-checked', String(region.id === selected));
      card.dataset.quality = pingQuality(ms);
      latency.textContent =
        ms === undefined
          ? copy.pingMeasuring
          : ms === null
            ? copy.pingUnavailable
            : formatMessage(copy.pingMs, { ms });
    }
  }

  function select(id: RelayRegionId | undefined): void {
    selected = id;
    paint();
  }

  async function measure(): Promise<void> {
    await Promise.all(
      RELAY_REGIONS.map(async (region) => {
        const ms = await ping(region.url);
        if (disposed) return;
        pings.set(region.id, ms);
        paint();
      }),
    );
    if (disposed) return;
    if (firstRound) {
      firstRound = false;
      onMeasured(fastestRegion(pings));
    }
    timer = setTimeout(remeasure, REMEASURE_MS);
  }
  /** A connected screen hides the picker; its pings wait for the player to come back to it. */
  function remeasure(): void {
    if (paused) timer = setTimeout(remeasure, REMEASURE_MS);
    else void measure();
  }

  paint();
  void measure();
  return {
    element,
    select,
    fastest: (): RelayRegion | undefined => fastestRegion(pings),
    setDisabled(disabled: boolean): void {
      paused = disabled;
      for (const { card } of cards) card.disabled = disabled;
    },
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
