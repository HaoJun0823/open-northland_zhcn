import type { PerfReading, PerfVerdict } from '../../diag/perf-reading.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The frame rate on the top bar, with a breakdown that opens on hover, focus or a click like the bar's
 *  other counters: a verdict, a load meter each for the sim, the main thread and the GPU, and the
 *  recent frame times against the frame budget. */
export interface PerfReadoutView {
  readonly element: HTMLElement;
  /** `frameTimes` are the newest frame intervals in ms, oldest first; the view keeps the reference and
   *  redraws from it when the breakdown opens. */
  show(reading: PerfReading, frameTimes: ArrayLike<number>): void;
}

type Health = 'good' | 'warn' | 'bad';

/** A frame within this share over its budget still reads as keeping up: rAF jitters around the grid. */
const FRAME_GOOD_RATIO = 1.1;
const FRAME_WARN_RATIO = 1.5;
/** A meter this full turns amber, then red. */
const LOAD_WARN = 0.7;
const LOAD_BAD = 0.9;
/** The graph's ceiling in frame budgets: room to show a missed frame without flattening the rest. */
const GRAPH_BUDGETS = 2;
const GRAPH_W = 220;
const GRAPH_H = 34;
/** The share of its slot a frame's bar fills, leaving a gap between neighbours. */
const GRAPH_BAR_FILL = 0.7;
const PERCENT = 100;
const MS_PER_SECOND = 1000;

const VERDICT_HEALTH: Readonly<Record<PerfVerdict, Health>> = {
  display: 'good',
  cap: 'good',
  paused: 'good',
  room: 'warn',
  other: 'warn',
  sim: 'bad',
  cpu: 'bad',
  gpu: 'bad',
};

/** Tip ids run across mounts: a HUD rescale builds the next bar before disposing the last. */
let nextTipId = 0;

function frameHealth(reading: PerfReading): Health {
  if (reading.frameMs <= reading.budgetMs * FRAME_GOOD_RATIO) return 'good';
  return reading.frameMs <= reading.budgetMs * FRAME_WARN_RATIO ? 'warn' : 'bad';
}

