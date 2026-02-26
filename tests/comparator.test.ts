import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareSecrets, runCheck } from '../src/core/comparator.js';
import type { MissingSecret, Provider, RemoteKeyInfo, SecretEntry } from '../src/types.js';

// Mock the provider registry so runCheck tests don't hit real CLIs
vi.mock('../src/providers/registry.js');
import { getProvider } from '../src/providers/registry.js';

// ── compareSecrets (pure function) ────────────────────────────────────────

describe('compareSecrets', () => {
  it('returns empty array when all secrets are synced', () => {
    const local: SecretEntry[] = [
      { key: 'API_KEY', value: 'abc', source: '.env' },
      { key: 'DB_URL', value: 'pg://...', source: '.env' },
    ];
    const remote: RemoteKeyInfo[] = [
      { provider: 'github', target: 'actions', keys: ['API_KEY', 'DB_URL'] },
      { provider: 'vercel', target: 'production', keys: ['API_KEY', 'DB_URL'] },
    ];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(0);
  });

  it('detects secrets missing on one provider', () => {
    const local: SecretEntry[] = [
      { key: 'API_KEY', value: 'abc', source: '.env' },
      { key: 'DB_URL', value: 'pg://...', source: '.env' },
    ];
    const remote: RemoteKeyInfo[] = [
      { provider: 'github', target: 'actions', keys: ['API_KEY', 'DB_URL'] },
      { provider: 'vercel', target: 'production', keys: ['API_KEY'] },
    ];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('DB_URL');
    expect(result[0].missingFrom).toEqual([{ provider: 'vercel', target: 'production' }]);
  });

  it('detects secrets missing on multiple providers', () => {
    const local: SecretEntry[] = [{ key: 'STRIPE_KEY', value: 'sk_...', source: '.env.local' }];
    const remote: RemoteKeyInfo[] = [
      { provider: 'github', target: 'actions', keys: [] },
      { provider: 'vercel', target: 'production', keys: [] },
    ];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('STRIPE_KEY');
    expect(result[0].missingFrom).toHaveLength(2);
    expect(result[0].missingFrom).toContainEqual({ provider: 'github', target: 'actions' });
    expect(result[0].missingFrom).toContainEqual({ provider: 'vercel', target: 'production' });
  });

  it('detects key missing on some targets but not others', () => {
    const local: SecretEntry[] = [{ key: 'DB_URL', value: 'pg://...', source: '.env' }];
    const remote: RemoteKeyInfo[] = [
      { provider: 'vercel', target: 'production', keys: [] },
      { provider: 'vercel', target: 'preview', keys: ['DB_URL'] },
      { provider: 'vercel', target: 'development', keys: ['DB_URL'] },
    ];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].missingFrom).toEqual([{ provider: 'vercel', target: 'production' }]);
  });

  it('de-duplicates local keys (uses first occurrence)', () => {
    const local: SecretEntry[] = [
      { key: 'API_KEY', value: 'from-env', source: '.env' },
      { key: 'API_KEY', value: 'from-local', source: '.env.local' },
    ];
    const remote: RemoteKeyInfo[] = [{ provider: 'github', target: 'actions', keys: [] }];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('.env');
  });

  it('returns empty array when there are no local secrets', () => {
    const remote: RemoteKeyInfo[] = [
      { provider: 'github', target: 'actions', keys: ['EXTRA_KEY'] },
    ];

    const result = compareSecrets([], remote);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when there are no remote keys', () => {
    const result = compareSecrets([], []);
    expect(result).toHaveLength(0);
  });

  it('reports all locals as missing when remote has no matching keys', () => {
    const local: SecretEntry[] = [
      { key: 'A', value: '1', source: '.env' },
      { key: 'B', value: '2', source: '.env' },
    ];
    const remote: RemoteKeyInfo[] = [{ provider: 'github', target: 'actions', keys: ['C', 'D'] }];

    const result = compareSecrets(local, remote);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.key)).toEqual(['A', 'B']);
  });
});

// ── runCheck (integration with mocked providers) ──────────────────────────

