import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCommand } from '../src/commands/check.js';
import type { CheckResult, CliContext } from '../src/types.js';

// Mock the comparator module
vi.mock('../src/core/comparator.js');
vi.mock('../src/utils/config.js');
vi.mock('../src/commands/hook.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/commands/hook.js')>();
  return {
    ...original,
    findGitRoot: vi.fn(),
    isHookInstalled: vi.fn(),
  };
});

import { findGitRoot, isHookInstalled } from '../src/commands/hook.js';
import { runCheck } from '../src/core/comparator.js';
import { getProjectRoot, loadConfig } from '../src/utils/config.js';

function makeCtx(
  overrides?: Partial<CliContext>,
): CliContext & { output: string; errOutput: string; exitCode: number | null } {
  let output = '';
  let errOutput = '';
  let exitCode: number | null = null;

  const stdout = new PassThrough();
  stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof stdout.write;

  const stderr = new PassThrough();
  stderr.write = ((chunk: string) => {
    errOutput += chunk;
    return true;
  }) as typeof stderr.write;

  const ctx = {
    argv: [],
    env: { NO_COLOR: '1' },
    stdout,
    stderr,
    exit: (code: number) => {
      exitCode = code;
    },
    cwd: () => '/fake/project',
    get output() {
      return output;
    },
    get errOutput() {
      return errOutput;
    },
    get exitCode() {
      return exitCode;
    },
    ...overrides,
  };

  return ctx as CliContext & { output: string; errOutput: string; exitCode: number | null };
}

const allSyncedResult: CheckResult = {
  localSecrets: [
    { key: 'API_KEY', value: 'abc', source: '.env.local' },
    { key: 'DB_URL', value: 'pg://...', source: '.env.local' },
  ],
  remoteKeys: [
    { provider: 'github', target: 'actions', keys: ['API_KEY', 'DB_URL'] },
    { provider: 'github', target: 'codespaces', keys: ['API_KEY', 'DB_URL'] },
    { provider: 'vercel', target: 'production', keys: ['API_KEY', 'DB_URL'] },
  ],
  providers: [
    { provider: 'github', displayName: 'GitHub', available: true },
    { provider: 'vercel', displayName: 'Vercel', available: true },
  ],
  missing: [],
  duplicateKeys: [],
  allSynced: true,
};

const missingResult: CheckResult = {
  localSecrets: [
    { key: 'API_KEY', value: 'abc', source: '.env.local' },
    { key: 'STRIPE_KEY', value: 'sk_...', source: '.env.local' },
    { key: 'DB_URL', value: 'pg://...', source: '.env.local' },
  ],
  remoteKeys: [
    { provider: 'github', target: 'actions', keys: ['API_KEY'] },
    { provider: 'vercel', target: 'production', keys: ['API_KEY', 'STRIPE_KEY'] },
  ],
  providers: [
    { provider: 'github', displayName: 'GitHub', available: true },
    { provider: 'vercel', displayName: 'Vercel', available: true },
  ],
  missing: [
    {
      key: 'STRIPE_KEY',
      source: '.env.local',
      missingFrom: [{ provider: 'github', target: 'actions' }],
    },
    {
      key: 'DB_URL',
      source: '.env.local',
      missingFrom: [
        { provider: 'github', target: 'actions' },
        { provider: 'vercel', target: 'production' },
      ],
    },
  ],
  duplicateKeys: [],
  allSynced: false,
};

const noProvidersResult: CheckResult = {
  localSecrets: [{ key: 'API_KEY', value: 'abc', source: '.env' }],
  remoteKeys: [],
  providers: [],
  missing: [],
  duplicateKeys: [],
  allSynced: true,
};

const allProvidersFailedResult: CheckResult = {
  localSecrets: [{ key: 'API_KEY', value: 'abc', source: '.env' }],
  remoteKeys: [],
  providers: [
    {
      provider: 'github',
      displayName: 'GitHub',
      available: false,
      error: 'gh CLI',
      fix: 'brew install gh',
    },
  ],
  missing: [],
  duplicateKeys: [],
  allSynced: true,
};

