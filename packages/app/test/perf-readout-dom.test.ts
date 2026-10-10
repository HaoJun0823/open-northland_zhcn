// @vitest-environment jsdom
import type { Application } from 'pixi.js';
import { afterEach, expect, it } from 'vitest';
import type { FrameSample } from '../src/diag/frame-stats.js';
import { createHudSystemBar, type HudSystemBar } from '../src/hud/dom/system-bar.js';
import { messages } from '../src/i18n/index.js';
import { mountPerfReadout } from '../src/view/runtime/perf-readout.js';

const bars: HudSystemBar[] = [];

afterEach(() => {
  for (const bar of bars.splice(0)) bar.dispose();
  document.body.replaceChildren();
});

function systemBar(): { bar: HudSystemBar; plane: HTMLElement } {
  const plane = document.createElement('div');
  document.body.append(plane);
  const bar = createHudSystemBar(plane, {
    summary: { paintGood: () => {}, goodIdOf: () => undefined, goodLabel: (id) => id },
    onPauseToggle: () => undefined,
    onSpeed: () => undefined,
    onMenu: () => undefined,
  });
  bars.push(bar);
  return { bar, plane };
}

const frame: FrameSample = {
  elapsedMs: 1000 / 60,
  tick: 10,
  steps: 1,
  droppedTicks: 0,
  speed: 1,
  paused: false,
  entities: 0,
  drawn: 0,
  pooled: 0,
  cpuMs: 4,
  simMs: 1,
  receiveMs: 0,
  batches: 0,
  leadTicks: 0,
  snapMs: 1,
  drawMs: 2,
  worldMs: 1,
};

/** A renderer without WebGL, so the GPU row has no timer. */
const app = { renderer: {} } as unknown as Application;

function feedSecond(readout: ReturnType<typeof mountPerfReadout>): void {
  for (let i = 0; i < 60; i++) readout.record(frame, null);
}

it('stands first in the bar once switched on, and follows a rebuilt bar after a HUD rescale', () => {
  const first = systemBar();
  let bar = first.bar;
  const readout = mountPerfReadout({
    app,
    context: { capFps: null, simOnMainThread: false, sharedClock: false },
    initialMode: 'off',
    controller: () => ({ showInBar: (node) => bar.setLead(node) }),
  });
  feedSecond(readout);
  expect(first.plane.querySelector('.on-perf')).toBeNull();

  readout.setMode('details');
  feedSecond(readout);
  const lead = first.plane.querySelector<HTMLElement>('.on-bar__lead');
  expect(lead?.hidden).toBe(false);
  expect(first.plane.querySelector('.on-bar')?.firstElementChild).toBe(lead);
  const copy = messages().performance.readout;
  expect(first.plane.querySelector('.on-perf__fps b')?.textContent).toBe('60');
  expect(first.plane.querySelector('.on-perf__verdict')?.textContent).toBe(
    copy.verdicts.display.replace('{hz}', '60'),
  );
  expect(first.plane.querySelectorAll('.on-perf__row b')[2]?.textContent).toBe(copy.notMeasured);

  const second = systemBar();
  bar = second.bar;
  feedSecond(readout);
  expect(second.plane.querySelector('.on-perf')).not.toBeNull();

  readout.setMode('off');
  expect(second.plane.querySelector<HTMLElement>('.on-bar__lead')?.hidden).toBe(true);
  readout.dispose();
});
