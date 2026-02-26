import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnvListOutput, vercelProvider } from '../src/providers/vercel.js';

// Mock execCommand so we don't shell out to real `vercel`
vi.mock('../src/utils/exec.js', () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from '../src/utils/exec.js';

const mockedExec = vi.mocked(execCommand);

describe('parseEnvListOutput', () => {
  it('parses array format', () => {
    const json = JSON.stringify([
      { key: 'API_KEY', target: ['production'] },
      { key: 'DB_URL', target: ['preview'] },
    ]);
    expect(parseEnvListOutput(json)).toEqual(['API_KEY', 'DB_URL']);
  });

  it('parses wrapped { envs: [...] } format', () => {
    const json = JSON.stringify({
      envs: [
        { key: 'SECRET_A', target: ['production'] },
        { key: 'SECRET_B', target: ['development'] },
      ],
    });
    expect(parseEnvListOutput(json)).toEqual(['SECRET_A', 'SECRET_B']);
  });

  it('returns empty array for empty array', () => {
    expect(parseEnvListOutput('[]')).toEqual([]);
  });

  it('returns empty array for empty envs object', () => {
    expect(parseEnvListOutput('{"envs":[]}')).toEqual([]);
  });

  it('handles object without envs field', () => {
    expect(parseEnvListOutput('{}')).toEqual([]);
  });
});

describe('Vercel provider — detect', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `envguard-vercel-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects when vercel.json exists', async () => {
    writeFileSync(join(tempDir, 'vercel.json'), '{}');
    expect(await vercelProvider.detect(tempDir)).toBe(true);
  });

  it('detects when .vercel/ directory exists', async () => {
    mkdirSync(join(tempDir, '.vercel'));
    expect(await vercelProvider.detect(tempDir)).toBe(true);
  });

  it('returns false when neither exists', async () => {
    expect(await vercelProvider.detect(tempDir)).toBe(false);
  });
});

describe('Vercel provider — targets', () => {
  it('returns production, preview, and development', () => {
    expect(vercelProvider.targets()).toEqual(['production', 'preview', 'development']);
  });
});

describe('Vercel provider — checkPrerequisites', () => {
  const originalEnv = process.env;
  let originalCwd: () => string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.VERCEL_TOKEN = undefined;
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  it('returns ok when CLI is installed, authenticated, and project is linked', async () => {
    const tempDir = join(tmpdir(), `envguard-vercel-prereq-${Date.now()}`);
    mkdirSync(join(tempDir, '.vercel'), { recursive: true });
    writeFileSync(join(tempDir, '.vercel', 'project.json'), '{}');
    process.cwd = () => tempDir;

    mockedExec.mockResolvedValueOnce({
      stdout: 'Vercel CLI 33.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: 'user@example.com',
      stderr: '',
      exitCode: 0,
    });

    const result = await vercelProvider.checkPrerequisites();
    expect(result.ok).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports missing vercel CLI', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'command not found: vercel',
      exitCode: 127,
    });

    const result = await vercelProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('vercel CLI');
    expect(result.fix).toContain('npm i -g vercel');
  });

  it('reports missing authentication when not logged in and no token', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: 'Vercel CLI 33.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not authenticated',
      exitCode: 1,
    });

    const result = await vercelProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('Vercel authentication');
    expect(result.fix).toContain('vercel login');
  });

  it('skips whoami check when VERCEL_TOKEN is set', async () => {
    const tempDir = join(tmpdir(), `envguard-vercel-token-${Date.now()}`);
    mkdirSync(join(tempDir, '.vercel'), { recursive: true });
    writeFileSync(join(tempDir, '.vercel', 'project.json'), '{}');
    process.cwd = () => tempDir;
    process.env.VERCEL_TOKEN = 'test-token';

    mockedExec.mockResolvedValueOnce({
      stdout: 'Vercel CLI 33.0.0',
      stderr: '',
      exitCode: 0,
    });

    const result = await vercelProvider.checkPrerequisites();
    expect(result.ok).toBe(true);
    // whoami should NOT have been called (only --version)
    expect(mockedExec).toHaveBeenCalledTimes(1);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports missing project link', async () => {
    const tempDir = join(tmpdir(), `envguard-vercel-nolink-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.cwd = () => tempDir;

    mockedExec.mockResolvedValueOnce({
      stdout: 'Vercel CLI 33.0.0',
      stderr: '',
      exitCode: 0,
    });
    mockedExec.mockResolvedValueOnce({
      stdout: 'user@example.com',
      stderr: '',
      exitCode: 0,
    });

    const result = await vercelProvider.checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('Vercel project link');
    expect(result.fix).toContain('vercel link');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('Vercel provider — listRemoteKeys', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.VERCEL_TOKEN = undefined;
    process.env.VERCEL_TEAM_ID = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('parses JSON output for production env vars', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { key: 'API_KEY', target: ['production'] },
        { key: 'DB_URL', target: ['production'] },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const keys = await vercelProvider.listRemoteKeys('production');
    expect(keys).toEqual(['API_KEY', 'DB_URL']);

    expect(mockedExec).toHaveBeenCalledWith('vercel', ['env', 'ls', 'production', '--json']);
  });

  it('passes token and scope when env vars are set', async () => {
    process.env.VERCEL_TOKEN = 'my-token';
    process.env.VERCEL_TEAM_ID = 'team_123';

    mockedExec.mockResolvedValueOnce({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    await vercelProvider.listRemoteKeys('preview');

    expect(mockedExec).toHaveBeenCalledWith('vercel', [
      'env',
      'ls',
      'preview',
      '--json',
      '--token',
      'my-token',
      '--scope',
      'team_123',
    ]);
  });

  it('returns empty array for empty response', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    const keys = await vercelProvider.listRemoteKeys('development');
    expect(keys).toEqual([]);
  });

  it('throws on vercel failure', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not authorized',
      exitCode: 1,
    });

    await expect(vercelProvider.listRemoteKeys('production')).rejects.toThrow(
      'Failed to list Vercel production env vars',
    );
  });
});