const noSecretsResult: CheckResult = {
  localSecrets: [],
  remoteKeys: [],
  providers: [{ provider: 'github', displayName: 'GitHub', available: true }],
  missing: [],
  duplicateKeys: [],
  allSynced: true,
};

const duplicateKeysResult: CheckResult = {
  ...allSyncedResult,
  duplicateKeys: [{ key: 'API_KEY', sources: ['.env', '.env.local'] }],
};

describe('checkCommand', () => {
  beforeEach(() => {
    vi.mocked(getProjectRoot).mockReturnValue('/fake/project');
    vi.mocked(loadConfig).mockReturnValue(null);
    vi.mocked(findGitRoot).mockReturnValue(null);
    vi.mocked(isHookInstalled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Text output ───────────────────────────────────────────────────────

  describe('text output', () => {
    it('shows success message when all synced', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).toContain('envguard');
      expect(ctx.output).toContain('checking secrets');
      expect(ctx.output).toContain('2 secrets from .env.local');
      expect(ctx.output).toContain('Providers:');
      expect(ctx.output).toContain('GitHub Actions');
      expect(ctx.output).toContain('GitHub Codespaces');
      expect(ctx.output).toContain('Vercel');
      expect(ctx.output).toContain('All 2 secrets exist on all providers.');
      expect(ctx.exitCode).toBeNull();
    });

    it('shows missing secrets report', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).toContain('3 secrets from .env.local');
      expect(ctx.output).toContain('2 secrets missing from remote');
      expect(ctx.output).toContain('STRIPE_KEY');
      expect(ctx.output).toContain('GitHub Actions');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('Vercel (production)');
      expect(ctx.output).toContain('envguard push');
      expect(ctx.exitCode).toBe(1);
    });

    it('shows provider warnings for unavailable providers', async () => {
      const result: CheckResult = {
        ...allSyncedResult,
        providers: [
          { provider: 'github', displayName: 'GitHub', available: true },
          {
            provider: 'vercel',
            displayName: 'Vercel',
            available: false,
            error: 'vercel CLI',
          },
        ],
      };
      vi.mocked(runCheck).mockResolvedValue(result);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).toContain('Vercel: vercel CLI');
    });
  });

  // ── JSON output ───────────────────────────────────────────────────────

  describe('JSON output', () => {
    it('outputs valid JSON when all synced', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.allSynced).toBe(true);
      expect(parsed.missing).toHaveLength(0);
      expect(parsed.localSecrets).toHaveLength(2);
      expect(parsed.remoteKeys).toHaveLength(3);
      expect(parsed.providers).toHaveLength(2);
      expect(ctx.exitCode).toBeNull();
    });

    it('outputs valid JSON with exit code 1 when missing', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.allSynced).toBe(false);
      expect(parsed.missing).toHaveLength(2);
      expect(ctx.exitCode).toBe(1);
    });
  });

  // ── Exit codes ────────────────────────────────────────────────────────

  describe('exit codes', () => {
    it('exits 0 when all synced', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.exitCode).toBeNull(); // 0 is implicit (no exit call)
    });

    it('exits 1 when secrets are missing', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.exitCode).toBe(1);
    });

    it('exits 2 when no providers detected', async () => {
      vi.mocked(runCheck).mockResolvedValue(noProvidersResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.exitCode).toBe(2);
    });

    it('exits 2 when all providers fail prerequisites', async () => {
      vi.mocked(runCheck).mockResolvedValue(allProvidersFailedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.exitCode).toBe(2);
    });
  });

  // ── Quiet mode ────────────────────────────────────────────────────────

  describe('quiet mode', () => {
    it('suppresses output when all synced', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { quiet: true });

      expect(ctx.output).toBe('');
      expect(ctx.exitCode).toBeNull();
    });

    it('shows output when secrets are missing', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { quiet: true });

      expect(ctx.output).toContain('missing from remote');
      expect(ctx.exitCode).toBe(1);
    });
  });

  // ── Verbose mode ──────────────────────────────────────────────────────

  describe('verbose mode', () => {
    it('shows per-file key counts', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('.env.local: 2 keys');
    });

    it('shows provider prerequisite status', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('GitHub prerequisites: ok');
      expect(ctx.output).toContain('Vercel prerequisites: ok');
    });

    it('shows per-target remote key counts', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('GitHub Actions: 2 remote keys');
      expect(ctx.output).toContain('Vercel (production): 2 remote keys');
    });

    it('shows timing information', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toMatch(/Completed in \d+ms/);
    });

    it('shows failed prerequisite status', async () => {
      const result: CheckResult = {
        ...missingResult,
        providers: [
          { provider: 'github', displayName: 'GitHub', available: true },
          {
            provider: 'vercel',
            displayName: 'Vercel',
            available: false,
            error: 'vercel CLI',
            fix: 'npm i -g vercel',
          },
        ],
      };
      vi.mocked(runCheck).mockResolvedValue(result);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('GitHub prerequisites: ok');
      expect(ctx.output).toContain('Vercel prerequisites: failed');
    });

    it('shows hook status as installed in verbose mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      vi.mocked(findGitRoot).mockReturnValue('/fake/project');
      vi.mocked(isHookInstalled).mockReturnValue(true);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('Pre-push hook: installed');
    });

    it('shows hook status as not installed in verbose mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      vi.mocked(findGitRoot).mockReturnValue('/fake/project');
      vi.mocked(isHookInstalled).mockReturnValue(false);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('Pre-push hook: not installed');
    });
  });

  // ── Hook suggestion ──────────────────────────────────────────────────

  describe('hook suggestion', () => {
    it('suggests hook install when secrets missing and no hook', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      vi.mocked(findGitRoot).mockReturnValue('/fake/project');
      vi.mocked(isHookInstalled).mockReturnValue(false);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).toContain('envguard hook install');
    });

    it('does not suggest hook install when hook is already installed', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      vi.mocked(findGitRoot).mockReturnValue('/fake/project');
      vi.mocked(isHookInstalled).mockReturnValue(true);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).not.toContain('envguard hook install');
    });

    it('does not suggest hook install when not in a git repo', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      vi.mocked(findGitRoot).mockReturnValue(null);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).not.toContain('envguard hook install');
    });
  });

  // ── No secrets ────────────────────────────────────────────────────────

  describe('no secrets', () => {
    it('shows warning when no secrets found', async () => {
      vi.mocked(runCheck).mockResolvedValue(noSecretsResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.errOutput).toContain('No secrets found');
      expect(ctx.errOutput).toContain('.env');
      expect(ctx.exitCode).toBeNull();
    });

    it('returns JSON when no secrets found with --json', async () => {
      vi.mocked(runCheck).mockResolvedValue(noSecretsResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.localSecrets).toHaveLength(0);
      expect(ctx.exitCode).toBeNull();
    });
  });

  // ── Duplicate keys ───────────────────────────────────────────────────

  describe('duplicate keys', () => {
    it('shows duplicate key warnings in verbose mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(duplicateKeysResult);
      const ctx = makeCtx();

      await checkCommand(ctx, { verbose: true });

      expect(ctx.output).toContain('API_KEY defined in multiple files');
      expect(ctx.output).toContain('.env');
      expect(ctx.output).toContain('.env.local');
    });

    it('does not show duplicate key warnings in normal mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(duplicateKeysResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.output).not.toContain('defined in multiple files');
    });
  });

  // ── Error message detail ──────────────────────────────────────────────

  describe('error message detail', () => {
    it('shows actionable message for no providers detected', async () => {
      vi.mocked(runCheck).mockResolvedValue(noProvidersResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.errOutput).toContain('No providers detected');
      expect(ctx.errOutput).toContain('.envguard.json');
      expect(ctx.errOutput).toContain('envguard config init');
      expect(ctx.exitCode).toBe(2);
    });

    it('shows fix hints for failed provider prerequisites', async () => {
      vi.mocked(runCheck).mockResolvedValue(allProvidersFailedResult);
      const ctx = makeCtx();

      await checkCommand(ctx, {});

      expect(ctx.errOutput).toContain('prerequisite checks');
      expect(ctx.errOutput).toContain('gh CLI');
      expect(ctx.errOutput).toContain('brew install gh');
      expect(ctx.exitCode).toBe(2);
    });
  });
});
