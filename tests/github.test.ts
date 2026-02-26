import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetGitHubProvider,
  githubProvider,
  validateSecretName,
} from '../src/providers/github.js';

// Mock execCommand and getRepoSlug so we don't shell out to real `gh`
vi.mock('../src/utils/exec.js', () => ({
  execCommand: vi.fn(),
}));

vi.mock('../src/utils/git.js', () => ({
  getRepoSlug: vi.fn(),
}));

import { execCommand } from '../src/utils/exec.js';
import { getRepoSlug } from '../src/utils/git.js';

const mockedExec = vi.mocked(execCommand);
const mockedRepoSlug = vi.mocked(getRepoSlug);

// Create a fresh provider instance for each test to clear cached repoSlug
function freshProvider() {
  // The github.ts exports a singleton, but the repoSlug is cached.
  // We mock getRepoSlug to control it, so the cache is fine per test.
  return githubProvider;
}

describe('validateSecretName', () => {
  it('accepts valid secret names', () => {
    expect(validateSecretName('MY_SECRET')).toBeNull();
    expect(validateSecretName('API_KEY_123')).toBeNull();
    expect(validateSecretName('a')).toBeNull();
    expect(validateSecretName('_PRIVATE')).toBeNull();
  });

  it('rejects names starting with a number', () => {
    expect(validateSecretName('123_KEY')).toContain('must contain only');
  });

  it('rejects names with invalid characters', () => {
    expect(validateSecretName('MY-KEY')).toContain('must contain only');
    expect(validateSecretName('MY KEY')).toContain('must contain only');
    expect(validateSecretName('key.name')).toContain('must contain only');
  });

  it('rejects names starting with GITHUB_ prefix', () => {
    expect(validateSecretName('GITHUB_TOKEN')).toContain('cannot start with GITHUB_');
  });

  it('allows names containing GITHUB but not as prefix', () => {
    expect(validateSecretName('MY_GITHUB_TOKEN')).toBeNull();
  });
});

describe('GitHub provider — detect', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `envguard-gh-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects when .github/ exists', async () => {
    mkdirSync(join(tempDir, '.github'));
    expect(await freshProvider().detect(tempDir)).toBe(true);
  });

  it('returns false when .github/ is absent', async () => {
    expect(await freshProvider().detect(tempDir)).toBe(false);
  });
});

describe('GitHub provider — targets', () => {
  it('returns actions and codespaces', () => {
    expect(freshProvider().targets()).toEqual(['actions', 'codespaces']);
  });
});

describe('GitHub provider — checkPrerequisites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when gh is installed and authenticated', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'gh version 2.x', stderr: '', exitCode: 0 });
    mockedExec.mockResolvedValueOnce({ stdout: 'Logged in', stderr: '', exitCode: 0 });

    const result = await freshProvider().checkPrerequisites();
    expect(result.ok).toBe(true);
  });

  it('reports missing gh CLI', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'command not found: gh',
      exitCode: 127,
    });

    const result = await freshProvider().checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('gh CLI');
    expect(result.fix).toContain('cli.github.com');
  });

  it('reports missing authentication', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'gh version 2.x', stderr: '', exitCode: 0 });
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not logged in',
      exitCode: 1,
    });

    const result = await freshProvider().checkPrerequisites();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('GitHub authentication');
    expect(result.fix).toContain('gh auth login');
  });
});

describe('GitHub provider — listRemoteKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepoSlug.mockResolvedValue('owner/repo');
  });

  it('parses JSON output for actions secrets', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([{ name: 'API_KEY' }, { name: 'DB_URL' }]),
      stderr: '',
      exitCode: 0,
    });

    const keys = await freshProvider().listRemoteKeys('actions');
    expect(keys).toEqual(['API_KEY', 'DB_URL']);

    // Verify correct args
    expect(mockedExec).toHaveBeenCalledWith('gh', [
      'secret',
      'list',
      '--repo',
      'owner/repo',
      '--json',
      'name',
    ]);
  });

  it('passes --app codespaces flag for codespaces target', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: JSON.stringify([{ name: 'CS_KEY' }]),
      stderr: '',
      exitCode: 0,
    });

    const keys = await freshProvider().listRemoteKeys('codespaces');
    expect(keys).toEqual(['CS_KEY']);

    expect(mockedExec).toHaveBeenCalledWith('gh', [
      'secret',
      'list',
      '--repo',
      'owner/repo',
      '--json',
      'name',
      '--app',
      'codespaces',
    ]);
  });

  it('returns empty array for empty response', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '[]',
      stderr: '',
      exitCode: 0,
    });

    const keys = await freshProvider().listRemoteKeys('actions');
    expect(keys).toEqual([]);
  });

  it('throws on gh failure', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'not authorized',
      exitCode: 1,
    });

    await expect(freshProvider().listRemoteKeys('actions')).rejects.toThrow(
      'Failed to list actions secrets',
    );
  });
});

describe('GitHub provider — pushSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepoSlug.mockResolvedValue('owner/repo');
  });

  it('pushes secrets successfully', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await freshProvider().pushSecrets(
      { API_KEY: 'secret1', DB_URL: 'postgres://...' },
      'actions',
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      key: 'API_KEY',
      provider: 'github',
      target: 'actions',
      status: 'ok',
      error: undefined,
    });
    expect(results[1]).toEqual({
      key: 'DB_URL',
      provider: 'github',
      target: 'actions',
      status: 'ok',
      error: undefined,
    });
  });

  it('reports failed push', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
    });

    const results = await freshProvider().pushSecrets({ API_KEY: 'val' }, 'actions');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('permission denied');
  });

  it('rejects invalid secret names without calling gh', async () => {
    const results = await freshProvider().pushSecrets({ GITHUB_TOKEN: 'val' }, 'actions');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('cannot start with GITHUB_');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('passes --app codespaces for codespaces target', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await freshProvider().pushSecrets({ MY_KEY: 'val' }, 'codespaces');

    expect(mockedExec).toHaveBeenCalledWith('gh', [
      'secret',
      'set',
      'MY_KEY',
      '--body',
      'val',
      '--repo',
      'owner/repo',
      '--app',
      'codespaces',
    ]);
  });
});

describe('GitHub provider — deleteSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepoSlug.mockResolvedValue('owner/repo');
  });

  it('deletes secrets successfully', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const results = await freshProvider().deleteSecrets(['API_KEY', 'DB_URL'], 'actions');
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ok');
  });

  it('reports failed deletion', async () => {
    mockedExec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'secret not found',
      exitCode: 1,
    });

    const results = await freshProvider().deleteSecrets(['MISSING_KEY'], 'actions');
    expect(results[0].status).toBe('error');
    expect(results[0].error).toBe('secret not found');
  });

  it('passes --app codespaces for codespaces target', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await freshProvider().deleteSecrets(['MY_KEY'], 'codespaces');

    expect(mockedExec).toHaveBeenCalledWith('gh', [
      'secret',
      'delete',
      'MY_KEY',
      '--repo',
      'owner/repo',
      '--app',
      'codespaces',
    ]);
  });
});

describe('GitHub provider — repo detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGitHubProvider();
  });

  it('throws when repo cannot be determined', async () => {
    mockedRepoSlug.mockResolvedValue(null);

    await expect(freshProvider().listRemoteKeys('actions')).rejects.toThrow(
      'Could not determine GitHub repository',
    );
  });
});
