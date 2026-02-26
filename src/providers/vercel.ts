import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execCommand } from '../utils/exec.js';
import type { PrerequisiteResult, Provider, ProviderName, PushResult } from './types.js';

/** Parse the JSON output from `vercel env ls --json`. */
export function parseEnvListOutput(stdout: string): string[] {
  const data: unknown = JSON.parse(stdout);
  const envs: Array<{ key: string }> = Array.isArray(data)
    ? data
    : (((data as Record<string, unknown>).envs as Array<{ key: string }>) ?? []);
  return envs.map((e) => e.key);
}

function tokenArgs(): string[] {
  const args: string[] = [];
  if (process.env.VERCEL_TOKEN) {
    args.push('--token', process.env.VERCEL_TOKEN);
  }
  if (process.env.VERCEL_TEAM_ID) {
    args.push('--scope', process.env.VERCEL_TEAM_ID);
  }
  return args;
}

class VercelProvider implements Provider {
  readonly name: ProviderName = 'vercel';
  readonly displayName = 'Vercel';

  async detect(projectRoot: string): Promise<boolean> {
    return existsSync(join(projectRoot, 'vercel.json')) || existsSync(join(projectRoot, '.vercel'));
  }

  targets(): string[] {
    return ['production', 'preview', 'development'];
  }

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    // Check vercel CLI exists
    const version = await execCommand('vercel', ['--version']);
    if (version.exitCode === 127) {
      return {
        ok: false,
        missing: 'vercel CLI',
        fix: 'Install the Vercel CLI: `npm i -g vercel` or `pnpm add -g vercel`',
      };
    }

    // Check auth: VERCEL_TOKEN or `vercel whoami`
    if (!process.env.VERCEL_TOKEN) {
      const whoami = await execCommand('vercel', ['whoami']);
      if (whoami.exitCode !== 0) {
        return {
          ok: false,
          missing: 'Vercel authentication',
          fix: 'Run `vercel login` or set the VERCEL_TOKEN environment variable',
        };
      }
    }

    // Check project is linked (.vercel/project.json)
    const projectJson = join(process.cwd(), '.vercel', 'project.json');
    if (!existsSync(projectJson)) {
      return {
        ok: false,
        missing: 'Vercel project link',
        fix: 'Run `vercel link` to link this directory to a Vercel project',
      };
    }

    return { ok: true };
  }

  async listRemoteKeys(target: string): Promise<string[]> {
    const args = ['env', 'ls', target, '--json', ...tokenArgs()];

    const result = await execCommand('vercel', args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list Vercel ${target} env vars: ${result.stderr}`);
    }

    return parseEnvListOutput(result.stdout);
  }

  async pushSecrets(secrets: Record<string, string>, target: string): Promise<PushResult[]> {
    const results: PushResult[] = [];

    for (const [key, value] of Object.entries(secrets)) {
      const args = ['env', 'add', key, target, '--force', ...tokenArgs()];

      const result = await execCommand('vercel', args, { stdin: value });
      results.push({
        key,
        provider: this.name,
        target,
        status: result.exitCode === 0 ? 'ok' : 'error',
        error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
      });
    }

    return results;
  }

  async deleteSecrets(keys: string[], target: string): Promise<PushResult[]> {
    const results: PushResult[] = [];

    for (const key of keys) {
      const args = ['env', 'rm', key, target, '--yes', ...tokenArgs()];

      const result = await execCommand('vercel', args);
      results.push({
        key,
        provider: this.name,
        target,
        status: result.exitCode === 0 ? 'ok' : 'error',
        error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
      });
    }

    return results;
  }
}

export const vercelProvider = new VercelProvider();

/** Reset Vercel provider state — for testing only. */
export function _resetVercelProvider(): void {
  // No cached state currently, but kept for consistency with other providers
}
