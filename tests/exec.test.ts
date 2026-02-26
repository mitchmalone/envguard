import { describe, expect, it } from 'vitest';
import { commandExists, execCommand } from '../src/utils/exec.js';

describe('execCommand', () => {
  it('runs a successful command', async () => {
    const result = await execCommand('echo', ['hello world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  it('returns exit code for failing command', async () => {
    const result = await execCommand('ls', ['/nonexistent_path_xyz_12345']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });

  it('handles command not found gracefully', async () => {
    const result = await execCommand('nonexistent_command_xyz_12345', []);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  it('captures stdout and stderr separately', async () => {
    // Use node -e to write to both stdout and stderr
    const result = await execCommand('node', [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err")',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  it('supports cwd option', async () => {
    const result = await execCommand('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    // /tmp might resolve to /private/tmp on macOS
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });
});

describe('commandExists', () => {
  it('returns true for an existing command', async () => {
    expect(await commandExists('echo')).toBe(true);
  });

  it('returns false for a missing command', async () => {
    expect(await commandExists('nonexistent_command_xyz_12345')).toBe(false);
  });
});
