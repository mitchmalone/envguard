import { createElement } from 'react';
import { runCheck } from '../core/comparator.js';
import { getProvider } from '../providers/registry.js';
import type { CliContext, MissingSecret, ProviderName, PushResult } from '../types.js';
import { type PushLoadResult, PushWizard } from '../ui/PushWizard.js';
import { getProjectRoot, loadConfig } from '../utils/config.js';
import { bold, configureColors, green, red } from '../utils/terminal.js';

export interface PushCommandOptions {
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: string;
}

function resolveColorFlag(mode: string | undefined, ctx: CliContext): boolean | undefined {
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

export async function pushCommand(ctx: CliContext, opts: PushCommandOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color, ctx),
  });

  const projectRoot = getProjectRoot(ctx.cwd());
  const config = loadConfig(projectRoot);
  const checkResult = await runCheck(projectRoot, config);

  // Build secret values map (de-dup, first occurrence wins)
  const secretValues: Record<string, string> = {};
  for (const s of checkResult.localSecrets) {
    if (!(s.key in secretValues)) {
      secretValues[s.key] = s.value;
    }
  }

  const availableProviders = checkResult.providers.filter((p) => p.available);

  // No providers
  if (availableProviders.length === 0) {
    if (checkResult.providers.length === 0) {
      ctx.stderr.write(
        `${red('Error:')} No providers detected. Add a .envguard.json config or use a project with GitHub/Vercel/Netlify.\n`,
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

  // All synced
  if (checkResult.allSynced) {
    if (opts.json) {
      ctx.stdout.write(`${JSON.stringify({ pushed: [], allSynced: true })}\n`);
    } else if (!opts.quiet) {
      ctx.stdout.write(`${green('✓')} All secrets are already synced.\n`);
    }
    return;
  }

  // Dry run
  if (opts.dryRun) {
    return dryRun(ctx, checkResult.missing, opts);
  }

  // Force mode (non-interactive push all missing)
  if (opts.force) {
    return forcePush(ctx, checkResult.missing, secretValues, opts);
  }

  // Non-TTY without --force
  const isTTY = 'isTTY' in ctx.stdout && (ctx.stdout as { isTTY?: boolean }).isTTY;
  if (!isTTY) {
    ctx.stderr.write(
      `${red('Error:')} Interactive mode requires a TTY. Use ${bold('--force')} to push all missing secrets.\n`,
    );
    ctx.exit(1);
    return;
  }

  // Interactive mode with Ink
  await interactivePush(ctx, projectRoot, config, opts);
}

// ── Dry run ──────────────────────────────────────────────────────────────────

function dryRun(ctx: CliContext, missing: MissingSecret[], opts: PushCommandOptions): void {
  if (opts.json) {
    const items = missing.flatMap((m) =>
      m.missingFrom.map((t) => ({
        key: m.key,
        provider: t.provider,
        target: t.target,
      })),
    );
    ctx.stdout.write(`${JSON.stringify({ dryRun: true, items })}\n`);
    return;
  }

  ctx.stdout.write(`\n  ${bold('Dry run')} — would push:\n\n`);

  const maxKeyLen = Math.max(...missing.map((m) => m.key.length));

  for (const m of missing) {
    const targets = m.missingFrom.map((t) => formatTarget(t.provider, t.target)).join(', ');
    ctx.stdout.write(`    ${m.key.padEnd(maxKeyLen)}  → ${targets}\n`);
  }

  ctx.stdout.write(
    `\n  ${missing.length} secret${missing.length !== 1 ? 's' : ''} would be pushed.\n\n`,
  );
}

// ── Force push ───────────────────────────────────────────────────────────────

async function forcePush(
  ctx: CliContext,
  missing: MissingSecret[],
  secretValues: Record<string, string>,
  opts: PushCommandOptions,
): Promise<void> {
  const allResults: PushResult[] = [];

  if (!opts.quiet && !opts.json) {
    ctx.stdout.write(
      `\n  Pushing ${missing.length} secret${missing.length !== 1 ? 's' : ''}...\n\n`,
    );
  }

  for (const m of missing) {
    const value = secretValues[m.key];
    for (const { provider: providerName, target } of m.missingFrom) {
      const provider = getProvider(providerName);
      const results = await provider.pushSecrets({ [m.key]: value }, target);
      allResults.push(...results);

      if (!opts.quiet && !opts.json) {
        for (const r of results) {
          const icon = r.status === 'ok' ? green('✓') : red('✗');
          const targetDisplay = formatTarget(r.provider, r.target);
          ctx.stdout.write(
            `  ${icon} ${r.key} → ${targetDisplay}${r.error ? ` (${r.error})` : ''}\n`,
          );
        }
      }
    }
  }

  if (opts.json) {
    const ok = allResults.filter((r) => r.status === 'ok').length;
    const errors = allResults.filter((r) => r.status === 'error').length;
    ctx.stdout.write(`${JSON.stringify({ pushed: allResults, ok, errors })}\n`);
  } else if (!opts.quiet) {
    const ok = allResults.filter((r) => r.status === 'ok').length;
    const errors = allResults.filter((r) => r.status === 'error').length;

    ctx.stdout.write('\n');
    if (ok > 0) {
      ctx.stdout.write(`  ${green('✓')} ${ok} secret${ok !== 1 ? 's' : ''} pushed successfully\n`);
    }
    if (errors > 0) {
      ctx.stdout.write(`  ${red('✗')} ${errors} push${errors !== 1 ? 'es' : ''} failed\n`);
    }
    ctx.stdout.write('\n');
  }

  const hasErrors = allResults.some((r) => r.status === 'error');
  if (hasErrors) {
    ctx.exit(1);
  }
}

// ── Interactive push (Ink TUI) ───────────────────────────────────────────────

async function interactivePush(
  ctx: CliContext,
  projectRoot: string,
  config: ReturnType<typeof loadConfig>,
  opts: PushCommandOptions,
): Promise<void> {
  // Dynamic import of ink to avoid loading it for non-interactive paths
  const { render } = await import('ink');

  let wizardExitCode = 0;

  const loadData = async (): Promise<PushLoadResult> => {
    const checkResult = await runCheck(projectRoot, config);
    const available = checkResult.providers.filter((p) => p.available);

    const allTargets = available.flatMap((p) => {
      const provider = getProvider(p.provider);
      return provider.targets().map((t) => ({
        provider: p.provider,
        target: t,
        displayName: formatTarget(p.provider, t),
      }));
    });

    return { checkResult, allTargets };
  };

  const pushFn = async (
    secrets: Record<string, string>,
    providerName: ProviderName,
    target: string,
  ) => {
    const provider = getProvider(providerName);
    return provider.pushSecrets(secrets, target);
  };

  const element = createElement(PushWizard, {
    loadData,
    pushFn,
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
