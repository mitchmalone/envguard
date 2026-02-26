import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverEnvFiles, loadSecrets, parseEnvFile } from '../src/core/env-parser.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'envguard-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('parseEnvFile', () => {
  it('parses simple KEY=value pairs', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'API_KEY=abc123\nDB_URL=postgres://localhost\n');

    const result = parseEnvFile(file);
    expect(result).toEqual({
      API_KEY: 'abc123',
      DB_URL: 'postgres://localhost',
    });
  });

  it('handles double-quoted values', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'MSG="hello world"\n');

    const result = parseEnvFile(file);
    expect(result.MSG).toBe('hello world');
  });

  it('handles single-quoted values', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, "MSG='hello world'\n");

    const result = parseEnvFile(file);
    expect(result.MSG).toBe('hello world');
  });

  it('handles empty values', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'EMPTY=\nALSO_EMPTY=\n');

    const result = parseEnvFile(file);
    expect(result.EMPTY).toBe('');
    expect(result.ALSO_EMPTY).toBe('');
  });

  it('skips comments and empty lines', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, '# this is a comment\n\nKEY=value\n\n# another comment\n');

    const result = parseEnvFile(file);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('handles export prefix', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'export API_KEY=abc\nexport DB_URL=postgres\n');

    const result = parseEnvFile(file);
    expect(result).toEqual({
      API_KEY: 'abc',
      DB_URL: 'postgres',
    });
  });

  it('strips inline comments from unquoted values', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'KEY=value # this is a comment\n');

    const result = parseEnvFile(file);
    expect(result.KEY).toBe('value');
  });

  it('preserves hash in quoted values', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'KEY="value # not a comment"\n');

    const result = parseEnvFile(file);
    expect(result.KEY).toBe('value # not a comment');
  });

  it('handles values with equals signs', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'CONNECTION=postgres://user:pass@host/db?ssl=true\n');

    const result = parseEnvFile(file);
    expect(result.CONNECTION).toBe('postgres://user:pass@host/db?ssl=true');
  });

  it('skips lines without equals', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, 'INVALID_LINE\nKEY=value\n');

    const result = parseEnvFile(file);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('returns empty object for non-existent file', () => {
    const result = parseEnvFile(join(testDir, 'does-not-exist'));
    expect(result).toEqual({});
  });

  it('trims whitespace around keys', () => {
    const file = join(testDir, '.env');
    writeFileSync(file, '  KEY  =value\n');

    const result = parseEnvFile(file);
    expect(result.KEY).toBe('value');
  });
});

describe('discoverEnvFiles', () => {
  it('discovers default .env files', () => {
    writeFileSync(join(testDir, '.env'), 'A=1');
    writeFileSync(join(testDir, '.env.local'), 'B=2');
    writeFileSync(join(testDir, '.env.production'), 'C=3');
    writeFileSync(join(testDir, 'package.json'), '{}');

    const files = discoverEnvFiles(testDir);
    expect(files).toHaveLength(3);
    expect(files[0]).toContain('.env');
    expect(files[1]).toContain('.env.local');
    expect(files[2]).toContain('.env.production');
  });

  it('returns empty array when no .env files exist', () => {
    const files = discoverEnvFiles(testDir);
    expect(files).toEqual([]);
  });

  it('uses configEnvFiles when provided', () => {
    writeFileSync(join(testDir, '.env.custom'), 'A=1');
    writeFileSync(join(testDir, '.env'), 'B=2');

    const files = discoverEnvFiles(testDir, ['.env.custom']);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('.env.custom');
  });

  it('filters out non-existent configEnvFiles', () => {
    writeFileSync(join(testDir, '.env'), 'A=1');

    const files = discoverEnvFiles(testDir, ['.env', '.env.missing']);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('.env');
  });

  it('ignores non-.env files', () => {
    writeFileSync(join(testDir, '.env'), 'A=1');
    writeFileSync(join(testDir, 'package.json'), '{}');
    writeFileSync(join(testDir, 'README.md'), '# hi');

    const files = discoverEnvFiles(testDir);
    expect(files).toHaveLength(1);
  });

  it('returns empty array for non-existent directory', () => {
    const files = discoverEnvFiles(join(testDir, 'nope'));
    expect(files).toEqual([]);
  });
});

describe('loadSecrets', () => {
  it('loads secrets from all discovered env files', () => {
    writeFileSync(join(testDir, '.env'), 'API_KEY=abc\nDB_URL=postgres\n');
    writeFileSync(join(testDir, '.env.local'), 'LOCAL_SECRET=xyz\n');

    const secrets = loadSecrets(testDir);
    expect(secrets).toHaveLength(3);
    expect(secrets.map((s) => s.key)).toContain('API_KEY');
    expect(secrets.map((s) => s.key)).toContain('DB_URL');
    expect(secrets.map((s) => s.key)).toContain('LOCAL_SECRET');
  });

  it('includes source file in each entry', () => {
    writeFileSync(join(testDir, '.env'), 'KEY=val\n');

    const secrets = loadSecrets(testDir);
    expect(secrets[0].source).toBe('.env');
  });

  it('respects ignore list from config', () => {
    writeFileSync(join(testDir, '.env'), 'API_KEY=abc\nNODE_ENV=development\nDEBUG=true\n');

    const secrets = loadSecrets(testDir, { ignore: ['NODE_ENV', 'DEBUG'] });
    expect(secrets).toHaveLength(1);
    expect(secrets[0].key).toBe('API_KEY');
  });

  it('uses envFiles from config', () => {
    writeFileSync(join(testDir, '.env.custom'), 'SECRET=val\n');
    writeFileSync(join(testDir, '.env'), 'OTHER=ignored\n');

    const secrets = loadSecrets(testDir, { envFiles: ['.env.custom'] });
    expect(secrets).toHaveLength(1);
    expect(secrets[0].key).toBe('SECRET');
    expect(secrets[0].source).toBe('.env.custom');
  });

  it('returns empty array when no env files found', () => {
    const secrets = loadSecrets(testDir);
    expect(secrets).toEqual([]);
  });
});
