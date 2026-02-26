import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli-main.js';
import type { CliContext } from '../src/types.js';

function createMockContext(argv: string[] = []): CliContext & { output: string; errors: string } {
  let output = '';
  let errors = '';
  return {
    argv,
    env: {},
    stdout: {
      write: (str: string) => {
        output += str;
        return true;
      },
      on: vi.fn(),
    } as unknown as CliContext['stdout'],
    stderr: {
      write: (str: string) => {
        errors += str;
        return true;
      },
      on: vi.fn(),
    } as unknown as CliContext['stderr'],
    exit: vi.fn(),
    cwd: () => '/tmp',
    get output() {
      return output;
    },
    get errors() {
      return errors;
    },
  };
}

describe('CLI', () => {
  it('--version outputs a semver string', async () => {
    const ctx = createMockContext(['--version']);
    await runCli(ctx);
    expect(ctx.output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--help shows program description and commands', async () => {
    const ctx = createMockContext(['--help']);
    await runCli(ctx);
    expect(ctx.output).toContain('envguard');
    expect(ctx.output).toContain('check');
    expect(ctx.output).toContain('push');
    expect(ctx.output).toContain('delete');
    expect(ctx.output).toContain('hook');
    expect(ctx.output).toContain('config');
  });

  it('check command (default) runs check', async () => {
    const ctx = createMockContext([]);
    await runCli(ctx);
    // No longer a stub — the check command runs and outputs results or errors
    // With cwd=/tmp and no providers, it should write an error to stderr
    expect(ctx.errors).toContain('No providers detected');
    expect(ctx.exit).toHaveBeenCalledWith(2);
  });

  it('push command runs push', async () => {
    const ctx = createMockContext(['push']);
    await runCli(ctx);
    // With cwd=/tmp and no providers, it should write an error to stderr
    expect(ctx.errors).toContain('No providers detected');
    expect(ctx.exit).toHaveBeenCalledWith(2);
  });

  it('delete command prints stub message', async () => {
    const ctx = createMockContext(['delete']);
    await runCli(ctx);
    expect(ctx.output).toContain('not yet implemented');
  });
});
