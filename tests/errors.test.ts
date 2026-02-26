import { describe, expect, it, vi } from 'vitest';
import { CliError, setupEpipeHandler } from '../src/utils/errors.js';

describe('CliError', () => {
  it('has correct name and default exit code', () => {
    const err = new CliError('something broke');
    expect(err.name).toBe('CliError');
    expect(err.message).toBe('something broke');
    expect(err.exitCode).toBe(1);
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts custom exit code', () => {
    const err = new CliError('bad config', 2);
    expect(err.exitCode).toBe(2);
  });
});

describe('setupEpipeHandler', () => {
  it('calls exit(0) on EPIPE error', () => {
    const exit = vi.fn();
    const stdoutOn = vi.fn();
    const stderrOn = vi.fn();

    const ctx = {
      stdout: { on: stdoutOn } as unknown as NodeJS.WriteStream,
      stderr: { on: stderrOn } as unknown as NodeJS.WriteStream,
      exit,
    };

    setupEpipeHandler(ctx);

    expect(stdoutOn).toHaveBeenCalledWith('error', expect.any(Function));
    expect(stderrOn).toHaveBeenCalledWith('error', expect.any(Function));

    const handler = stdoutOn.mock.calls[0][1] as (err: NodeJS.ErrnoException) => void;

    const epipeErr = new Error('EPIPE') as NodeJS.ErrnoException;
    epipeErr.code = 'EPIPE';
    handler(epipeErr);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('re-throws non-EPIPE errors', () => {
    const exit = vi.fn();
    const stdoutOn = vi.fn();
    const stderrOn = vi.fn();

    const ctx = {
      stdout: { on: stdoutOn } as unknown as NodeJS.WriteStream,
      stderr: { on: stderrOn } as unknown as NodeJS.WriteStream,
      exit,
    };

    setupEpipeHandler(ctx);

    const handler = stdoutOn.mock.calls[0][1] as (err: NodeJS.ErrnoException) => void;

    const otherErr = new Error('other') as NodeJS.ErrnoException;
    otherErr.code = 'ENOTFOUND';
    expect(() => handler(otherErr)).toThrow('other');
    expect(exit).not.toHaveBeenCalled();
  });
});
