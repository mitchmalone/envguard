import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { findDuplicateKeys } from '../src/core/comparator.js';
import type { CheckResult, CliContext, SecretEntry } from '../src/types.js';
import { CliError, setupSignalHandlers } from '../src/utils/errors.js';

// ── findDuplicateKeys ────────────────────────────────────────────────────

describe('findDuplicateKeys', () => {
  it('returns empty for unique keys', () => {
    const secrets: SecretEntry[] = [
      { key: 'A', value: '1', source: '.env' },
      { key: 'B', value: '2', source: '.env' },
    ];
    expect(findDuplicateKeys(secrets)).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(findDuplicateKeys([])).toHaveLength(0);
  });

  it('detects duplicate keys across files', () => {
    const secrets: SecretEntry[] = [
      { key: 'A', value: '1', source: '.env' },
      { key: 'A', value: '2', source: '.env.local' },
      { key: 'B', value: '3', source: '.env' },
    ];
    const dupes = findDuplicateKeys(secrets);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].key).toBe('A');
    expect(dupes[0].sources).toContain('.env');
    expect(dupes[0].sources).toContain('.env.local');
  });

  it('does not flag same key in same file as duplicate', () => {
    const secrets: SecretEntry[] = [
      { key: 'A', value: '1', source: '.env' },
      { key: 'A', value: '2', source: '.env' },
    ];
    expect(findDuplicateKeys(secrets)).toHaveLength(0);
  });

  it('detects multiple duplicate keys', () => {
    const secrets: SecretEntry[] = [
      { key: 'A', value: '1', source: '.env' },
      { key: 'A', value: '2', source: '.env.local' },
      { key: 'B', value: '3', source: '.env' },
      { key: 'B', value: '4', source: '.env.production' },
    ];
    const dupes = findDuplicateKeys(secrets);
    expect(dupes).toHaveLength(2);
    expect(dupes.map((d) => d.key).sort()).toEqual(['A', 'B']);
  });
});

// ── setupSignalHandlers ──────────────────────────────────────────────────

describe('setupSignalHandlers', () => {
  it('registers SIGINT and SIGTERM handlers', () => {
    const exit = vi.fn();
    const stderrWrite = vi.fn().mockReturnValue(true);

    const ctx = {
      stderr: { write: stderrWrite } as unknown as NodeJS.WriteStream,
      exit,
    };

    const processOn = vi.fn();
    const mockProcess = { on: processOn } as unknown as NodeJS.Process;

    setupSignalHandlers(ctx, mockProcess);

    expect(processOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('calls exit(130) on SIGINT', () => {
    const exit = vi.fn();
    const stderrWrite = vi.fn().mockReturnValue(true);

    const ctx = {
      stderr: { write: stderrWrite } as unknown as NodeJS.WriteStream,
      exit,
    };

    const processOn = vi.fn();
    const mockProcess = { on: processOn } as unknown as NodeJS.Process;

    setupSignalHandlers(ctx, mockProcess);

    const sigintHandler = processOn.mock.calls.find((c) => c[0] === 'SIGINT')?.[1] as () => void;
    sigintHandler();

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('calls exit(130) on SIGTERM', () => {
    const exit = vi.fn();
    const stderrWrite = vi.fn().mockReturnValue(true);

    const ctx = {
      stderr: { write: stderrWrite } as unknown as NodeJS.WriteStream,
      exit,
    };

    const processOn = vi.fn();
    const mockProcess = { on: processOn } as unknown as NodeJS.Process;

    setupSignalHandlers(ctx, mockProcess);

    const handler = processOn.mock.calls.find((c) => c[0] === 'SIGTERM')?.[1] as () => void;
    handler();

    expect(stderrWrite).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(130);
  });
});

// ── Error message polish tests ─────────────────────────────────────────

describe('error message polish', () => {
  // Test that polished error messages are imported correctly
  // The actual integration tests are in check.test.ts, push-command.test.ts, etc.

  it('CliError preserves message and exit code', () => {
    const err = new CliError('no providers found', 2);
    expect(err.message).toBe('no providers found');
    expect(err.exitCode).toBe(2);
    expect(err.name).toBe('CliError');
  });
});
