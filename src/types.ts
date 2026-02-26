import type { WriteStream } from 'node:tty';

export interface CliContext {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: WriteStream | NodeJS.WriteStream;
  stderr: WriteStream | NodeJS.WriteStream;
  exit: (code: number) => void;
  cwd: () => string;
}

export type OutputFormat = 'text' | 'json';
