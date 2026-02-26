import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CliContext } from '../types.js';
import { bold, configureColors, green, red, yellow } from '../utils/terminal.js';

const HOOK_MARKER = '# envguard pre-push hook';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER} — do not edit manually
# Installed by: envguard hook install
envguard check --quiet
`;

export interface HookCommandOptions {
  force?: boolean;
  color?: string;
}

function resolveColorFlag(mode: string | undefined): boolean | undefined {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return undefined;
}

/**
 * Find the git root by walking up from startDir looking for `.git/`.
 * Returns null if no git root is found.
 */
export function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = dir.startsWith('/') ? '/' : dir.slice(0, 3);

  while (dir !== root) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Check root itself
  if (existsSync(join(dir, '.git'))) {
    return dir;
  }

  return null;
}

/**
 * Check if a hook file contains the envguard marker.
 */
export function isEnvguardHook(hookPath: string): boolean {
  if (!existsSync(hookPath)) return false;
  const content = readFileSync(hookPath, 'utf-8');
  return content.includes(HOOK_MARKER);
}

/**
 * Check if the pre-push hook is installed in the given git root.
 */
export function isHookInstalled(gitRoot: string): boolean {
  const hookPath = join(gitRoot, '.git', 'hooks', 'pre-push');
  return isEnvguardHook(hookPath);
}

export async function hookInstallCommand(ctx: CliContext, opts: HookCommandOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color),
  });

  const gitRoot = findGitRoot(ctx.cwd());
  if (!gitRoot) {
    ctx.stderr.write(
      `${red('Error:')} Not a git repository. Run this command inside a git project.\n`,
    );
    ctx.exit(1);
    return;
  }

  const hooksDir = join(gitRoot, '.git', 'hooks');
  const hookPath = join(hooksDir, 'pre-push');

  // Ensure hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, 'utf-8');

    if (content.includes(HOOK_MARKER)) {
      ctx.stdout.write(`${green('✓')} envguard pre-push hook is already installed.\n`);
      return;
    }

    // Existing non-envguard hook
    if (!opts.force) {
      ctx.stderr.write(
        `${yellow('⚠')} A pre-push hook already exists at ${hookPath}\n` +
          `  Use ${bold('--force')} to overwrite it.\n`,
      );
      ctx.exit(1);
      return;
    }

    // --force: overwrite
  }

  writeFileSync(hookPath, HOOK_SCRIPT, 'utf-8');
  chmodSync(hookPath, 0o755);

  ctx.stdout.write(`${green('✓')} Installed envguard pre-push hook at ${hookPath}\n`);
}

export async function hookRemoveCommand(ctx: CliContext, opts: HookCommandOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color),
  });

  const gitRoot = findGitRoot(ctx.cwd());
  if (!gitRoot) {
    ctx.stderr.write(
      `${red('Error:')} Not a git repository. Run this command inside a git project.\n`,
    );
    ctx.exit(1);
    return;
  }

  const hookPath = join(gitRoot, '.git', 'hooks', 'pre-push');

  if (!existsSync(hookPath)) {
    ctx.stdout.write('No pre-push hook found. Nothing to remove.\n');
    return;
  }

  const content = readFileSync(hookPath, 'utf-8');

  if (!content.includes(HOOK_MARKER)) {
    if (!opts.force) {
      ctx.stderr.write(
        `${yellow('⚠')} The pre-push hook is not an envguard hook.\n` +
          `  Use ${bold('--force')} to remove it anyway.\n`,
      );
      ctx.exit(1);
      return;
    }
  }

  unlinkSync(hookPath);
  ctx.stdout.write(`${green('✓')} Removed pre-push hook.\n`);
}
