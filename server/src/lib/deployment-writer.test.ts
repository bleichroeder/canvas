import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeploymentSidecarFiles } from './deployment-writer';
import type { DeploymentConfig } from '../db/schema';

const base: DeploymentConfig = {
  id: 1, mode: 'local', domain: null, adminEmail: null, cfNamedToken: null,
  publicUrl: null, status: 'ready', statusMessage: null,
  certExpiresAt: null, lastAppliedAt: null,
};

describe('writeDeploymentSidecarFiles', () => {
  test('writes plaintext mode + domain files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-dep-'));
    writeDeploymentSidecarFiles({ ...base, mode: 'domain', domain: 'canvas.example.com' }, dir);
    expect(readFileSync(join(dir, '.deployment-mode'), 'utf8')).toBe('domain');
    expect(readFileSync(join(dir, '.deployment-domain'), 'utf8')).toBe('canvas.example.com');
    rmSync(dir, { recursive: true, force: true });
  });

  test('empty strings for absent fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-dep-'));
    writeDeploymentSidecarFiles(base, dir);
    expect(readFileSync(join(dir, '.deployment-domain'), 'utf8')).toBe('');
    expect(readFileSync(join(dir, '.deployment-cf-token'), 'utf8')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
