import { RelayRefusal } from '@open-northland/net-client';
import type { ServerMessage } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_REQUEST_COOLDOWN_MS, relayMapRequest } from '../../src/net/map-request.js';

const TOO_SOON: ServerMessage = { kind: 'rejected', of: 'requestMap', reason: { code: 'retryTooSoon' } };
const MAP: ServerMessage = { kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: 'map text' };

afterEach(() => vi.useRealTimers());

describe('the request for the relay kept map', () => {
  it('asks once more after the cooldown when a replaced socket asked too soon', async () => {
    vi.useFakeTimers();
    const client = { requestMap: vi.fn() };
    const request = relayMapRequest(client);
    const delivered = request.request();
    request.relinked();
    expect(client.requestMap).toHaveBeenCalledTimes(2);
    expect(request.observe(TOO_SOON)).toBe(true);
    vi.advanceTimersByTime(MAP_REQUEST_COOLDOWN_MS - 1);
    expect(client.requestMap).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(client.requestMap).toHaveBeenCalledTimes(3);
    expect(request.observe(MAP)).toBe(true);
    await expect(delivered).resolves.toBe('map text');
  });

  it('settles on the relay refusal once the one retry was refused too', async () => {
    vi.useFakeTimers();
    const request = relayMapRequest({ requestMap: vi.fn() });
    const delivered = request.request();
    request.observe(TOO_SOON);
    vi.advanceTimersByTime(MAP_REQUEST_COOLDOWN_MS);
    request.observe(TOO_SOON);
    await expect(delivered).rejects.toEqual(new RelayRefusal({ code: 'retryTooSoon' }));
  });

  it('leaves a map nobody asked for, and an abandoned request, to the rest of the page', async () => {
    const client = { requestMap: vi.fn() };
    const request = relayMapRequest(client);
    expect(request.observe(MAP)).toBe(false);
    request.relinked();
    expect(client.requestMap).not.toHaveBeenCalled();
    const delivered = request.request();
    request.cancel();
    await expect(delivered).rejects.toThrow();
    expect(request.observe(MAP)).toBe(false);
  });
});
