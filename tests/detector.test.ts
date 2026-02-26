import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProviders } from '../src/core/detector.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'envguard-detect-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('detectProviders', () => {
  it('detects GitHub from .github/ directory', () => {
    mkdirSync(join(testDir, '.github'));

    const result = detectProviders(testDir);
    expect(result).toEqual(['github']);
  });

  it('detects Vercel from vercel.json', () => {
    writeFileSync(join(testDir, 'vercel.json'), '{}');

    const result = detectProviders(testDir);
    expect(result).toEqual(['vercel']);
  });

  it('detects Vercel from .vercel/ directory', () => {
    mkdirSync(join(testDir, '.vercel'));

    const result = detectProviders(testDir);
    expect(result).toEqual(['vercel']);
  });

  it('detects Netlify from netlify.toml', () => {
    writeFileSync(join(testDir, 'netlify.toml'), '');

    const result = detectProviders(testDir);
    expect(result).toEqual(['netlify']);
  });

  it('detects Netlify from .netlify/ directory', () => {
    mkdirSync(join(testDir, '.netlify'));

    const result = detectProviders(testDir);
    expect(result).toEqual(['netlify']);
  });

  it('detects multiple providers', () => {
    mkdirSync(join(testDir, '.github'));
    writeFileSync(join(testDir, 'vercel.json'), '{}');
    writeFileSync(join(testDir, 'netlify.toml'), '');

    const result = detectProviders(testDir);
    expect(result).toEqual(['github', 'vercel', 'netlify']);
  });

  it('returns empty array when no providers detected', () => {
    const result = detectProviders(testDir);
    expect(result).toEqual([]);
  });

  it('uses configProviders when provided', () => {
    // Even though .github/ exists, config takes precedence
    mkdirSync(join(testDir, '.github'));

    const result = detectProviders(testDir, ['vercel']);
    expect(result).toEqual(['vercel']);
  });

  it('uses configProviders even when empty indicators exist', () => {
    const result = detectProviders(testDir, ['github', 'netlify']);
    expect(result).toEqual(['github', 'netlify']);
  });
});
