import { describe, expect, test } from 'bun:test';
import { parseConfig } from './config';

describe('parseConfig', () => {
  test('applies defaults for missing values', () => {
    const c = parseConfig({});
    expect(c.PORT).toBe(8787);
    expect(c.HOST).toBe('0.0.0.0');
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.NODE_ENV).toBe('production');
    expect(c.CANVAS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
  });

  test('coerces PORT from string', () => {
    expect(parseConfig({ PORT: '9000' }).PORT).toBe(9000);
  });

  test('splits CANVAS_ALLOWED_ORIGINS on commas', () => {
    const c = parseConfig({ CANVAS_ALLOWED_ORIGINS: 'http://a,http://b , http://c' });
    expect(c.CANVAS_ALLOWED_ORIGINS).toEqual(['http://a', 'http://b', 'http://c']);
  });

  test('rejects out-of-range PORT', () => {
    expect(() => parseConfig({ PORT: '99999' })).toThrow();
  });

  test('rejects invalid LOG_LEVEL', () => {
    expect(() => parseConfig({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});
