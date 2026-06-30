import { describe, expect, test } from 'bun:test';
import { generateBearer, hashBearer } from './bearer';

describe('bearer', () => {
  test('generateBearer produces XXXX-XXXX-XXXX-XXXX-XXX shape', () => {
    expect(generateBearer()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
  });
  test('generateBearer is unique across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateBearer());
    expect(seen.size).toBe(1000);
  });
  test('hashBearer is 64 hex and deterministic', async () => {
    const a = await hashBearer('hello');
    const b = await hashBearer('hello');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
  test('hashBearer differs for different inputs', async () => {
    expect(await hashBearer('a')).not.toBe(await hashBearer('b'));
  });
});
