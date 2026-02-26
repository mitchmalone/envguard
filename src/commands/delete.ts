import { createElement } from 'react';
import { runCheck } from '../core/comparator.js';
import { getProvider } from '../providers/registry.js';
import type { CliContext, ProviderName, PushResult } from '../types.js';
import { type DeleteLoadResult, DeleteWizard } from '../ui/DeleteWizard.js';
import { getProjectRoot, loadConfig } from '../utils/config.js';
import { bold, configureColors, green, red } from '../utils/terminal.js';

export interface DeleteCommandOptions {
  provider?: string;
  target?: string;
  keys?: string;
  yes?: boolean;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: string;
}

function resolveColorFlag(mode: string | undefined): boolean | undefined {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return undefined;
}

function formatTarget(provider: ProviderName, target: string): string {
  if (provider === 'github') {
    return `GitHub ${target.charAt(0).toUpperCase()}${target.slice(1)}`;
  }
  const names: Record<ProviderName, string> = {
    github: 'GitHub',
    vercel: 'Vercel',
    netlify: 'Netlify',
  };
  return `${names[provider] ?? provider} (${target})`;
}

export async function deleteCommand(ctx: CliContext, opts: DeleteCommandOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color),
  });

  const projectRoot = getProjectRoot(ctx.cwd());
  const config = loadConfig(projectRoot);
  const checkResult = await runCheck(projectRoot, config);

  const availableProviders = checkResult.providers.filter((p) => p.available);

  // No providers
  if (availableProviders.length === 0) {
    if (checkResult.providers.length === 0) {
      ctx.stderr.write(
        `${red('Error:')} No providers detected.\n  envguard looks for .github/, vercel.json, .vercel/, netlify.toml, or .netlify/ in your project.\n  You can also specify providers in .envguard.json: { "providers": ["github", "vercel"] }\n  Run ${bold('envguard config init')} to create a config file.\n`,
      );
    } else {
      ctx.stderr.write(`${red('Error:')} All providers failed prerequisite checks:\n`);
      for (const p of checkResult.providers) {
        ctx.stderr.write(`  ${p.displayName}: ${p.error ?? 'unknown error'}\n`);
        if (p.fix) {
          ctx.stderr.write(`    Fix: ${p.fix}\n`);
        }
      }
    }
    ctx.exit(2);
    return;
  }

  // Non-interactive mode when any target/keys flags are specified
  const isNonInteractive = opts.provider || opts.target || opts.keys || opts.all;
  if (isNonInteractive) {
    return nonInteractiveDelete(ctx, opts);
  }

  // Non-TTY without flags
  const isTTY = 'isTTY' in ctx.stdout && (ctx.stdout as { isTTY?: boolean }).isTTY;
  if (!isTTY) {
    ctx.stderr.write(
      `${red('Error:')} Interactive mode requires a TTY. Use ${bold('--provider')}, ${bold('--target')}, and ${bold('--keys')} with ${bold('--yes')} to delete non-interactively.\n`,
    );
    ctx.exit(1);
    return;
  }

  // Interactive mode with Ink
  await interactiveDelete(ctx, projectRoot, config, opts);
}

// ── Non-interactive delete ──────────────────────────────────────────────────

