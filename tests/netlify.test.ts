import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { netlifyProvider, parseEnvListOutput } from '../src/providers/netlify.js';

// Mock execCommand so we don't shell out to real `netlify`
vi.mock('../src/utils/exec.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../src/utils/exec.js';

const mockedExec = vi.mocked(execCommand);

describe('parseEnvListOutput', () => {
  it('parses array of env objects', () => {
    const json = JSON.stringify([
      { key: 'API_KEY', scopes: ['builds', 'functions', 'runtime', 'post_processing'] },
      { key: 'DB_URL', scopes: ['builds', 'functions'] },
    ]);
    expect(parseEnvListOutput(json)).toEqual(['API_KEY', 'DB_URL']);
  });

  it('returns empty array for empty array', () => {
    expect(parseEnvListOutput('[]')).toEqual([]);
  });

  it('returns empty array for non-array response', () => {
    expect(parseEnvListOutput('{}')).toEqual([]);
  });

  it('returns empty array for object with envs field (not expected format)', () => {
    expect(parseEnvListOutput('{"envs":[]}')).toEqual([]);
  });
});

describe('Netlify provider — detect', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `envguard-netlify-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects when netlify.toml exists', async () => {
    writeFileSync(join(tempDir, 'netlify.toml'), '[build]\n  command = "npm run build"');
    expect(await netlifyProvider.detect(tempDir)).toBe(true);
  });

  it('detects when .netlify/ directory exists', async () => {
    mkdirSync(join(tempDir, '.netlify'));
    expect(await netlifyProvider.detect(tempDir)).toBe(true);
  });

  it('returns false when neither exists', async () => {
    expect(await netlifyProvider.detect(tempDir)).toBe(false);
  });
});

describe('Netlify provider — targets', () => {
  it('returns all', () => {
    expect(netlifyProvider.targets()).toEqual(['all']);
  });
});

describe('Netlify provider — checkPrerequisites', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('returns ok when CLI is installed, authenticated, and site is linked', async () => {
    const tempDir = join(tmpdir(), `envguard-netlify-prereq-${Date.now()}`);
    mkdirSync(join(tempDir, '.netlify'), { recursive: true });
    writeFileSync(join(tempDir, '.netlify', 'state.json'), '{"siteId":"abc"}');
    process.cwd = () => tempDir;

    mockedExec.mockResolvedValueOnce({
      stdout: 'netlify-cli/17.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: 'Logged in as user@example.com',
      stderr: '',
      exitCode: 0,
    });

    const result = await netlifyProvider.checkPrerequisites();
    expect(result.ok).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports missing netlify CLI', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'command not found: netlify',
      exitCode: 127,
    });

    const result = await netlifyProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('netlify CLI');
    expect(result.fix).toContain('netlify-cli');
  });

  it('reports missing authentication', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: 'netlify-cli/17.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not logged in',
      exitCode: 1,
    });

    const result = await netlifyProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('Netlify authentication');
    expect(result.fix).toContain('netlify login');
  });

  it('reports missing site link', async () => {
    const tempDir = join(tmpdir(), `envguard-netlify-nolink-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.cwd = () => tempDir;

    mockedExec.mockResolvedValueOnce({
      stdout: 'netlify-cli/17.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: 'Logged in as user@example.com',
      stderr: '',
      exitCode: 0,
    });

    const result = await netlifyProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('Netlify site link');
    expect(result.fix).toContain('netlify link');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('Netlify provider — listRemoteKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output for env vars', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { key: 'API_KEY', scopes: ['builds', 'functions'] },
        { key: 'DB_URL', scopes: ['builds'] },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const keys = await netlifyProvider.listRemoteKeys('all');
    expect(keys).toEqual(['API_KEY', 'DB_URL']);

    expect(mockedExec).toHaveBeenCalledWith('netlify', ['env:list', '--json']);
  });

  it('returns empty array for empty response', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    const keys = await netlifyProvider.listRemoteKeys('all');
    expect(keys).toEqual([]);
  });

  it('throws on netlify failure', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not authorized',
      exitCode: 1,
    });

    await expect(netlifyProvider.listRemoteKeys('all')).rejects.toThrow(
      'Failed to list Netlify all env vars',
    );
  });
});

describe('Netlify provider — pushSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes secrets via env:set', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await netlifyProvider.pushSecrets(
      { API_KEY: 'secret1', DB_URL: 'postgres://...' },
      'all',
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      key: 'API_KEY',
      provider: 'netlify',
      target: 'all',
      status: 'ok',
      error: undefined,
    });
    expect(results[1]).toEqual({
      key: 'DB_URL',
      provider: 'netlify',
      target: 'all',
      status: 'ok',
      error: undefined,
    });

    expect(mockedExec).toHaveBeenCalledWith('netlify', ['env:set', 'API_KEY', 'secret1']);
    expect(mockedExec).toHaveBeenCalledWith('netlify', ['env:set', 'DB_URL', 'postgres://...']);
  });

  it('reports failed push', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
    });

    const results = await netlifyProvider.pushSecrets({ API_KEY: 'val' }, 'all');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('permission denied');
  });
});

describe('Netlify provider — deleteSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes secrets via env:unset', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await netlifyProvider.deleteSecrets(['API_KEY', 'DB_URL'], 'all');
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ok');

    expect(mockedExec).toHaveBeenCalledWith('netlify', ['env:unset', 'API_KEY']);
    expect(mockedExec).toHaveBeenCalledWith('netlify', ['env:unset', 'DB_URL']);
  });

  it('reports failed deletion', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'env var not found',
      exitCode: 1,
    });

    const results = await netlifyProvider.deleteSecrets(['MISSING_KEY'], 'all');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('env var not found');
  });
});

describe('Netlify provider — name and displayName', () => {
  it('has correct name', () => {
    expect(netlifyProvider.name).toBe('netlify');
  });

  it('has correct displayName', () => {
    expect(netlifyProvider.displayName).toBe('Netlify');
  });
});
