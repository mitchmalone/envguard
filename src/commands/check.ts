import { runCheck } from '../core/comparator.js';
import type { CliContext, MissingSecret, ProviderName, ProviderStatus } from '../types.js';
import { loadConfig } from '../utils/config.js';
import { getProjectRoot } from '../utils/config.js';
import { bold, configureColors, green, red, yellow } from '../utils/terminal.js';
import { findGitRoot, isHookInstalled } from './hook.js';

export interface CheckCommandOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: string;
}

function resolveColorFlag(mode: string | undefined, ctx: CliContext): boolean | undefined {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return undefined; // 'auto' — let configureColors use NO_COLOR
}

/**
 * Format a provider+target pair for display.
 * GitHub targets show as "GitHub Actions" / "GitHub Codespaces".
 * Other providers show as "Provider (target)".
 */
function formatTarget(provider: ProviderName, target: string): string {
  if (provider === 'github') {
    return `GitHub ${target.charAt(0).toUpperCase()}${target.slice(1)}`;
  }
  return `${providerDisplayName(provider)} (${target})`;
}

function providerDisplayName(name: ProviderName): string {
  const names: Record<ProviderName, string> = {
    github: 'GitHub',
    vercel: 'Vercel',
    netlify: 'Netlify',
  };
  return names[name] ?? name;
}

/**
 * Build the "Providers:" display list from available providers and their targets.
 * GitHub shows per-target (GitHub Actions, GitHub Codespaces).
 * Others show just the provider name (Vercel, Netlify).
 */
function formatProviderList(providers: ProviderStatus[]): string[] {
  const items: string[] = [];
  for (const p of providers) {
    if (!p.available) continue;
    if (p.provider === 'github') {
      items.push('GitHub Actions', 'GitHub Codespaces');
    } else {
      items.push(p.displayName);
    }
  }
  return items;
}

/**
 * Format the "missing from" list for a single secret.
 */
function formatMissingFrom(missingFrom: MissingSecret['missingFrom']): string {
  return missingFrom.map((m) => formatTarget(m.provider, m.target)).join(', ');
}

/**
 * Get unique source file names from local secrets.
 */
function getSourceFiles(secrets: Array<{ source: string }>): string[] {
  return [...new Set(secrets.map((s) => s.source))];
}

