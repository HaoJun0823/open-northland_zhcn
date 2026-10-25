// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectionForm } from '../../../../src/entries/main-menu/network/connection-form.js';
import type { RelayPing } from '../../../../src/entries/main-menu/network/server/ping.js';
import { RELAY_REGIONS } from '../../../../src/entries/main-menu/network/server/regions.js';
import { messages } from '../../../../src/i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../../../src/view/settings/store.js';

const [EUROPE, ASIA] = RELAY_REGIONS.map((region) => region.url);
const forms: Array<ReturnType<typeof connectionForm>> = [];

/** Each region answers after the ping its URL is given, or never answers when absent. */
function pings(table: Readonly<Record<string, number | null>>): RelayPing {
  return async (url) => table[url] ?? null;
}

function form(initial: string | null, ping: RelayPing = pings({})): ReturnType<typeof connectionForm> {
  const view = connectionForm(initial, vi.fn(), ping);
  forms.push(view);
  document.body.append(view.form);
  return view;
}

function regionCard(view: ReturnType<typeof connectionForm>, url: string | undefined): HTMLButtonElement {
  const id = RELAY_REGIONS.find((region) => region.url === url)?.id;
  const card = view.form.querySelector<HTMLButtonElement>(`[data-region="${id}"]`);
  if (card === null) throw new Error(`no card for ${url}`);
  return card;
}

let storedRelay: string | null;
beforeEach(() => {
  storedRelay = readStoredSettings().netCustomRelayUrl;
  patchStoredSettings({ netCustomRelayUrl: null });
});
afterEach(() => {
  for (const view of forms.splice(0)) view.dispose();
  patchStoredSettings({ netCustomRelayUrl: storedRelay });
  document.body.replaceChildren();
});

it('selects the region with the lower ping on entry and shows each reading', async () => {
  const view = form(null, pings({ [EUROPE ?? '']: 140, [ASIA ?? '']: 35 }));
  await vi.waitFor(() => expect(view.address.value).toBe(ASIA));
  expect(regionCard(view, ASIA).getAttribute('aria-checked')).toBe('true');
  expect(regionCard(view, EUROPE).getAttribute('aria-checked')).toBe('false');
  expect(regionCard(view, ASIA).textContent).toContain('35 ms');
  expect(view.advanced.open).toBe(false);
});

it('keeps a region the player picked before the pings answered', async () => {
  let answer: (ms: number) => void = () => undefined;
  const view = form(null, (url) =>
    url === ASIA ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(200),
  );
  regionCard(view, EUROPE).click();
  answer(20);
  await vi.waitFor(() => expect(regionCard(view, ASIA).textContent).toContain('20 ms'));
  expect(view.address.value).toBe(EUROPE);
});

it('marks a region that does not answer and stays on the one that did', async () => {
  const view = form(null, pings({ [ASIA ?? '']: 300 }));
  await vi.waitFor(() => expect(view.address.value).toBe(ASIA));
  expect(regionCard(view, EUROPE).textContent).toContain(messages().network.pingUnavailable);
});

it('remembers only a custom address and leaves a URL override alone', async () => {
  const view = form(null);
  view.address.value = '  ws://localhost:8768  ';
  view.address.dispatchEvent(new Event('input'));
  view.address.dispatchEvent(new Event('change'));
  expect(view.form.textContent).toContain(messages().network.customServer);
  expect(form(null).address.value).toBe('ws://localhost:8768');
  view.address.value = 'invalid';
  view.rememberAddress();
  expect(form(null).address.value).toBe('ws://localhost:8768');
  regionCard(view, ASIA).click();
  expect(view.address.value).toBe(ASIA);
  expect(readStoredSettings().netCustomRelayUrl).toBeNull();
  const override = form('ws://localhost:9000', pings({ [ASIA ?? '']: 10 }));
  await vi.waitFor(() => expect(regionCard(override, ASIA).textContent).toContain('10 ms'));
  expect(override.address.value).toBe('ws://localhost:9000');
  expect(override.advanced.open).toBe(true);
});
