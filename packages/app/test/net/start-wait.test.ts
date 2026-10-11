// @vitest-environment jsdom
import type { ClockState } from '@open-northland/net-client';
import type { RoomView } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import { createStartWait } from '../../src/entries/relay/start-wait.js';

it('keeps the roster visible for an observer still loading after the players start', async () => {
  const clock: ClockState = { kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null };
  const client = { nick: 'Observer', room: null, clockState: null as ClockState | null, waitingFor: [] };
  const wait = createStartWait(client);
  try {
    wait.progress(40);
    client.clockState = clock;
    wait.observe(clock);
    expect(document.querySelector('.boot-roster')).not.toBeNull();
    expect(wait.pending).toBe(true);
    await wait.untilStart(() => true);
    expect(document.querySelector('.boot-roster')).toBeNull();
    expect(wait.pending).toBe(false);
  } finally {
    wait.end();
  }
});

it('shows the local observer ready while seated players still load', async () => {
  const room = {
    members: [{ nick: 'Observer', seat: null, connected: true, loading: 30 }],
    seats: [],
  } as unknown as RoomView;
  const client = { nick: 'Observer', room, clockState: null as ClockState | null, waitingFor: [] };
  const wait = createStartWait(client);
  try {
    wait.progress(91);
    expect(document.querySelector('.boot-roster__row')?.getAttribute('data-state')).toBe('loading');
    const started = wait.untilStart(() => true);
    expect(wait.pending).toBe(true);
    expect(document.querySelector('.boot-roster__row')?.getAttribute('data-state')).toBe('ready');
    expect(document.querySelector<HTMLElement>('.boot-roster__fill')?.style.width).toBe('100%');
    client.clockState = { kind: 'clock', tick: 1, speed: 1, paused: false, by: null, governed: null };
    wait.observe(client.clockState);
    await started;
    expect(wait.pending).toBe(false);
  } finally {
    wait.end();
  }
});