function loadHealth(load: number): Health {
  if (load >= LOAD_BAD) return 'bad';
  return load >= LOAD_WARN ? 'warn' : 'good';
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function decimal(ms: number): string {
  return ms.toFixed(1);
}

interface Meter {
  readonly row: HTMLElement;
  readonly fill: HTMLElement;
  readonly value: HTMLElement;
}

function meterRow(label: string): Meter {
  const row = document.createElement('div');
  row.className = 'on-perf__row';
  const name = document.createElement('span');
  name.textContent = label;
  const track = document.createElement('i');
  track.className = 'on-perf__meter';
  const fill = document.createElement('i');
  track.append(fill);
  const value = document.createElement('b');
  row.append(name, track, value);
  return { row, fill, value };
}

/** Fills `meter` to `load` (null leaves it empty) and labels it with `text`. */
function showMeter(meter: Meter, load: number | null, text: string): void {
  meter.fill.style.width = `${Math.min(1, load ?? 0) * PERCENT}%`;
  meter.row.dataset.health = load === null ? 'none' : loadHealth(load);
  setText(meter.value, text);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One bar per frame, right-aligned so the newest frame stands at the right edge, in two paths split at
 *  the budget so a missed frame shows in its own colour. */
function graphPaths(frameTimes: ArrayLike<number>, budgetMs: number): { within: string; over: string } {
  const ceiling = budgetMs * GRAPH_BUDGETS;
  const step = GRAPH_W / Math.max(1, frameTimes.length);
  let within = '';
  let over = '';
  for (let i = 0; i < frameTimes.length; i++) {
    const ms = frameTimes[i] ?? 0;
    const h = Math.min(GRAPH_H, (ms / ceiling) * GRAPH_H);
    const bar = `M${(i * step).toFixed(1)} ${GRAPH_H}v${(-h).toFixed(1)}h${(step * GRAPH_BAR_FILL).toFixed(2)}v${h.toFixed(1)}z`;
    if (ms > budgetMs * FRAME_GOOD_RATIO) over += bar;
    else within += bar;
  }
  return { within, over };
}

export function createPerfReadoutView(): PerfReadoutView {
  const copy = messages().performance.readout;
  const element = document.createElement('div');
  element.className = 'on-perf';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'on-perf__fps';
  button.setAttribute('aria-expanded', 'false');
  const fpsValue = document.createElement('b');
  fpsValue.textContent = '-';
  const fpsUnit = document.createElement('small');
  fpsUnit.textContent = copy.fps;
  button.append(fpsValue, fpsUnit);

  const tip = document.createElement('div');
  tip.className = 'on-tip on-perf__tip';
  tip.id = `on-perf-tip-${nextTipId++}`;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  button.setAttribute('aria-describedby', tip.id);
  const verdict = document.createElement('h4');
  verdict.className = 'on-tip__title on-perf__verdict';
  const hint = document.createElement('p');
  hint.className = 'on-perf__hint';
  const sim = meterRow(copy.sim);
  const cpu = meterRow(copy.cpu);
  const gpu = meterRow(copy.gpu);
  const graph = document.createElementNS(SVG_NS, 'svg');
  graph.setAttribute('class', 'on-perf__graph');
  graph.setAttribute('viewBox', `0 0 ${GRAPH_W} ${GRAPH_H}`);
  graph.setAttribute('preserveAspectRatio', 'none');
  const within = document.createElementNS(SVG_NS, 'path');
  within.setAttribute('class', 'on-perf__within');
  const over = document.createElementNS(SVG_NS, 'path');
  over.setAttribute('class', 'on-perf__over');
  const budgetLine = document.createElementNS(SVG_NS, 'path');
  budgetLine.setAttribute('class', 'on-perf__budget');
  const budgetY = GRAPH_H - GRAPH_H / GRAPH_BUDGETS;
  budgetLine.setAttribute('d', `M0 ${budgetY}H${GRAPH_W}`);
  graph.append(within, over, budgetLine);
  const frame = document.createElement('p');
  frame.className = 'on-perf__foot';
  const speed = document.createElement('p');
  speed.className = 'on-perf__foot on-perf__speed';
  speed.hidden = true;
  tip.append(verdict, hint, sim.row, cpu.row, gpu.row, graph, frame, speed);
  element.append(button, tip);

  const ms = (value: number): string => formatMessage(copy.ms, { value: decimal(value) });
  let last: { reading: PerfReading; frameTimes: ArrayLike<number> } | null = null;

  const fillTip = (reading: PerfReading, frameTimes: ArrayLike<number>): void => {
    tip.dataset.health = VERDICT_HEALTH[reading.verdict];
    setText(
      verdict,
      formatMessage(copy.verdicts[reading.verdict], {
        hz: Math.round(reading.displayHz),
        fps: Math.round(MS_PER_SECOND / reading.budgetMs),
      }),
    );
    const hintText = reading.verdict === 'other' ? copy.otherHint : '';
    hint.hidden = hintText === '';
    setText(hint, hintText);
    showMeter(sim, reading.simLoad, reading.simMsPerTick === null ? '-' : ms(reading.simMsPerTick));
    showMeter(cpu, reading.drawMs / reading.budgetMs, ms(reading.drawMs));
    showMeter(
      gpu,
      reading.gpuMs === null ? null : reading.gpuMs / reading.budgetMs,
      reading.gpuMs === null ? copy.notMeasured : ms(reading.gpuMs),
    );
    const paths = graphPaths(frameTimes, reading.budgetMs);
    within.setAttribute('d', paths.within);
    over.setAttribute('d', paths.over);
    setText(
      frame,
      formatMessage(copy.frame, { ms: decimal(reading.frameMs), worst: Math.round(reading.worstMs) }),
    );
    speed.hidden = reading.deliveredSpeed === null;
    if (reading.deliveredSpeed !== null) {
      setText(
        speed,
        formatMessage(copy.speed, {
          requested: reading.requestedSpeed,
          delivered: reading.deliveredSpeed.toFixed(1),
        }),
      );
    }
  };

  let open = false;
  const setOpen = (next: boolean): void => {
    if (next === open) return;
    open = next;
    tip.hidden = !next;
    button.setAttribute('aria-expanded', String(next));
    if (next && last !== null) fillTip(last.reading, last.frameTimes);
  };
  element.addEventListener('mouseenter', () => setOpen(true));
  element.addEventListener('mouseleave', () => setOpen(false));
  element.addEventListener('focusin', () => setOpen(true));
  element.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && element.contains(next))) setOpen(false);
  });
  button.addEventListener('click', () => setOpen(!open));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      event.stopPropagation();
    }
  });

  return {
    element,
    show(reading, frameTimes): void {
      last = { reading, frameTimes };
      setText(fpsValue, String(Math.round(reading.fps)));
      button.dataset.health = reading.verdict === 'paused' ? 'good' : frameHealth(reading);
      button.setAttribute('aria-label', formatMessage(copy.label, { fps: Math.round(reading.fps) }));
      if (open) fillTip(reading, frameTimes);
    },
  };
}