describe('runCheck', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `envguard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), '{}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeMockProvider(overrides?: Partial<Provider>): Provider {
    return {
      name: 'github',
      displayName: 'GitHub',
      detect: vi.fn().mockResolvedValue(true),
      targets: vi.fn().mockReturnValue(['actions']),
      checkPrerequisites: vi.fn().mockResolvedValue({ ok: true }),
      listRemoteKeys: vi.fn().mockResolvedValue([]),
      pushSecrets: vi.fn().mockResolvedValue([]),
      deleteSecrets: vi.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('returns allSynced true when all secrets exist remotely', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\nDB_URL=pg://...\n');
    mkdirSync(join(tmpDir, '.github'));

    const mockProvider = makeMockProvider({
      listRemoteKeys: vi.fn().mockResolvedValue(['API_KEY', 'DB_URL']),
    });
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const result = await runCheck(tmpDir, null);

    expect(result.allSynced).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.localSecrets).toHaveLength(2);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].available).toBe(true);
  });

  it('returns missing secrets when keys are not on remote', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\nDB_URL=pg://...\nSTRIPE_KEY=sk_...\n');
    mkdirSync(join(tmpDir, '.github'));

    const mockProvider = makeMockProvider({
      listRemoteKeys: vi.fn().mockResolvedValue(['API_KEY']),
    });
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const result = await runCheck(tmpDir, null);

    expect(result.allSynced).toBe(false);
    expect(result.missing).toHaveLength(2);
    expect(result.missing.map((m) => m.key).sort()).toEqual(['DB_URL', 'STRIPE_KEY']);
  });

  it('handles provider prerequisite failure', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\n');
    mkdirSync(join(tmpDir, '.github'));

    const mockProvider = makeMockProvider({
      checkPrerequisites: vi.fn().mockResolvedValue({
        ok: false,
        missing: 'gh CLI',
        fix: 'brew install gh',
      }),
    });
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const result = await runCheck(tmpDir, null);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].available).toBe(false);
    expect(result.providers[0].error).toBe('gh CLI');
    expect(result.remoteKeys).toHaveLength(0);
    expect(result.allSynced).toBe(true);
  });

  it('handles no detected providers', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\n');
    // No .github, vercel.json, or netlify.toml

    const result = await runCheck(tmpDir, null);

    expect(result.providers).toHaveLength(0);
    expect(result.allSynced).toBe(true);
  });

  it('respects config ignore list', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\nNODE_ENV=production\n');
    mkdirSync(join(tmpDir, '.github'));

    const mockProvider = makeMockProvider({
      listRemoteKeys: vi.fn().mockResolvedValue(['API_KEY']),
    });
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const result = await runCheck(tmpDir, { ignore: ['NODE_ENV'] });

    expect(result.localSecrets).toHaveLength(1);
    expect(result.localSecrets[0].key).toBe('API_KEY');
    expect(result.allSynced).toBe(true);
  });

  it('handles listRemoteKeys failure gracefully', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\n');
    mkdirSync(join(tmpDir, '.github'));

    const mockProvider = makeMockProvider({
      listRemoteKeys: vi.fn().mockRejectedValue(new Error('network error')),
    });
    vi.mocked(getProvider).mockReturnValue(mockProvider);

    const result = await runCheck(tmpDir, null);

    // Provider is available (prereqs pass), but listing failed
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].available).toBe(true);
    // No remote keys were collected
    expect(result.remoteKeys).toHaveLength(0);
    expect(result.allSynced).toBe(true);
  });

  it('handles multiple providers with mixed availability', async () => {
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=abc\n');
    mkdirSync(join(tmpDir, '.github'));
    writeFileSync(join(tmpDir, 'vercel.json'), '{}');

    const githubMock = makeMockProvider({
      name: 'github',
      displayName: 'GitHub',
      listRemoteKeys: vi.fn().mockResolvedValue(['API_KEY']),
    });
    const vercelMock = makeMockProvider({
      name: 'vercel',
      displayName: 'Vercel',
      targets: vi.fn().mockReturnValue(['production', 'preview', 'development']),
      checkPrerequisites: vi.fn().mockResolvedValue({
        ok: false,
        missing: 'vercel CLI',
        fix: 'npm i -g vercel',
      }),
    });

    vi.mocked(getProvider).mockImplementation((name) => {
      if (name === 'github') return githubMock;
      if (name === 'vercel') return vercelMock;
      throw new Error(`Unknown: ${name}`);
    });

    const result = await runCheck(tmpDir, null);

    expect(result.providers).toHaveLength(2);
    expect(result.providers[0].available).toBe(true);
    expect(result.providers[1].available).toBe(false);
    expect(result.allSynced).toBe(true);
  });
});
