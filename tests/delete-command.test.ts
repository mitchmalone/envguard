import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteCommand } from '../src/commands/delete.js';
import type { CheckResult, CliContext, Provider, ProviderName } from '../src/types.js';

// Mock the comparator, config, and registry modules
vi.mock('../src/core/comparator.js');
vi.mock('../src/utils/config.js');
vi.mock('../src/providers/registry.js');

import { runCheck } from '../src/core/comparator.js';
import { getProvider } from '../src/providers/registry.js';
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

  return ctx as CliContext & {
    output: string;
    errOutput: string;
    exitCode: number | null;
  };
}

const baseCheckResult: CheckResult = {
  localSecrets: [
    { key: 'API_KEY', value: 'abc123', source: '.env.local' },
    { key: 'DB_URL', value: 'pg://localhost/db', source: '.env.local' },
    { key: 'STRIPE_KEY', value: 'sk_live_test', source: '.env.local' },
  ],
  remoteKeys: [
    {
      provider: 'github',
      target: 'actions',
      keys: ['API_KEY', 'DB_URL', 'STRIPE_KEY'],
    },
  ],
  providers: [{ provider: 'github', displayName: 'GitHub', available: true }],
  missing: [],
  duplicateKeys: [],
  allSynced: true,
};

function makeMockProvider(name: ProviderName): Provider {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    detect: vi.fn().mockResolvedValue(true),
    targets: vi.fn().mockReturnValue(['actions', 'codespaces']),
    listRemoteKeys: vi.fn().mockResolvedValue([]),
    pushSecrets: vi.fn().mockResolvedValue([]),
    deleteSecrets: vi.fn().mockImplementation(async (keys: string[], target: string) => {
      return keys.map((key) => ({
        key,
        provider: name,
        target,
        status: 'ok' as const,
      }));
    }),
    checkPrerequisites: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('deleteCommand', () => {
  beforeEach(() => {
    vi.mocked(getProjectRoot).mockReturnValue('/fake/project');
    vi.mocked(loadConfig).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── No providers ─────────────────────────────────────────────────────

  describe('no providers', () => {
    it('exits 2 when no providers detected', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...baseCheckResult,
        providers: [],
      });
      const ctx = makeCtx();

      await deleteCommand(ctx, { provider: 'github', target: 'actions', keys: 'FOO', yes: true });

      expect(ctx.errOutput).toContain('No providers detected');
      expect(ctx.exitCode).toBe(2);
    });

    it('exits 2 when all providers fail prerequisites', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...baseCheckResult,
        providers: [
          {
            provider: 'github',
            displayName: 'GitHub',
            available: false,
            error: 'gh CLI not found',
            fix: 'brew install gh',
          },
        ],
      });
      const ctx = makeCtx();

      await deleteCommand(ctx, { provider: 'github', target: 'actions', keys: 'FOO', yes: true });

      expect(ctx.errOutput).toContain('prerequisite checks');
      expect(ctx.errOutput).toContain('gh CLI not found');
      expect(ctx.exitCode).toBe(2);
    });
  });

  // ── Non-interactive validation ───────────────────────────────────────

  describe('non-interactive validation', () => {
    it('errors when --provider is missing', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const ctx = makeCtx();

      await deleteCommand(ctx, { target: 'actions', keys: 'FOO', yes: true });

      expect(ctx.errOutput).toContain('--provider is required');
      expect(ctx.exitCode).toBe(1);
    });

    it('errors when --target is missing', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const ctx = makeCtx();

      await deleteCommand(ctx, { provider: 'github', keys: 'FOO', yes: true });

      expect(ctx.errOutput).toContain('--target is required');
      expect(ctx.exitCode).toBe(1);
    });

    it('errors when neither --keys nor --all is specified', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, { provider: 'github', target: 'actions', yes: true });

      expect(ctx.errOutput).toContain('--keys or --all');
      expect(ctx.exitCode).toBe(1);
    });

    it('errors when provider is not available', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      vi.mocked(getProvider).mockImplementation(() => {
        throw new Error('not found');
      });
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'badprovider',
        target: 'actions',
        keys: 'FOO',
        yes: true,
      });

      expect(ctx.errOutput).toContain('not available');
      expect(ctx.exitCode).toBe(1);
    });

    it('errors when target is invalid', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'badtarget',
        keys: 'FOO',
        yes: true,
      });

      expect(ctx.errOutput).toContain('Invalid target');
      expect(ctx.errOutput).toContain('actions, codespaces');
      expect(ctx.exitCode).toBe(1);
    });
  });

  // ── Refuses without --yes ────────────────────────────────────────────

  describe('refuses without --yes', () => {
    it('errors when --yes is not specified', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY',
      });

      expect(ctx.errOutput).toContain('irreversible');
      expect(ctx.errOutput).toContain('--yes');
      expect(ctx.exitCode).toBe(1);
    });
  });

  // ── Dry run ──────────────────────────────────────────────────────────

  describe('--dry-run', () => {
    it('shows what would be deleted', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY,DB_URL',
        dryRun: true,
      });

      expect(ctx.output).toContain('Dry run');
      expect(ctx.output).toContain('API_KEY');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('GitHub Actions');
      expect(ctx.output).toContain('2 secrets would be deleted');
      expect(ctx.exitCode).toBeNull();
    });

    it('outputs JSON in dry-run mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY,DB_URL',
        dryRun: true,
        json: true,
      });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].key).toBe('API_KEY');
      expect(ctx.exitCode).toBeNull();
    });

    it('does not require --yes for dry-run', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY',
        dryRun: true,
      });

      expect(ctx.exitCode).toBeNull();
      expect(ctx.output).toContain('Dry run');
    });
  });

  // ── Delete with --yes ────────────────────────────────────────────────

  describe('--yes (force delete)', () => {
    it('deletes specified keys', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY,DB_URL',
        yes: true,
      });

      expect(mockGithub.deleteSecrets).toHaveBeenCalledWith(['API_KEY', 'DB_URL'], 'actions');
      expect(ctx.output).toContain('API_KEY');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('2 secrets deleted');
      expect(ctx.exitCode).toBeNull();
    });

    it('reports errors and exits 1 on delete failure', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      (mockGithub.deleteSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          key: 'API_KEY',
          provider: 'github',
          target: 'actions',
          status: 'error',
          error: 'permission denied',
        },
      ]);
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY',
        yes: true,
      });

      expect(ctx.output).toContain('1 deletion failed');
      expect(ctx.exitCode).toBe(1);
    });

    it('outputs JSON results with --json', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY,DB_URL',
        yes: true,
        json: true,
      });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.deleted).toHaveLength(2);
      expect(parsed.ok).toBe(2);
      expect(parsed.errors).toBe(0);
    });

    it('suppresses output in quiet mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: 'API_KEY',
        yes: true,
        quiet: true,
      });

      expect(ctx.output).toBe('');
      expect(ctx.exitCode).toBeNull();
    });
  });

  // ── --all flag ───────────────────────────────────────────────────────

  describe('--all', () => {
    it('deletes all local keys that exist remotely', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        all: true,
        yes: true,
      });

      // All 3 local keys exist remotely
      expect(mockGithub.deleteSecrets).toHaveBeenCalledWith(
        ['API_KEY', 'DB_URL', 'STRIPE_KEY'],
        'actions',
      );
      expect(ctx.output).toContain('3 secrets deleted');
    });

    it('only deletes keys that exist both locally and remotely', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...baseCheckResult,
        remoteKeys: [
          {
            provider: 'github',
            target: 'actions',
            keys: ['API_KEY'], // only API_KEY exists remotely
          },
        ],
      });
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        all: true,
        yes: true,
      });

      expect(mockGithub.deleteSecrets).toHaveBeenCalledWith(['API_KEY'], 'actions');
    });

    it('shows no secrets to delete when no overlap', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...baseCheckResult,
        remoteKeys: [
          {
            provider: 'github',
            target: 'actions',
            keys: ['UNKNOWN_KEY'], // no overlap with local keys
          },
        ],
      });
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        all: true,
        yes: true,
      });

      expect(ctx.output).toContain('No secrets to delete');
      expect(mockGithub.deleteSecrets).not.toHaveBeenCalled();
    });

    it('works with --dry-run', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        all: true,
        dryRun: true,
      });

      expect(ctx.output).toContain('Dry run');
      expect(ctx.output).toContain('API_KEY');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('STRIPE_KEY');
      expect(mockGithub.deleteSecrets).not.toHaveBeenCalled();
    });
  });

  // ── Non-TTY without flags ────────────────────────────────────────────

  describe('non-TTY without flags', () => {
    it('errors when not TTY and no flags specified', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const ctx = makeCtx();

      await deleteCommand(ctx, {});

      expect(ctx.errOutput).toContain('Interactive mode requires a TTY');
      expect(ctx.errOutput).toContain('--provider');
      expect(ctx.errOutput).toContain('--yes');
      expect(ctx.exitCode).toBe(1);
    });
  });

  // ── No secrets to delete ─────────────────────────────────────────────

  describe('no secrets to delete', () => {
    it('shows nothing to delete for whitespace-only key list', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: ' , , ', // whitespace-only after split
        yes: true,
      });

      expect(ctx.output).toContain('No secrets to delete');
    });

    it('outputs JSON for no secrets to delete', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: ' , , ',
        yes: true,
        json: true,
      });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.deleted).toEqual([]);
      expect(parsed.count).toBe(0);
    });

    it('errors when keys is empty string (treated as missing)', async () => {
      vi.mocked(runCheck).mockResolvedValue(baseCheckResult);
      const mockGithub = makeMockProvider('github');
      vi.mocked(getProvider).mockReturnValue(mockGithub);
      const ctx = makeCtx();

      await deleteCommand(ctx, {
        provider: 'github',
        target: 'actions',
        keys: '', // falsy — treated as not provided
        yes: true,
      });

      expect(ctx.errOutput).toContain('--keys or --all');
      expect(ctx.exitCode).toBe(1);
    });
  });
});
