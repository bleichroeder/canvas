import { describe, expect, it } from 'vitest';
import { parseFromSecParam } from './play';

describe('parseFromSecParam', () => {
  it('returns undefined when missing', () => {
    expect(parseFromSecParam(null)).toBeUndefined();
  });
  it('returns undefined when blank', () => {
    expect(parseFromSecParam('')).toBeUndefined();
  });
  it('returns undefined when non-numeric', () => {
    expect(parseFromSecParam('abc')).toBeUndefined();
  });
  it('returns undefined for negatives', () => {
    expect(parseFromSecParam('-5')).toBeUndefined();
  });
  it('returns the integer value for valid positive numbers', () => {
    expect(parseFromSecParam('300')).toBe(300);
    expect(parseFromSecParam('300.7')).toBe(300);
    expect(parseFromSecParam('0')).toBe(0);
  });
});
