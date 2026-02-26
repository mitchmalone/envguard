import type { WriteStream } from 'node:tty';
import { z } from 'zod';

// ── CLI Context (from spec-01) ──────────────────────────────────────────────

export interface CliContext {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: WriteStream | NodeJS.WriteStream;
  stderr: WriteStream | NodeJS.WriteStream;
  exit: (code: number) => void;
  cwd: () => string;
}

export type OutputFormat = 'text' | 'json';

// ── Provider Names ──────────────────────────────────────────────────────────

export const providerNameSchema = z.enum(['github', 'vercel', 'netlify']);
export type ProviderName = z.infer<typeof providerNameSchema>;

// ── Config (.envguard.json) ─────────────────────────────────────────────────

export const configSchema = z.object({
  envFiles: z.array(z.string()).optional(),
  providers: z.array(providerNameSchema).optional(),
  ignore: z.array(z.string()).optional(),
  envMapping: z.record(z.string(), z.string()).optional(),
});

export type Config = z.infer<typeof configSchema>;

// ── Secrets & Env Files ─────────────────────────────────────────────────────

export interface SecretEntry {
  key: string;
  value: string;
  source: string; // source .env file path
}

export interface EnvFile {
  path: string;
  filename: string;
  secrets: Record<string, string>;
}

// ── Check / Diff Results ────────────────────────────────────────────────────

export interface MissingSecret {
  key: string;
  source: string; // which .env file it comes from
  missingFrom: Array<{ provider: ProviderName; target: string }>;
}

export interface CheckResult {
  localSecrets: SecretEntry[];
  remoteKeys: Record<string, string[]>; // provider → keys
  missing: MissingSecret[];
  allSynced: boolean;
}

// ── Push Results ────────────────────────────────────────────────────────────

export interface PushResult {
  key: string;
  provider: ProviderName;
  target: string;
  status: 'ok' | 'error';
  error?: string;
}

// ── Prerequisites ───────────────────────────────────────────────────────────

export interface PrerequisiteResult {
  ok: boolean;
  missing?: string;
  fix?: string;
}

// ── Provider Interface ──────────────────────────────────────────────────────

export interface Provider {
  name: ProviderName;
  displayName: string;
  detect(projectRoot: string): Promise<boolean>;
  targets(): string[];
  listRemoteKeys(target: string): Promise<string[]>;
  pushSecrets(secrets: Record<string, string>, target: string): Promise<PushResult[]>;
  deleteSecrets(keys: string[], target: string): Promise<PushResult[]>;
  checkPrerequisites(): Promise<PrerequisiteResult>;
}
