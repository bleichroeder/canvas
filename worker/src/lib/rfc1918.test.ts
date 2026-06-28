import { describe, it, expect } from 'vitest';
import { isRfc1918Host } from './rfc1918';

describe('isRfc1918Host', () => {
  it('returns true for bare 10.x literal', () => {
    expect(isRfc1918Host('10.0.0.1')).toBe(true);
    expect(isRfc1918Host('10.255.255.255')).toBe(true);
  });

  it('returns true for bare 192.168.x literal', () => {
    expect(isRfc1918Host('192.168.1.1')).toBe(true);
    expect(isRfc1918Host('192.168.255.255')).toBe(true);
  });

  it('returns true for bare 172.16-31.x literal', () => {
    expect(isRfc1918Host('172.16.0.1')).toBe(true);
    expect(isRfc1918Host('172.31.255.255')).toBe(true);
  });

  it('returns false for 172.15.x and 172.32.x', () => {
    expect(isRfc1918Host('172.15.0.1')).toBe(false);
    expect(isRfc1918Host('172.32.0.1')).toBe(false);
  });

  it('returns false for public IPs', () => {
    expect(isRfc1918Host('8.8.8.8')).toBe(false);
    expect(isRfc1918Host('1.1.1.1')).toBe(false);
  });

  it('decodes plex.direct subdomain IP encoding', () => {
    expect(isRfc1918Host('192-168-1-100.abc123def456.plex.direct')).toBe(true);
    expect(isRfc1918Host('10-0-0-5.xyz.plex.direct')).toBe(true);
    expect(isRfc1918Host('172-20-0-1.abc.plex.direct')).toBe(true);
  });

  it('returns false for public plex.direct hostnames', () => {
    expect(isRfc1918Host('32-218-121-209.abc.plex.direct')).toBe(false);
  });

  it('returns false for ordinary hostnames', () => {
    expect(isRfc1918Host('example.com')).toBe(false);
    expect(isRfc1918Host('media.tld')).toBe(false);
    expect(isRfc1918Host('localhost')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isRfc1918Host('')).toBe(false);
    expect(isRfc1918Host('not-an-ip')).toBe(false);
    expect(isRfc1918Host('192.168.1')).toBe(false);
  });
});
