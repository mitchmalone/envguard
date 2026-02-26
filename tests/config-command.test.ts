import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configShowCommand } from '../src/commands/config.js';
import type { CliContext, Config } from '../src/types.js';

// Mock dependencies
vi.mock('../src/utils/config.js');
vi.mock('../src/core/env-parser.js');
vi.mock('../src/core/detector.js');

import { detectProviders } from '../src/core/detector.js';
import { discoverEnvFiles } from '../src/core/env-parser.js';
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

describe('configShowCommand', () => {
  beforeEach(() => {
    vi.mocked(getProjectRoot).mockReturnValue('/fake/project');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('with config file', () => {
    const testConfig: Config = {
      envFiles: ['.env.local', '.env.production'],
      providers: ['github', 'vercel'],
      ignore: ['NODE_ENV', 'DEBUG'],
      envMapping: {
        '.env.production': 'production',
        '.env.local': 'development',
      },
    };

    it('shows config file values in text mode', async () => {
      vi.mocked(loadConfig).mockReturnValue(testConfig);
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('envguard');
      expect(ctx.output).toContain('configuration');
      expect(ctx.output).toContain('.envguard.json found');
      expect(ctx.output).toContain('.env.local, .env.production');
      expect(ctx.output).toContain('github, vercel');
      expect(ctx.output).toContain('NODE_ENV, DEBUG');
      expect(ctx.output).toContain('.env.production → production');
      expect(ctx.output).toContain('.env.local → development');
      expect(ctx.exitCode).toBeNull();
    });

    it('shows config as JSON', async () => {
      vi.mocked(loadConfig).mockReturnValue(testConfig);
      const ctx = makeCtx();

      await configShowCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.envFiles).toEqual(['.env.local', '.env.production']);
      expect(parsed.providers).toEqual(['github', 'vercel']);
      expect(parsed.ignore).toEqual(['NODE_ENV', 'DEBUG']);
      expect(parsed.envMapping).toEqual({
        '.env.production': 'production',
        '.env.local': 'development',
      });
    });

    it('shows auto-detect label when envFiles is not set', async () => {
      vi.mocked(loadConfig).mockReturnValue({ providers: ['github'] });
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('(auto-detect)');
      expect(ctx.output).toContain('github');
    });

    it('shows auto-detect label when providers is not set', async () => {
      vi.mocked(loadConfig).mockReturnValue({ envFiles: ['.env'] });
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('.env');
      expect(ctx.output).toMatch(/Providers:.*\(auto-detect\)/);
    });

    it('shows (none) when ignore list is empty', async () => {
      vi.mocked(loadConfig).mockReturnValue({ envFiles: ['.env'] });
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('(none)');
    });
  });

  describe('without config file', () => {
    it('shows auto-detected settings', async () => {
      vi.mocked(loadConfig).mockReturnValue(null);
      vi.mocked(discoverEnvFiles).mockReturnValue([
        '/fake/project/.env',
        '/fake/project/.env.local',
      ]);
      vi.mocked(detectProviders).mockReturnValue(['github']);
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('No .envguard.json found');
      expect(ctx.output).toContain('Detected env files:');
      expect(ctx.output).toContain('.env, .env.local');
      expect(ctx.output).toContain('Detected providers:');
      expect(ctx.output).toContain('github');
      expect(ctx.output).toContain('envguard config init');
    });

    it('shows (none) when nothing is detected', async () => {
      vi.mocked(loadConfig).mockReturnValue(null);
      vi.mocked(discoverEnvFiles).mockReturnValue([]);
      vi.mocked(detectProviders).mockReturnValue([]);
      const ctx = makeCtx();

      await configShowCommand(ctx, {});

      expect(ctx.output).toContain('No .envguard.json found');
      expect(ctx.output).toMatch(/Detected env files:.*\(none\)/);
      expect(ctx.output).toMatch(/Detected providers:.*\(none\)/);
    });

    it('outputs auto-detected JSON when no config exists', async () => {
      vi.mocked(loadConfig).mockReturnValue(null);
      vi.mocked(discoverEnvFiles).mockReturnValue(['/fake/project/.env']);
      vi.mocked(detectProviders).mockReturnValue(['vercel']);
      const ctx = makeCtx();

      await configShowCommand(ctx, { json: true });

      const parsed = JSON.parse(ctx.output);
      expect(parsed.configured).toBe(false);
      expect(parsed.detected.envFiles).toEqual(['.env']);
      expect(parsed.detected.providers).toEqual(['vercel']);
      expect(parsed.detected.ignore).toEqual([]);
    });
  });
});
