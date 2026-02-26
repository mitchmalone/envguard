import { execFile } from 'node:child_process';

export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command and return its output.
 * Never throws — always returns an ExecResult with the exit code.
 */
export function execCommand(
  command: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options?.timeout,
        cwd: options?.cwd,
        env: options?.env as NodeJS.ProcessEnv,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
      (error, stdout, stderr) => {
        if (error) {
          // Command not found or other spawn error
          if ('code' in error && error.code === 'ENOENT') {
            resolve({
              stdout: '',
              stderr: `command not found: ${command}`,
              exitCode: 127,
            });
            return;
          }
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? error.message,
            exitCode: (error as NodeJS.ErrnoException & { status?: number }).status ?? 1,
          });
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 });
      },
    );

    // Pipe stdin if provided (used by providers that read values from stdin)
    if (options?.stdin !== undefined && child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

/**
 * Check if a command is available on the system PATH.
 */
export async function commandExists(command: string): Promise<boolean> {
  // Use `which` on Unix-like systems
  const result = await execCommand('which', [command]);
  return result.exitCode === 0;
}
