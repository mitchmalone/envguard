import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findGitRoot,
  hookInstallCommand,
  hookRemoveCommand,
  isEnvguardHook,
  isHookInstalled,
} from '../src/commands/hook.js';
import type { CliContext } from '../src/types.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

function makeCtx(
  cwd: string,
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
    cwd: () => cwd,
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

describe('findGitRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'envguard-hook-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds git root when .git exists', () => {
    mkdirSync(join(tmpDir, '.git'));
    expect(findGitRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds git root from subdirectory', () => {
    mkdirSync(join(tmpDir, '.git'));
    const subDir = join(tmpDir, 'src', 'commands');
    mkdirSync(subDir, { recursive: true });
    expect(findGitRoot(subDir)).toBe(tmpDir);
  });

  it('returns null when no .git found', () => {
    expect(findGitRoot(tmpDir)).toBeNull();
  });
});

describe('isEnvguardHook', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'envguard-hook-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true for envguard hook', () => {
    const hookPath = join(tmpDir, 'pre-push');
    writeFileSync(
      hookPath,
      '#!/bin/sh\n# envguard pre-push hook — do not edit manually\nenvguard check --quiet\n',
    );
    expect(isEnvguardHook(hookPath)).toBe(true);
  });

  it('returns false for non-envguard hook', () => {
    const hookPath = join(tmpDir, 'pre-push');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');
    expect(isEnvguardHook(hookPath)).toBe(false);
  });

  it('returns false for non-existent file', () => {
    expect(isEnvguardHook(join(tmpDir, 'nope'))).toBe(false);
  });
});

describe('isHookInstalled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'envguard-hook-'));
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when hook is installed', () => {
    writeFileSync(
      join(tmpDir, '.git', 'hooks', 'pre-push'),
      '#!/bin/sh\n# envguard pre-push hook\nenvguard check --quiet\n',
    );
    expect(isHookInstalled(tmpDir)).toBe(true);
  });

  it('returns false when no hook exists', () => {
    expect(isHookInstalled(tmpDir)).toBe(false);
  });
});

describe('hookInstallCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'envguard-hook-'));
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs hook into git repo', async () => {
    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, {});

    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('# envguard pre-push hook');
    expect(content).toContain('envguard check --quiet');
    expect(ctx.output).toContain('Installed envguard pre-push hook');
    expect(ctx.exitCode).toBeNull();
  });

  it('hook script is executable', async () => {
    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, {});

    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    const { execSync } = await import('node:child_process');
    const result = execSync(`test -x "${hookPath}" && echo "yes" || echo "no"`, {
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('yes');
  });

  it('detects already-installed envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(
      hookPath,
      '#!/bin/sh\n# envguard pre-push hook — do not edit manually\nenvguard check --quiet\n',
    );

    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, {});

    expect(ctx.output).toContain('already installed');
    expect(ctx.exitCode).toBeNull();
  });

  it('warns about existing non-envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, {});

    expect(ctx.errOutput).toContain('pre-push hook already exists');
    expect(ctx.errOutput).toContain('--force');
    expect(ctx.exitCode).toBe(1);
  });

  it('--force overwrites existing non-envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, { force: true });

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('# envguard pre-push hook');
    expect(ctx.output).toContain('Installed envguard pre-push hook');
    expect(ctx.exitCode).toBeNull();
  });

  it('errors when not in a git repo', async () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'envguard-nogit-'));
    try {
      const ctx = makeCtx(noGitDir);
      await hookInstallCommand(ctx, {});

      expect(ctx.errOutput).toContain('Not a git repository');
      expect(ctx.exitCode).toBe(1);
    } finally {
      rmSync(noGitDir, { recursive: true, force: true });
    }
  });

  it('creates hooks directory if missing', async () => {
    // Remove the hooks dir we created in beforeEach
    rmSync(join(tmpDir, '.git', 'hooks'), { recursive: true, force: true });
    // .git still exists but no hooks/ subdirectory
    expect(existsSync(join(tmpDir, '.git', 'hooks'))).toBe(false);

    const ctx = makeCtx(tmpDir);
    await hookInstallCommand(ctx, {});

    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    expect(existsSync(hookPath)).toBe(true);
    expect(ctx.output).toContain('Installed envguard pre-push hook');
  });
});

describe('hookRemoveCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'envguard-hook-'));
    mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(
      hookPath,
      '#!/bin/sh\n# envguard pre-push hook — do not edit manually\nenvguard check --quiet\n',
    );

    const ctx = makeCtx(tmpDir);
    await hookRemoveCommand(ctx, {});

    expect(existsSync(hookPath)).toBe(false);
    expect(ctx.output).toContain('Removed pre-push hook');
    expect(ctx.exitCode).toBeNull();
  });

  it('refuses to remove non-envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const ctx = makeCtx(tmpDir);
    await hookRemoveCommand(ctx, {});

    expect(existsSync(hookPath)).toBe(true);
    expect(ctx.errOutput).toContain('not an envguard hook');
    expect(ctx.errOutput).toContain('--force');
    expect(ctx.exitCode).toBe(1);
  });

  it('--force removes non-envguard hook', async () => {
    const hookPath = join(tmpDir, '.git', 'hooks', 'pre-push');
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const ctx = makeCtx(tmpDir);
    await hookRemoveCommand(ctx, { force: true });

    expect(existsSync(hookPath)).toBe(false);
    expect(ctx.output).toContain('Removed pre-push hook');
    expect(ctx.exitCode).toBeNull();
  });

  it('handles missing hook gracefully', async () => {
    const ctx = makeCtx(tmpDir);
    await hookRemoveCommand(ctx, {});

    expect(ctx.output).toContain('No pre-push hook found');
    expect(ctx.exitCode).toBeNull();
  });

  it('errors when not in a git repo', async () => {
    const noGitDir = mkdtempSync(join(tmpdir(), 'envguard-nogit-'));
    try {
      const ctx = makeCtx(noGitDir);
      await hookRemoveCommand(ctx, {});

      expect(ctx.errOutput).toContain('Not a git repository');
      expect(ctx.exitCode).toBe(1);
    } finally {
      rmSync(noGitDir, { recursive: true, force: true });
    }
  });
});