export async function checkCommand(ctx: CliContext, opts: CheckCommandOptions): Promise<void> {
  configureColors({ env: ctx.env, forceColor: resolveColorFlag(opts.color, ctx) });

  const projectRoot = getProjectRoot(ctx.cwd());
  const config = loadConfig(projectRoot);

  const startTime = performance.now();
  const result = await runCheck(projectRoot, config);
  const elapsed = performance.now() - startTime;

  // JSON output
  if (opts.json) {
    ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.allSynced) {
      ctx.exit(1);
    } else if (result.providers.length > 0 && result.providers.every((p) => !p.available)) {
      ctx.exit(2);
    }
    return;
  }

  const availableProviders = result.providers.filter((p) => p.available);
  const unavailableProviders = result.providers.filter((p) => !p.available);

  // No local secrets
  if (result.localSecrets.length === 0) {
    if (opts.json) {
      ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (!opts.quiet) {
      const envFiles = config?.envFiles;
      const checked = envFiles?.length
        ? envFiles.join(', ')
        : '.env, .env.local, .env.development, .env.production, .env.staging';
      ctx.stderr.write(
        `${yellow('⚠')} No secrets found. Checked: ${checked}\n  Create a .env file or update envFiles in .envguard.json.\n`,
      );
    }
    return;
  }

  // Exit code 2: no providers could be checked
  if (result.providers.length === 0) {
    if (!opts.quiet) {
      ctx.stderr.write(
        `${red('Error:')} No providers detected.\n  envguard looks for .github/, vercel.json, .vercel/, netlify.toml, or .netlify/ in your project.\n  You can also specify providers in .envguard.json: { "providers": ["github", "vercel"] }\n  Run ${bold('envguard config init')} to create a config file.\n`,
      );
    }
    ctx.exit(2);
    return;
  }

  if (availableProviders.length === 0) {
    if (!opts.quiet) {
      ctx.stderr.write(`${red('Error:')} All providers failed prerequisite checks:\n`);
      for (const p of unavailableProviders) {
        ctx.stderr.write(`  ${p.displayName}: ${p.error ?? 'unknown error'}\n`);
        if (p.fix) {
          ctx.stderr.write(`    Fix: ${p.fix}\n`);
        }
      }
    }
    ctx.exit(2);
    return;
  }

  // Quiet mode: only output if there are missing secrets
  if (opts.quiet && result.allSynced) {
    return;
  }

  // Text output
  const sources = getSourceFiles(result.localSecrets);
  const providerList = formatProviderList(availableProviders);
  const secretCount = new Set(result.localSecrets.map((s) => s.key)).size;

  if (!opts.quiet) {
    ctx.stdout.write('\n');
    ctx.stdout.write(`  ${bold('envguard')} · checking secrets\n`);
    ctx.stdout.write('\n');

    // Show source files
    ctx.stdout.write(
      `  ${green('✓')} ${secretCount} secret${secretCount !== 1 ? 's' : ''} from ${sources.join(', ')}\n`,
    );

    // Show providers
    ctx.stdout.write(`  ${green('✓')} Providers: ${providerList.join(', ')}\n`);

    // Show unavailable providers as warnings
    for (const p of unavailableProviders) {
      ctx.stdout.write(`  ${yellow('⚠')} ${p.displayName}: ${p.error ?? 'unavailable'}\n`);
    }
  }

  // Verbose: extra detail
  if (opts.verbose) {
    ctx.stdout.write('\n');
    // Per-source file detail
    for (const source of sources) {
      const count = result.localSecrets.filter((s) => s.source === source).length;
      ctx.stdout.write(`  ${source}: ${count} key${count !== 1 ? 's' : ''}\n`);
    }
    // Per-provider prerequisite status
    for (const p of result.providers) {
      const status = p.available ? green('ok') : red('failed');
      ctx.stdout.write(`  ${p.displayName} prerequisites: ${status}\n`);
    }
    // Per-target key counts
    for (const remote of result.remoteKeys) {
      ctx.stdout.write(
        `  ${formatTarget(remote.provider, remote.target)}: ${remote.keys.length} remote key${remote.keys.length !== 1 ? 's' : ''}\n`,
      );
    }
    // Duplicate key warnings
    if (result.duplicateKeys.length > 0) {
      for (const dup of result.duplicateKeys) {
        ctx.stdout.write(
          `  ${yellow('⚠')} ${dup.key} defined in multiple files: ${dup.sources.join(', ')}\n`,
        );
      }
    }
    // Hook status
    const gitRoot = findGitRoot(ctx.cwd());
    if (gitRoot) {
      const hookStatus = isHookInstalled(gitRoot) ? green('installed') : yellow('not installed');
      ctx.stdout.write(`  Pre-push hook: ${hookStatus}\n`);
    }
    // Timing
    ctx.stdout.write(`  Completed in ${elapsed.toFixed(0)}ms\n`);
  }

  ctx.stdout.write('\n');

  if (result.allSynced) {
    ctx.stdout.write(
      `  ${green('✓')} All ${secretCount} secret${secretCount !== 1 ? 's' : ''} exist on all providers.\n`,
    );
  } else {
    ctx.stdout.write(
      `  ${yellow('⚠')} ${result.missing.length} secret${result.missing.length !== 1 ? 's' : ''} missing from remote:\n`,
    );
    ctx.stdout.write('\n');

    // Find max key length for alignment
    const maxKeyLen = Math.max(...result.missing.map((m) => m.key.length));

    for (const m of result.missing) {
      const paddedKey = m.key.padEnd(maxKeyLen);
      ctx.stdout.write(`    ${paddedKey}  → ${formatMissingFrom(m.missingFrom)}\n`);
    }

    ctx.stdout.write('\n');
    ctx.stdout.write(`  Run ${bold('envguard push')} to sync them.\n`);

    // Suggest hook install if no hook is present
    const gitRoot = findGitRoot(ctx.cwd());
    if (gitRoot && !isHookInstalled(gitRoot)) {
      ctx.stdout.write(
        `  Run ${bold('envguard hook install')} to catch missing secrets before pushing.\n`,
      );
    }
  }

  ctx.stdout.write('\n');

  if (!result.allSynced) {
    ctx.exit(1);
  }
}
