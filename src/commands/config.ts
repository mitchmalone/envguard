import { createElement } from 'react';
import { detectProviders } from '../core/detector.js';
import { discoverEnvFiles } from '../core/env-parser.js';
import type { CliContext, Config, ProviderName } from '../types.js';
import type { ConfigWizardResult } from '../ui/ConfigWizard.js';
import { getProjectRoot, loadConfig } from '../utils/config.js';
import { bold, configureColors, dim, green, yellow } from '../utils/terminal.js';

export interface ConfigShowOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: string;
}

export interface ConfigInitOptions {
  color?: string;
}

function resolveColorFlag(mode: string | undefined): boolean | undefined {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return undefined;
}

export async function configShowCommand(ctx: CliContext, opts: ConfigShowOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color),
  });

  const projectRoot = getProjectRoot(ctx.cwd());
  const config = loadConfig(projectRoot);

  // JSON output
  if (opts.json) {
    if (config) {
      ctx.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    } else {
      // Show auto-detected settings as JSON
      const envFiles = discoverEnvFiles(projectRoot).map((f) => {
        const parts = f.split('/');
        return parts[parts.length - 1];
      });
      const providers = detectProviders(projectRoot);
      ctx.stdout.write(
        `${JSON.stringify({ configured: false, detected: { envFiles, providers, ignore: [] } }, null, 2)}\n`,
      );
    }
    return;
  }

  ctx.stdout.write('\n');
  ctx.stdout.write(`  ${bold('envguard')} · configuration\n`);
  ctx.stdout.write('\n');

  if (config) {
    ctx.stdout.write(`  ${green('✓')} .envguard.json found\n`);
    ctx.stdout.write('\n');

    // Env files
    const envFiles = config.envFiles;
    if (envFiles && envFiles.length > 0) {
      ctx.stdout.write(`  ${bold('Env files:')} ${envFiles.join(', ')}\n`);
    } else {
      ctx.stdout.write(`  ${bold('Env files:')} ${dim('(auto-detect)')}\n`);
    }

    // Providers
    const providers = config.providers;
    if (providers && providers.length > 0) {
      ctx.stdout.write(`  ${bold('Providers:')} ${providers.join(', ')}\n`);
    } else {
      ctx.stdout.write(`  ${bold('Providers:')} ${dim('(auto-detect)')}\n`);
    }

    // Ignored keys
    const ignore = config.ignore;
    if (ignore && ignore.length > 0) {
      ctx.stdout.write(`  ${bold('Ignored:')}   ${ignore.join(', ')}\n`);
    } else {
      ctx.stdout.write(`  ${bold('Ignored:')}   ${dim('(none)')}\n`);
    }

    // Env mapping
    const mapping = config.envMapping;
    if (mapping && Object.keys(mapping).length > 0) {
      ctx.stdout.write(`  ${bold('Env mapping:')}\n`);
      for (const [file, target] of Object.entries(mapping)) {
        ctx.stdout.write(`    ${file} → ${target}\n`);
      }
    }
  } else {
    ctx.stdout.write(`  ${yellow('⚠')} No .envguard.json found\n`);
    ctx.stdout.write('\n');

    // Show auto-detected settings
    const envFiles = discoverEnvFiles(projectRoot);
    const envFileNames = envFiles.map((f) => {
      const parts = f.split('/');
      return parts[parts.length - 1];
    });
    const providers = detectProviders(projectRoot);

    if (envFileNames.length > 0) {
      ctx.stdout.write(`  ${bold('Detected env files:')} ${envFileNames.join(', ')}\n`);
    } else {
      ctx.stdout.write(`  ${bold('Detected env files:')} ${dim('(none)')}\n`);
    }

    if (providers.length > 0) {
      ctx.stdout.write(`  ${bold('Detected providers:')} ${providers.join(', ')}\n`);
    } else {
      ctx.stdout.write(`  ${bold('Detected providers:')} ${dim('(none)')}\n`);
    }

    ctx.stdout.write('\n');
    ctx.stdout.write(`  Run ${bold('envguard config init')} to create a config file.\n`);
  }

  ctx.stdout.write('\n');
}

export async function configInitCommand(ctx: CliContext, opts: ConfigInitOptions): Promise<void> {
  configureColors({
    env: ctx.env,
    forceColor: resolveColorFlag(opts.color),
  });

  // Non-TTY check
  const isTTY = 'isTTY' in ctx.stdout && (ctx.stdout as { isTTY?: boolean }).isTTY;
  if (!isTTY) {
    ctx.stderr.write('Error: config init requires an interactive terminal.\n');
    ctx.exit(1);
    return;
  }

  const projectRoot = getProjectRoot(ctx.cwd());

  // Dynamic import to avoid loading Ink for non-interactive paths
  const { render } = await import('ink');
  const { ConfigWizard } = await import('../ui/ConfigWizard.js');

  let wizardExitCode = 0;

  const existingConfig = loadConfig(projectRoot);

  // Discover env files and providers for the wizard
  const envFilePaths = discoverEnvFiles(projectRoot);
  const envFileNames = envFilePaths.map((f) => {
    const parts = f.split('/');
    return parts[parts.length - 1];
  });
  const detectedProviders = detectProviders(projectRoot);

  const element = createElement(ConfigWizard, {
    projectRoot,
    detectedEnvFiles: envFileNames,
    detectedProviders,
    existingConfig: existingConfig ?? undefined,
    onComplete: (_result: ConfigWizardResult) => {
      wizardExitCode = 0;
    },
    onCancel: () => {
      wizardExitCode = 1;
    },
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