describe('Vercel provider — pushSecrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.VERCEL_TOKEN = undefined;
    process.env.VERCEL_TEAM_ID = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('pushes secrets via stdin', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await vercelProvider.pushSecrets(
      { API_KEY: 'secret1', DB_URL: 'postgres://...' },
      'production',
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      key: 'API_KEY',
      provider: 'vercel',
      target: 'production',
      status: 'ok',
      error: undefined,
    });
    expect(results[1]).toEqual({
      key: 'DB_URL',
      provider: 'vercel',
      target: 'production',
      status: 'ok',
      error: undefined,
    });

    // Verify stdin was passed
    expect(mockedExec).toHaveBeenCalledWith(
      'vercel',
      ['env', 'add', 'API_KEY', 'production', '--force'],
      { stdin: 'secret1' },
    );
    expect(mockedExec).toHaveBeenCalledWith(
      'vercel',
      ['env', 'add', 'DB_URL', 'production', '--force'],
      { stdin: 'postgres://...' },
    );
  });

  it('passes token and scope when env vars are set', async () => {
    process.env.VERCEL_TOKEN = 'my-token';
    process.env.VERCEL_TEAM_ID = 'team_123';

    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await vercelProvider.pushSecrets({ MY_KEY: 'val' }, 'preview');

    expect(mockedExec).toHaveBeenCalledWith(
      'vercel',
      ['env', 'add', 'MY_KEY', 'preview', '--force', '--token', 'my-token', '--scope', 'team_123'],
      { stdin: 'val' },
    );
  });

  it('reports failed push', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
    });

    const results = await vercelProvider.pushSecrets({ API_KEY: 'val' }, 'production');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('permission denied');
  });

  it('pushes to different targets', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const prodResults = await vercelProvider.pushSecrets({ KEY: 'val' }, 'production');
    expect(prodResults[0].target).toBe('production');

    const devResults = await vercelProvider.pushSecrets({ KEY: 'val' }, 'development');
    expect(devResults[0].target).toBe('development');
  });
});

describe('Vercel provider — deleteSecrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.VERCEL_TOKEN = undefined;
    process.env.VERCEL_TEAM_ID = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('deletes secrets successfully', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await vercelProvider.deleteSecrets(['API_KEY', 'DB_URL'], 'production');
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ok');

    expect(mockedExec).toHaveBeenCalledWith('vercel', [
      'env',
      'rm',
      'API_KEY',
      'production',
      '--yes',
    ]);
    expect(mockedExec).toHaveBeenCalledWith('vercel', [
      'env',
      'rm',
      'DB_URL',
      'production',
      '--yes',
    ]);
  });

  it('passes token and scope when env vars are set', async () => {
    process.env.VERCEL_TOKEN = 'my-token';
    process.env.VERCEL_TEAM_ID = 'team_123';

    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await vercelProvider.deleteSecrets(['MY_KEY'], 'preview');

    expect(mockedExec).toHaveBeenCalledWith('vercel', [
      'env',
      'rm',
      'MY_KEY',
      'preview',
      '--yes',
      '--token',
      'my-token',
      '--scope',
      'team_123',
    ]);
  });

  it('reports failed deletion', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'env var not found',
      exitCode: 1,
    });

    const results = await vercelProvider.deleteSecrets(['MISSING_KEY'], 'production');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('env var not found');
  });
});

describe('Vercel provider — environment mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supports pushing to a specific mapped target', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    // Simulate caller using envMapping to push only to production
    const results = await vercelProvider.pushSecrets({ PROD_SECRET: 'val' }, 'production');
    expect(results[0].target).toBe('production');
    expect(results[0].status).toBe('ok');
  });

  it('supports listing keys for a specific mapped target', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([{ key: 'PROD_ONLY', target: ['production'] }]),
      stderr: '',
      exitCode: 0,
    });

    const keys = await vercelProvider.listRemoteKeys('production');
    expect(keys).toEqual(['PROD_ONLY']);
  });
});
