import type { CliContext } from '../types.js';

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function setupEpipeHandler(ctx: Pick<CliContext, 'stdout' | 'stderr' | 'exit'>): void {
  const handleEpipe = (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      ctx.exit(0);
      return;
    }
    throw err;
  };

  ctx.stdout.on('error', handleEpipe);
  ctx.stderr.on('error', handleEpipe);
}

export function setupSignalHandlers(
  ctx: Pick<CliContext, 'stderr' | 'exit'>,
  processObj: NodeJS.Process,
): void {
  const handler = (signal: string) => {
    ctx.stderr.write(`\nReceived ${signal}. Exiting gracefully...\n`);
    ctx.exit(130);
  };

  processObj.on('SIGINT', () => handler('SIGINT'));
  processObj.on('SIGTERM', () => handler('SIGTERM'));
}
