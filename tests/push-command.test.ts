import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushCommand } from '../src/commands/push.js';
import type { CheckResult, CliContext, Provider, ProviderName } from '../src/types.js';

// Mock the comparator and config modules
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

const allSyncedResult: CheckResult = {
  localSecrets: [
    { key: 'API_KEY', value: 'abc123', source: '.env.local' },
    { key: 'DB_URL', value: 'pg://localhost/db', source: '.env.local' },
  ],
  remoteKeys: [
    {
      provider: 'github',
      target: 'actions',
      keys: ['API_KEY', 'DB_URL'],
    },
  ],
  providers: [{ provider: 'github', displayName: 'GitHub', available: true }],
  missing: [],
  allSynced: true,
};

const missingResult: CheckResult = {
  localSecrets: [
    { key: 'API_KEY', value: 'abc123', source: '.env.local' },
    { key: 'STRIPE_KEY', value: 'sk_live_test', source: '.env.local' },
    { key: 'DB_URL', value: 'pg://localhost/db', source: '.env.local' },
  ],
  remoteKeys: [
    { provider: 'github', target: 'actions', keys: ['API_KEY'] },
    {
      provider: 'vercel',
      target: 'production',
      keys: ['API_KEY', 'STRIPE_KEY'],
    },
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
  allSynced: false,
};

function makeMockProvider(name: ProviderName): Provider {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    detect: vi.fn().mockResolvedValue(true),
    targets: vi.fn().mockReturnValue(['actions', 'codespaces']),
    listRemoteKeys: vi.fn().mockResolvedValue([]),
    pushSecrets: vi.fn().mockImplementation(async (secrets, target) => {
      return Object.keys(secrets).map((key) => ({
        key,
        provider: name,
        target,
        status: 'ok' as const,
      }));
    }),
    deleteSecrets: vi.fn().mockResolvedValue([]),
    checkPrerequisites: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('pushCommand', () => {
  beforeEach(() => {
    vi.mocked(getProjectRoot).mockReturnValue('/fake/project');
    vi.mocked(loadConfig).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── All synced ───────────────────────────────────────────────────────

  describe('all synced', () => {
    it('shows success message when all secrets are synced', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await pushCommand(ctx, {});

      expect(ctx.output).toContain('All secrets are already synced');
      expect(ctx.exitCode).toBeNull();
    });

    it('outputs JSON when all synced with --json', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await pushCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.allSynced).toBe(true);
      expect(parsed.pushed).toEqual([]);
    });

    it('suppresses output in quiet mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(allSyncedResult);
      const ctx = makeCtx();

      await pushCommand(ctx, { quiet: true });

      expect(ctx.output).toBe('');
    });
  });

  // ── No providers ─────────────────────────────────────────────────────

  describe('no providers', () => {
    it('exits 2 when no providers detected', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...allSyncedResult,
        providers: [],
      });
      const ctx = makeCtx();

      await pushCommand(ctx, { force: true });

      expect(ctx.errOutput).toContain('No providers detected');
      expect(ctx.exitCode).toBe(2);
    });

    it('exits 2 when all providers fail prerequisites', async () => {
      vi.mocked(runCheck).mockResolvedValue({
        ...allSyncedResult,
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

      await pushCommand(ctx, { force: true });

      expect(ctx.errOutput).toContain('prerequisite checks');
      expect(ctx.errOutput).toContain('gh CLI not found');
      expect(ctx.exitCode).toBe(2);
    });
  });

  // ── Dry run ──────────────────────────────────────────────────────────

  describe('--dry-run', () => {
    it('shows what would be pushed', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await pushCommand(ctx, { dryRun: true });

      expect(ctx.output).toContain('Dry run');
      expect(ctx.output).toContain('STRIPE_KEY');
      expect(ctx.output).toContain('GitHub Actions');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('Vercel (production)');
      expect(ctx.output).toContain('2 secrets would be pushed');
      expect(ctx.exitCode).toBeNull();
    });

    it('outputs JSON in dry-run mode', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();

      await pushCommand(ctx, { dryRun: true, json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.items).toHaveLength(3); // STRIPE_KEY→actions, DB_URL→actions, DB_URL→vercel
      expect(ctx.exitCode).toBeNull();
    });
  });

  // ── Force push ───────────────────────────────────────────────────────

  describe('--force', () => {
    it('pushes all missing secrets', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);

      const mockGithub = makeMockProvider('github');
      const mockVercel = makeMockProvider('vercel');
      vi.mocked(getProvider).mockImplementation((name) => {
        if (name === 'github') return mockGithub;
        if (name === 'vercel') return mockVercel;
        throw new Error(`Unknown provider: ${name}`);
      });

      const ctx = makeCtx();
      await pushCommand(ctx, { force: true });

      // STRIPE_KEY → github actions
      expect(mockGithub.pushSecrets).toHaveBeenCalledWith(
        { STRIPE_KEY: 'sk_live_test' },
        'actions',
      );
      // DB_URL → github actions
      expect(mockGithub.pushSecrets).toHaveBeenCalledWith(
        { DB_URL: 'pg://localhost/db' },
        'actions',
      );
      // DB_URL → vercel production
      expect(mockVercel.pushSecrets).toHaveBeenCalledWith(
        { DB_URL: 'pg://localhost/db' },
        'production',
      );

      expect(ctx.output).toContain('STRIPE_KEY');
      expect(ctx.output).toContain('DB_URL');
      expect(ctx.output).toContain('3 secrets pushed successfully');
      expect(ctx.exitCode).toBeNull();
    });

    it('reports errors and exits 1 on push failure', async () => {
      const failResult: CheckResult = {
        ...missingResult,
        missing: [
          {
            key: 'FAIL_KEY',
            source: '.env.local',
            missingFrom: [{ provider: 'github', target: 'actions' }],
          },
        ],
      };
      vi.mocked(runCheck).mockResolvedValue(failResult);

      const mockGithub = makeMockProvider('github');
      (mockGithub.pushSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          key: 'FAIL_KEY',
          provider: 'github',
          target: 'actions',
          status: 'error',
          error: 'permission denied',
        },
      ]);
      vi.mocked(getProvider).mockReturnValue(mockGithub);

      const ctx = makeCtx();
      await pushCommand(ctx, { force: true });

      expect(ctx.output).toContain('1 push failed');
      expect(ctx.exitCode).toBe(1);
    });

    it('outputs JSON results with --json', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);

      const mockGithub = makeMockProvider('github');
      const mockVercel = makeMockProvider('vercel');
      vi.mocked(getProvider).mockImplementation((name) => {
        if (name === 'github') return mockGithub;
        if (name === 'vercel') return mockVercel;
        throw new Error(`Unknown provider: ${name}`);
      });

      const ctx = makeCtx();
      await pushCommand(ctx, { force: true, json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.pushed).toHaveLength(3);
      expect(parsed.ok).toBe(3);
      expect(parsed.errors).toBe(0);
    });
  });

  // ── Non-TTY without --force ──────────────────────────────────────────

  describe('non-TTY without --force', () => {
    it('errors when not TTY and not --force', async () => {
      vi.mocked(runCheck).mockResolvedValue(missingResult);
      const ctx = makeCtx();
      // stdout is a PassThrough which has no isTTY

      await pushCommand(ctx, {});

      expect(ctx.errOutput).toContain('Interactive mode requires a TTY');
      expect(ctx.errOutput).toContain('--force');
      expect(ctx.exitCode).toBe(1);
    });
  });
});
