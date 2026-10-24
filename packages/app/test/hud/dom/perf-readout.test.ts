// @vitest-environment jsdom
import type { Application } from 'pixi.js';
import { afterEach, expect, it } from 'vitest';
import type { FrameSample } from '../../../src/diag/frame-stats.js';
import { shortAdapterName } from '../../../src/hud/dom/perf-readout.js';
import { createHudSystemBar, type HudSystemBar } from '../../../src/hud/dom/system/bar.js';
import { messages } from '../../../src/i18n/index.js';
import { mountPerfReadout } from '../../../src/view/runtime/perf-readout.js';

const bars: HudSystemBar[] = [];

afterEach(() => {
  for (const bar of bars.splice(0)) bar.dispose();
  document.body.replaceChildren();
});

function systemBar(lead: HTMLElement): { bar: HudSystemBar; plane: HTMLElement } {
  const plane = document.createElement('div');
  document.body.append(plane);
  const bar = createHudSystemBar(plane, {
    summary: { paintGood: () => {}, goodIdOf: () => undefined, goodLabel: (id) => id },
    onPauseToggle: () => undefined,
    onSpeed: () => undefined,
    onMenu: () => undefined,
    lead,
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

const METAL_M2 = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)';

/** A renderer without WebGL, so the GPU row has no timer. */
const app = { renderer: {} } as unknown as Application;

function feedSecond(readout: ReturnType<typeof mountPerfReadout>): void {
  for (let i = 0; i < 60; i++) readout.record(frame, null);
}

it('stands first in the bar once switched on', () => {
  const lead = document.createElement('div');
  const first = systemBar(lead);
  const toggle = document.createElement('button');
  lead.append(toggle);
  const readout = mountPerfReadout({
    app,
    context: { capFps: null, simOnMainThread: false, sharedClock: false },
    initiallyShown: false,
    adapter: null,
    lead,
  });
  feedSecond(readout);
  expect(first.plane.querySelector('.on-perf')).toBeNull();
  expect(readout.lastReading()).toBeNull();

  readout.setShown(true);
  feedSecond(readout);
  expect(readout.lastReading()?.fps).toBeCloseTo(60);
  // Without WebGL there is nothing to time the renders with.
  expect(readout.gpuTimer()).toBeUndefined();
  expect(first.plane.querySelector('.on-bar')?.firstElementChild).toBe(lead);
  // The counter leads the debug corner, ahead of the tools' toggle mounted before it.
  expect(lead.firstElementChild?.classList.contains('on-perf')).toBe(true);
  expect(lead.lastElementChild).toBe(toggle);
  expect(first.plane.querySelector('.on-perf__fps b')?.textContent).toBe('60');

  readout.setShown(false);
  expect(lead.querySelector('.on-perf')).toBeNull();
  expect(readout.lastReading()).toBeNull();
  readout.dispose();
});

it('opens the breakdown on hover with the latest reading and closes it on leave', () => {
  const lead = document.createElement('div');
  const { plane } = systemBar(lead);
  const readout = mountPerfReadout({
    app,
    context: { capFps: null, simOnMainThread: false, sharedClock: false },
    initiallyShown: true,
    adapter: METAL_M2,
    lead,
  });
  feedSecond(readout);
  const counter = plane.querySelector<HTMLElement>('.on-perf');
  const tip = plane.querySelector<HTMLElement>('.on-perf__tip');
  expect(tip?.hidden).toBe(true);

  counter?.dispatchEvent(new MouseEvent('mouseenter'));
  const copy = messages().performance.readout;
  expect(tip?.hidden).toBe(false);
  expect(plane.querySelector('.on-perf__verdict')?.textContent).toBe(
    copy.verdicts.display.replace('{hz}', '60'),
  );
  const adapterLine = plane.querySelector<HTMLElement>('.on-perf__adapter');
  expect(adapterLine?.textContent).toBe('Apple M2 Pro');
  expect(adapterLine?.title).toBe(METAL_M2);

  counter?.dispatchEvent(new MouseEvent('mouseleave'));
  expect(tip?.hidden).toBe(true);
  readout.dispose();
});

it('shortens ANGLE renderer strings to the device name', () => {
  expect(shortAdapterName(METAL_M2)).toBe('Apple M2 Pro');
  expect(
    shortAdapterName('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
  ).toBe('NVIDIA GeForce GTX 1650');
  expect(
    shortAdapterName('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
  ).toBe('Intel(R) UHD Graphics 630');
  expect(shortAdapterName('WebKit WebGL')).toBe('WebKit WebGL');
});
