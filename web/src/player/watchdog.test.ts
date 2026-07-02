import { describe, expect, test, beforeEach } from 'bun:test';
import { ring, __resetForTests } from './diagnostics';
import { createStallWatchdog } from './watchdog';

beforeEach(() => __resetForTests());

function readEmitted(): Array<{ kind: string; data: Record<string, unknown> }> {
  return ring.snapshot().map((e) => ({ kind: e.kind, data: e.data }));
}

describe('createStallWatchdog', () => {
  test('emits stall_detected after 5 silent ticks', () => {
    let now = 0;
    const wd = createStallWatchdog({
      getAudioClockSec: () => 10, // never advances
      nowMs: () => now,
    });
    wd.start();
    for (let i = 0; i < 5; i++) {
      now += 2000;
      wd.tick();
    }
    const events = readEmitted().filter((e) => e.kind === 'stall_detected');
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.data.silentDurationSec).toBe(10);
  });

  test('does not emit when clock advances', () => {
    let now = 0;
    let clock = 0;
    const wd = createStallWatchdog({
      getAudioClockSec: () => clock,
      nowMs: () => now,
    });
    wd.start();
    for (let i = 0; i < 10; i++) {
      now += 2000;
      clock += 2;
      wd.tick();
    }
    const events = readEmitted().filter((e) => e.kind === 'stall_detected');
    expect(events.length).toBe(0);
  });
});
