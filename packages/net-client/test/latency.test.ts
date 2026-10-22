import { CommandLatency } from '@open-northland/net-client';
import { describe, expect, it } from 'vitest';

describe('CommandLatency', () => {
  it('measures nothing until a command comes back', () => {
    const latency = new CommandLatency();
    latency.issued(100);
    expect(latency.clickToApplyMs).toBeNull();
    expect(latency.lastMs).toBeNull();
  });

  it('pairs each applied command with the oldest issue in order', () => {
    const latency = new CommandLatency();
    latency.issued(100);
    latency.issued(150);
    latency.applied(300);
    expect(latency.lastMs).toBe(200);
    latency.applied(400);
    expect(latency.lastMs).toBe(250);
    expect(latency.clickToApplyMs).toBeGreaterThan(200);
    expect(latency.clickToApplyMs).toBeLessThan(250);
  });

  it('drops the newest stamp for a relay refusal, which answers before older commands come back', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.issued(1000);
    latency.refused();
    latency.applied(200);
    expect(latency.lastMs).toBe(200);
    expect(latency.inFlight).toBe(0);
  });

  it('drops the oldest stamp for a command every client dropped from its frame', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.issued(1000);
    latency.dropped();
    latency.applied(1200);
    expect(latency.lastMs).toBe(200);
  });

  it('forgets the stamps in flight, so a command that never comes back skews no later one', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.forgetInFlight();
    latency.issued(60_000);
    latency.applied(60_250);
    expect(latency.lastMs).toBe(250);
    expect(latency.inFlight).toBe(0);
  });

  it('counts carried commands in flight without measuring them, until the relay could no longer land them', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.issued(10);
    latency.carryOver(3);
    expect(latency.inFlight).toBe(2);
    expect(latency.carrying).toBe(true);
    latency.relayAt(40, 2, 38);
    latency.applied(500);
    expect(latency.lastMs).toBeNull();
    latency.ran(42);
    expect(latency.inFlight).toBe(1);
    latency.ran(43);
    expect(latency.inFlight).toBe(0);
    expect(latency.carrying).toBe(false);
  });

  it('keeps carried commands until the relay tick after the change is known', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.carryOver(2);
    latency.ran(1000);
    expect(latency.carrying).toBe(true);
    latency.relayAt(10, 2, 12);
    expect(latency.carrying).toBe(false);
  });

  it('settles carried commands the relay refuses or every client drops', () => {
    const latency = new CommandLatency();
    latency.issued(0);
    latency.issued(0);
    latency.carryOver(2);
    latency.refused();
    latency.dropped();
    expect(latency.inFlight).toBe(0);
    expect(latency.carrying).toBe(false);
  });

  it('ignores an application nothing was issued for', () => {
    const latency = new CommandLatency();
    latency.applied(500);
    expect(latency.lastMs).toBeNull();
  });
});
