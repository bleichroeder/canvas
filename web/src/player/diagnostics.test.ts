import { describe, expect, test } from 'bun:test';
import { Ring } from './diagnostics';

describe('Ring', () => {
  test('push adds items in order until cap', () => {
    const r = new Ring<number>(5);
    for (let i = 0; i < 5; i++) r.push(i);
    expect(r.snapshot()).toEqual([0, 1, 2, 3, 4]);
    expect(r.length).toBe(5);
  });

  test('push beyond cap drops oldest', () => {
    const r = new Ring<number>(3);
    for (let i = 0; i < 5; i++) r.push(i);
    expect(r.snapshot()).toEqual([2, 3, 4]);
    expect(r.length).toBe(3);
  });

  test('snapshot returns a copy — mutating it does not affect the ring', () => {
    const r = new Ring<number>(3);
    r.push(1); r.push(2);
    const s = r.snapshot();
    s.push(999);
    expect(r.snapshot()).toEqual([1, 2]);
  });

  test('cap of 500 accepts 500 items and drops when exceeded', () => {
    const r = new Ring<number>(500);
    for (let i = 0; i < 600; i++) r.push(i);
    const s = r.snapshot();
    expect(s.length).toBe(500);
    expect(s[0]).toBe(100);
    expect(s[499]).toBe(599);
  });
});
