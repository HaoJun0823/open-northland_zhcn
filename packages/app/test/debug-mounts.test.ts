// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { type DebugMountsOptions, mountDebugOverlays } from '../src/view/runtime/debug-mounts.js';

afterEach(() => {
  document.body.replaceChildren();
});

function mounts(allowWorldEdits: boolean) {
  const plane = document.createElement('div');
  const barLead = document.createElement('div');
  document.body.append(plane, barLead);
  const opts = {
    canvas: document.createElement('canvas'),
    params: new URLSearchParams(),
    plane,
    barLead,
    initialToolsEnabled: true,
    allowWorldEdits,
    host: {
      content: {
        goods: [],
        animals: [],
        tribes: [],
        vehicles: [],
        armor: [],
        buildings: [],
        jobExperience: [],
      },
      needsEnabled: () => true,
      fogMode: () => 0,
    },
    renderer: { setGeometryDebug: () => undefined },
    cameraCtl: { setZoomOutUnlocked: () => undefined },
    clientToTile: () => null,
    claimPointer: () => false,
    goodLabel: () => undefined,
    seatTribeOf: () => 0,
  } as unknown as DebugMountsOptions;
  return { debug: mountDebugOverlays(opts), plane, barLead };
}

it('stands the tools toggle in the bar and hides it with the HUD or the setting', () => {
  const { debug, plane, barLead } = mounts(true);
  const toggle = barLead.querySelector<HTMLButtonElement>('.on-admin-toggle');
  const panel = plane.querySelector<HTMLElement>('.on-admin');
  expect(toggle?.hidden).toBe(false);
  expect(panel?.hidden).toBe(true);

  toggle?.click();
  expect(panel?.hidden).toBe(false);

  debug.setHudHidden(true);
  expect(toggle?.hidden).toBe(true);
  expect(panel?.hidden).toBe(true);
  debug.setToolsEnabled(false);
  debug.setToolsEnabled(true);
  expect(toggle?.hidden).toBe(true);
  debug.setHudHidden(false);
  expect(toggle?.hidden).toBe(false);

  debug.setToolsEnabled(false);
  debug.setHudHidden(true);
  debug.setHudHidden(false);
  expect(toggle?.hidden).toBe(true);

  debug.dispose();
  expect(barLead.childElementCount).toBe(0);
  expect(plane.querySelector('.on-admin')).toBeNull();
});

it('mounts no tools where world edits are off', () => {
  const { debug, plane, barLead } = mounts(false);
  expect(barLead.childElementCount).toBe(0);
  expect(plane.childElementCount).toBe(0);
  debug.dispose();
});
