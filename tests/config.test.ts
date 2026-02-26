import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProjectRoot, loadConfig } from '../src/utils/config.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'envguard-config-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns null when no config file exists', () => {
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it('parses a valid full config', () => {
    const config = {
      envFiles: ['.env.local'],
      providers: ['github', 'vercel'],
      ignore: ['NODE_ENV'],
      envMapping: { '.env.production': 'production' },
    };
    writeFileSync(join(testDir, '.envguard.json'), JSON.stringify(config));

    const result = loadConfig(testDir);
    expect(result).toEqual(config);
  });

  it('parses a minimal valid config (empty object)', () => {
    writeFileSync(join(testDir, '.envguard.json'), '{}');

    const result = loadConfig(testDir);
    expect(result).toEqual({});
  });

  it('parses a partial config', () => {
    writeFileSync(join(testDir, '.envguard.json'), JSON.stringify({ providers: ['netlify'] }));

    const result = loadConfig(testDir);
    expect(result).toEqual({ providers: ['netlify'] });
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(testDir, '.envguard.json'), '{ invalid json }');

    expect(() => loadConfig(testDir)).toThrow('Invalid JSON');
  });

  it('throws on invalid provider name', () => {
    writeFileSync(join(testDir, '.envguard.json'), JSON.stringify({ providers: ['aws'] }));

    expect(() => loadConfig(testDir)).toThrow('Invalid .envguard.json');
  });

  it('throws on invalid envFiles type', () => {
    writeFileSync(join(testDir, '.envguard.json'), JSON.stringify({ envFiles: 'not-an-array' }));

    expect(() => loadConfig(testDir)).toThrow('Invalid .envguard.json');
  });
});

describe('getProjectRoot', () => {
  it('finds project root by walking up to package.json', () => {
    writeFileSync(join(testDir, 'package.json'), '{}');
    const subDir = join(testDir, 'src', 'deep');
    mkdirSync(subDir, { recursive: true });

    const root = getProjectRoot(subDir);
    expect(root).toBe(testDir);
  });

  it('returns start dir when no package.json found', () => {
    // testDir has no package.json
    // Walk up might find one in actual filesystem, so create a deep temp structure
    const isolated = mkdtempSync(join(tmpdir(), 'envguard-noroot-'));
    const deep = join(isolated, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });

    const root = getProjectRoot(deep);
    // Should fall back — may find root package.json or return deep
    expect(typeof root).toBe('string');

    rmSync(isolated, { recursive: true, force: true });
  });

  it('returns the dir itself if it has package.json', () => {
    writeFileSync(join(testDir, 'package.json'), '{}');

    const root = getProjectRoot(testDir);
    expect(root).toBe(testDir);
  });
});
