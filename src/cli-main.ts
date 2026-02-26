import { createRequire } from 'node:module';
import { Command, CommanderError } from 'commander';
import { checkCommand } from './commands/check.js';
import { configInitCommand, configShowCommand } from './commands/config.js';
import { deleteCommand } from './commands/delete.js';
import { hookInstallCommand, hookRemoveCommand } from './commands/hook.js';
import { pushCommand } from './commands/push.js';
import './providers/index.js';
import type { CliContext } from './types.js';
import { CliError, setupEpipeHandler } from './utils/errors.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export async function runCli(ctx: CliContext): Promise<void> {
  setupEpipeHandler(ctx);

  const program = new Command();

  program
    .name('envguard')
    .description('Guards your environment secrets. Catches missing env vars before your CI does.')
    .version(pkg.version)
    .exitOverride()
    .configureOutput({
      writeOut: (str) => ctx.stdout.write(str),
      writeErr: (str) => ctx.stderr.write(str),
    });

  program.option('--color <mode>', 'control color output (auto|always|never)', 'auto');
  program.option('--json', 'machine-readable JSON output');
  program.option('-q, --quiet', 'suppress non-essential output');
  program.option('-v, --verbose', 'extra debug information');

  program
    .command('check', { isDefault: true })
    .description('compare local .env keys against remote providers')
    .action(async () => {
      const opts = program.opts();
      await checkCommand(ctx, {
        json: opts.json,
        quiet: opts.quiet,
        verbose: opts.verbose,
        color: opts.color,
      });
    });

  program
    .command('push')
    .description('interactive push secrets to remote providers')
    .option('--force', 'skip confirmation, push all missing secrets')
    .option('--dry-run', 'show what would be pushed without pushing')
    .action(async (cmdOpts) => {
      const globalOpts = program.opts();
      await pushCommand(ctx, {
        force: cmdOpts.force,
        dryRun: cmdOpts.dryRun,
        json: globalOpts.json,
        quiet: globalOpts.quiet,
        verbose: globalOpts.verbose,
        color: globalOpts.color,
      });
    });

  program
    .command('delete')
    .description('delete secrets from remote providers')
    .option('--provider <name>', 'which provider to delete from')
    .option('--target <target>', 'which target (e.g., "actions", "production")')
    .option('--keys <keys>', 'comma-separated keys to delete')
    .option('--yes', 'skip confirmation')
    .option('--all', 'delete all local .env keys from the provider')
    .option('--dry-run', 'show what would be deleted')
    .action(async (cmdOpts) => {
      const globalOpts = program.opts();
      await deleteCommand(ctx, {
        provider: cmdOpts.provider,
        target: cmdOpts.target,
        keys: cmdOpts.keys,
        yes: cmdOpts.yes,
        all: cmdOpts.all,
        dryRun: cmdOpts.dryRun,
        json: globalOpts.json,
        quiet: globalOpts.quiet,
        verbose: globalOpts.verbose,
        color: globalOpts.color,
      });
    });

  const hookCmd = program.command('hook').description('manage git pre-push hook');

  hookCmd
    .command('install')
    .description('install git pre-push hook')
    .option('--force', 'overwrite existing non-envguard hook')
    .action(async (cmdOpts) => {
      const globalOpts = program.opts();
      await hookInstallCommand(ctx, {
        force: cmdOpts.force,
        color: globalOpts.color,
      });
    });

  hookCmd
    .command('remove')
    .description('remove git pre-push hook')
    .option('--force', 'remove even if not an envguard hook')
    .action(async (cmdOpts) => {
      const globalOpts = program.opts();
      await hookRemoveCommand(ctx, {
        force: cmdOpts.force,
        color: globalOpts.color,
      });
    });

  const configCmd = program.command('config').description('manage project configuration');

  configCmd
    .command('show', { isDefault: true })
    .description('show current configuration')
    .action(async () => {
      const globalOpts = program.opts();
      await configShowCommand(ctx, {
        json: globalOpts.json,
        quiet: globalOpts.quiet,
        verbose: globalOpts.verbose,
        color: globalOpts.color,
      });
    });

  configCmd
    .command('init')
    .description('create .envguard.json interactively')
    .action(async () => {
      const globalOpts = program.opts();
      await configInitCommand(ctx, {
        color: globalOpts.color,
      });
    });

  try {
    await program.parseAsync(ctx.argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        return;
      }
      ctx.stderr.write(`${err.message}\n`);
      ctx.exit(1);
      return;
    }

    if (err instanceof CliError) {
      ctx.stderr.write(`Error: ${err.message}\n`);
      ctx.exit(err.exitCode);
      return;
    }

    if (err instanceof Error) {
      ctx.stderr.write(`Unexpected error: ${err.message}\n`);
    }
    ctx.exit(1);
  }
}