async function nonInteractiveDelete(ctx: CliContext, opts: DeleteCommandOptions): Promise<void> {
  // Validate required options
  if (!opts.provider) {
    ctx.stderr.write(`${red('Error:')} --provider is required for non-interactive delete.\n`);
    ctx.exit(1);
    return;
  }

  if (!opts.target) {
    ctx.stderr.write(`${red('Error:')} --target is required for non-interactive delete.\n`);
    ctx.exit(1);
    return;
  }

  if (!opts.keys && !opts.all) {
    ctx.stderr.write(`${red('Error:')} Either --keys or --all is required.\n`);
    ctx.exit(1);
    return;
  }

  // Validate provider
  const providerName = opts.provider as ProviderName;
  let provider: ReturnType<typeof getProvider>;
  try {
    provider = getProvider(providerName);
  } catch {
    ctx.stderr.write(`${red('Error:')} Provider "${opts.provider}" is not available.\n`);
    ctx.exit(1);
    return;
  }

  // Validate target
  const validTargets = provider.targets();
  if (!validTargets.includes(opts.target)) {
    ctx.stderr.write(
      `${red('Error:')} Invalid target "${opts.target}" for ${provider.displayName}. Valid targets: ${validTargets.join(', ')}\n`,
    );
    ctx.exit(1);
    return;
  }

  // Determine keys to delete
  let keysToDelete: string[];
  if (opts.all) {
    const projectRoot = getProjectRoot(ctx.cwd());
    const config = loadConfig(projectRoot);
    const checkResult = await runCheck(projectRoot, config);

    const localKeys = [...new Set(checkResult.localSecrets.map((s) => s.key))];
    const remoteEntry = checkResult.remoteKeys.find(
      (r) => r.provider === providerName && r.target === opts.target,
    );
    const remoteKeys = new Set(remoteEntry?.keys ?? []);
    keysToDelete = localKeys.filter((k) => remoteKeys.has(k));
  } else {
    keysToDelete = (opts.keys ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  const targetDisplay = formatTarget(providerName, opts.target);

  if (keysToDelete.length === 0) {
    if (opts.json) {
      ctx.stdout.write(`${JSON.stringify({ deleted: [], count: 0 })}\n`);
    } else if (!opts.quiet) {
      ctx.stdout.write(`${green('✓')} No secrets to delete.\n`);
    }
    return;
  }

  // Dry run
  if (opts.dryRun) {
    if (opts.json) {
      const items = keysToDelete.map((key) => ({
        key,
        provider: providerName,
        target: opts.target,
      }));
      ctx.stdout.write(`${JSON.stringify({ dryRun: true, items })}\n`);
      return;
    }
    ctx.stdout.write(`\n  ${bold('Dry run')} — would delete:\n\n`);
    for (const key of keysToDelete) {
      ctx.stdout.write(`    ${key}  ← ${targetDisplay}\n`);
    }
    ctx.stdout.write(
      `\n  ${keysToDelete.length} secret${keysToDelete.length !== 1 ? 's' : ''} would be deleted from ${targetDisplay}.\n\n`,
    );
    return;
  }

  // Require --yes
  if (!opts.yes) {
    ctx.stderr.write(
      `${red('Error:')} Deleting secrets is irreversible. Use ${bold('--yes')} to confirm.\n`,
    );
    ctx.exit(1);
    return;
  }

  // Execute delete
  if (!opts.quiet && !opts.json) {
    ctx.stdout.write(
      `\n  Deleting ${keysToDelete.length} secret${keysToDelete.length !== 1 ? 's' : ''} from ${targetDisplay}...\n\n`,
    );
  }

  const results = await provider.deleteSecrets(keysToDelete, opts.target);

  if (opts.json) {
    const ok = results.filter((r) => r.status === 'ok').length;
    const errors = results.filter((r) => r.status === 'error').length;
    ctx.stdout.write(`${JSON.stringify({ deleted: results, ok, errors })}\n`);
  } else if (!opts.quiet) {
    for (const r of results) {
      const icon = r.status === 'ok' ? green('✓') : red('✗');
      ctx.stdout.write(`  ${icon} ${r.key} ← ${targetDisplay}${r.error ? ` (${r.error})` : ''}\n`);
    }

    const ok = results.filter((r) => r.status === 'ok').length;
    const errors = results.filter((r) => r.status === 'error').length;
    ctx.stdout.write('\n');
    if (ok > 0) {
      ctx.stdout.write(`  ${green('✓')} ${ok} secret${ok !== 1 ? 's' : ''} deleted\n`);
    }
    if (errors > 0) {
      ctx.stdout.write(`  ${red('✗')} ${errors} deletion${errors !== 1 ? 's' : ''} failed\n`);
    }
    ctx.stdout.write('\n');
  }

  const hasErrors = results.some((r) => r.status === 'error');
  if (hasErrors) {
    ctx.exit(1);
  }
}

// ── Interactive delete (Ink TUI) ────────────────────────────────────────────

async function interactiveDelete(
  ctx: CliContext,
  projectRoot: string,
  config: ReturnType<typeof loadConfig>,
  opts: DeleteCommandOptions,
): Promise<void> {
  const { render } = await import('ink');

  let wizardExitCode = 0;

  const loadData = async (): Promise<DeleteLoadResult> => {
    const checkResult = await runCheck(projectRoot, config);
    const available = checkResult.providers.filter((p) => p.available);

    const targets: DeleteLoadResult['targets'] = [];
    const remoteKeysByTarget: Record<string, string[]> = {};

    for (const p of available) {
      const provider = getProvider(p.provider);
      for (const target of provider.targets()) {
        const targetKey = `${p.provider}:${target}`;
        const remoteEntry = checkResult.remoteKeys.find(
          (r) => r.provider === p.provider && r.target === target,
        );
        const keys = remoteEntry?.keys ?? [];
        remoteKeysByTarget[targetKey] = keys;
        targets.push({
          provider: p.provider,
          target,
          displayName: formatTarget(p.provider, target),
          keyCount: keys.length,
        });
      }
    }

    return { targets, remoteKeysByTarget };
  };

  const deleteFn = async (
    keys: string[],
    providerName: ProviderName,
    target: string,
  ): Promise<PushResult[]> => {
    const provider = getProvider(providerName);
    return provider.deleteSecrets(keys, target);
  };

  const element = createElement(DeleteWizard, {
    loadData,
    deleteFn,
    onExit: (code: number) => {
      wizardExitCode = code;
    },
    verbose: opts.verbose,
  });

  const instance = render(element, {
    stdout: ctx.stdout as NodeJS.WriteStream,
    stderr: ctx.stderr as NodeJS.WriteStream,
  });

  await instance.waitUntilExit();

  if (wizardExitCode !== 0) {
    ctx.exit(wizardExitCode);
  }
}
