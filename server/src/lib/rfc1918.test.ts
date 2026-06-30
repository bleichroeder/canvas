import { describe, expect, test } from 'bun:test';
import { isRfc1918Host } from './rfc1918';

describe('isRfc1918Host', () => {
  test('10/8 ranges', () => {
    expect(isRfc1918Host('10.0.0.1')).toBe(true);
    expect(isRfc1918Host('10.255.255.255')).toBe(true);
  });
  test('192.168/16', () => {
    expect(isRfc1918Host('192.168.1.1')).toBe(true);
    expect(isRfc1918Host('192.169.1.1')).toBe(false);
  });
  test('172.16-31', () => {
    expect(isRfc1918Host('172.16.0.1')).toBe(true);
    expect(isRfc1918Host('172.31.255.255')).toBe(true);
    expect(isRfc1918Host('172.15.0.1')).toBe(false);
    expect(isRfc1918Host('172.32.0.1')).toBe(false);
  });
  test('plex.direct subdomain encoding', () => {
    expect(isRfc1918Host('10-0-15-100.deadbeef.plex.direct')).toBe(true);
    expect(isRfc1918Host('1-2-3-4.plex.direct')).toBe(false);
  });
  test('public IP', () => {
    expect(isRfc1918Host('8.8.8.8')).toBe(false);
  });
  test('hostname (non-IP)', () => {
    expect(isRfc1918Host('example.com')).toBe(false);
    expect(isRfc1918Host('')).toBe(false);
  });
});
