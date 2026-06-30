import { describe, expect, it } from 'bun:test';
import { generatePin, isPinShape } from './pin';

describe('generatePin', () => {
  it('matches XXX-XXX with unambiguous alphabet', () => {
    const pin = generatePin();
    expect(pin).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
  });

  it('produces different values across calls', () => {
    const a = generatePin();
    const b = generatePin();
    expect(a).not.toBe(b);
  });
});

describe('isPinShape', () => {
  it('accepts the formatted PIN', () => {
    expect(isPinShape('K7P-Q3M')).toBe(true);
  });

  it('rejects ambiguous chars', () => {
    expect(isPinShape('O1L-IL0')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isPinShape('K7P')).toBe(false);
    expect(isPinShape('K7PQ3M')).toBe(false);
  });
});
