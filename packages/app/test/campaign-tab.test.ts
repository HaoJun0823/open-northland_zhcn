// @vitest-environment jsdom

import { Campaign } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCampaigns } from '../src/campaign/catalog.js';
import { campaignProgressKey, readCampaignProgress, skipCampaignStage } from '../src/campaign/progress.js';
import { campaignTabBody } from '../src/entries/main-menu/campaign/screen.js';
import type { MountedScreen } from '../src/entries/main-menu/model.js';
import { messages } from '../src/i18n/index.js';
import { campaignFixture } from './support/campaign.js';

const INDEX_VERSION = 3;
const OTHER_ORDER = 1;
const OTHER_CAMPAIGN_ID = 4;

const other = (): Campaign => {
  const base = campaignFixture();
  return Campaign.parse({
    ...base,
    id: 'other',
    campaignId: OTHER_CAMPAIGN_ID,
    order: OTHER_ORDER,
    maps: base.maps.map((map) => ({ ...map, id: `other-${map.id}` })),
    stages: base.stages.map((stage) => ({ ...stage, mapId: `other-${stage.mapId}` })),
  });
};

function serveIndex(value: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
  );
}

const mounted: MountedScreen[] = [];
async function mount(launch = vi.fn<(search: string) => void>()) {
  const screen = campaignTabBody(launch, () => () => undefined);
  mounted.push(screen);
  document.body.append(screen.element);
  await vi.waitFor(() =>
    expect(
      screen.element.querySelector('.campaign-screen__start, .campaign-screen__status:not(:empty)'),
    ).not.toBeNull(),
  );
  return { root: screen.element, launch };
}

const q = <T extends HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
};
const missions = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.campaign-screen__mission')].map((row) => row.dataset.mapId ?? '');
const confirmButtons = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('.on-system-confirm__actions button'),
];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.localStorage.clear();
  window.history.replaceState(null, '', '/?menu=campaign');
  serveIndex({ version: INDEX_VERSION, campaigns: [campaignFixture(), other()] });
});

afterEach(() => {
  for (const screen of mounted.splice(0)) screen.dispose?.();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('campaign index', () => {
  it('reads a drifted or wrong-version index as no campaign installed', async () => {
    serveIndex({ version: INDEX_VERSION + 1, campaigns: [campaignFixture()] });
    expect(await loadCampaigns()).toEqual([]);
    serveIndex({ version: INDEX_VERSION, campaigns: [{ id: 'broken' }] });
    expect(await loadCampaigns()).toEqual([]);
    const { root } = await mount();
    expect(q(root, '.campaign-screen__status').textContent).toBe(messages().campaign.empty);
  });
});

describe('campaign tab', () => {
  it('starts the selected mission and stays usable when the launch does not hand over', async () => {
    const { root, launch } = await mount();
    q<HTMLButtonElement>(root, '.campaign-screen__start').click();
    expect(launch).toHaveBeenCalledOnce();
    const search = new URLSearchParams(launch.mock.calls[0]?.[0]);
    expect(search.get('map')).toBe('first');
    expect(search.get('missions')).toBe('on');
    expect([...root.querySelectorAll('button')].every((button) => !button.disabled)).toBe(true);
    q<HTMLButtonElement>(root, '.campaign-screen__start').click();
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('does not launch while a question is open', async () => {
    const { root, launch } = await mount();
    q<HTMLButtonElement>(root, '.campaign-screen__skip').click();
    q<HTMLButtonElement>(root, '.campaign-screen__start').click();
    expect(launch).not.toHaveBeenCalled();
    confirmButtons()[0]?.click();
  });

  it('unlocks the next mission on a skip, completes the campaign past the last, then hides the skip', async () => {
    const { root } = await mount();
    q<HTMLButtonElement>(root, '.campaign-screen__skip').click();
    expect(q(document.body, '.on-system-confirm__message').textContent).toBe(messages().campaign.confirm);
    confirmButtons()[1]?.click();
    await vi.waitFor(() => expect(missions(root)).toEqual(['first', 'second']));
    expect(q(root, '.campaign-screen__mission[aria-pressed="true"]').dataset.mapId).toBe('second');
    await new Promise((resolve) => setTimeout(resolve, 0));
    q<HTMLButtonElement>(root, '.campaign-screen__skip').click();
    expect(q(document.body, '.on-system-confirm__message').textContent).toBe(messages().campaign.confirm);
    confirmButtons()[1]?.click();
    await vi.waitFor(() => expect(root.querySelector('.campaign-screen__skip')).toBeNull());
    expect(readCampaignProgress(campaignFixture(), window.localStorage)).toEqual({
      unlocked: ['first', 'second'],
      completed: true,
    });
  });

  it('resets one campaign only after confirmation, with cancel focused first', async () => {
    skipCampaignStage(campaignFixture(), window.localStorage);
    skipCampaignStage(other(), window.localStorage);
    const { root } = await mount();
    q<HTMLButtonElement>(root, '.campaign-screen__reset').click();
    expect(document.activeElement).toBe(confirmButtons()[0]);
    confirmButtons()[0]?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(missions(root)).toEqual(['first', 'second']);
    q<HTMLButtonElement>(root, '.campaign-screen__reset').click();
    confirmButtons()[1]?.click();
    await vi.waitFor(() => expect(missions(root)).toEqual(['first']));
    expect(root.querySelector('.campaign-screen__reset')).toBeNull();
    expect(readCampaignProgress(other(), window.localStorage).unlocked).toEqual([
      'other-first',
      'other-second',
    ]);
  });

  it('re-renders only for its own progress key and keeps focus on the same control', async () => {
    const { root } = await mount();
    const start = q<HTMLButtonElement>(root, '.campaign-screen__start');
    window.dispatchEvent(new StorageEvent('storage', { key: campaignProgressKey(other()) }));
    expect(q(root, '.campaign-screen__start')).toBe(start);
    q<HTMLButtonElement>(root, '[data-map-id="first"]').focus();
    skipCampaignStage(campaignFixture(), window.localStorage);
    window.dispatchEvent(new StorageEvent('storage', { key: campaignProgressKey(campaignFixture()) }));
    expect(missions(root)).toEqual(['first', 'second']);
    expect(document.activeElement).toBe(q(root, '[data-map-id="first"]'));
  });

  it('opens the deep-linked campaign once, then keeps the viewer choice on a remount', async () => {
    window.history.replaceState(null, '', '/?menu=campaign&campaign=other');
    const first = await mount();
    expect(missions(first.root)).toEqual(['other-first']);
    expect(new URLSearchParams(window.location.search).get('campaign')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('menu')).toBe('campaign');
    const tabs = first.root.querySelectorAll<HTMLButtonElement>('.campaign-screen__campaign');
    tabs[0]?.click();
    expect(missions(first.root)).toEqual(['first']);
    const second = await mount();
    expect(missions(second.root)).toEqual(['first']);
  });

  it('shows the first mission with a warning when progress cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked storage', 'SecurityError');
    });
    const { root } = await mount();
    expect(missions(root)).toEqual(['first']);
    expect(q(root, '.campaign-screen__status').textContent).toBe(messages().campaign.storageUnreadable);
    expect(root.querySelector('.campaign-screen__skip')).toBeNull();
    expect(q<HTMLButtonElement>(root, '.campaign-screen__start').disabled).toBe(false);
  });
});
