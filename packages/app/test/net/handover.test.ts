import { expect, it, vi } from 'vitest';
import {
  abandonNetworkHandover,
  type NetworkHandover,
  stageNetworkHandover,
  takeNetworkHandover,
} from '../../src/net/handover.js';

const HANDOVER = { connection: {}, map: {}, initialSave: null } as unknown as NetworkHandover;

it('hands an abandoned handover back to its stager, and lets the next start stage again', () => {
  const abandoned = vi.fn();
  stageNetworkHandover(HANDOVER, abandoned);
  const error = new Error('the game module failed to load');
  abandonNetworkHandover(error);
  expect(abandoned).toHaveBeenCalledExactlyOnceWith(error);
  expect(takeNetworkHandover()).toBeNull();
  stageNetworkHandover(HANDOVER, vi.fn());
  expect(takeNetworkHandover()).toBe(HANDOVER);
});

it('abandons nothing once the game took its handover', () => {
  const abandoned = vi.fn();
  stageNetworkHandover(HANDOVER, abandoned);
  takeNetworkHandover();
  abandonNetworkHandover(new Error('late'));
  expect(abandoned).not.toHaveBeenCalled();
});
