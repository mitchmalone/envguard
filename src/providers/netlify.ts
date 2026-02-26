import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execCommand } from '../utils/exec.js';
import type { PrerequisiteResult, Provider, ProviderName, PushResult } from './types.js';

/** Parse the JSON output from `netlify env:list --json`. */
export function parseEnvListOutput(stdout: string): string[] {
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((e: { key: string }) => e.key);
}

class NetlifyProvider implements Provider {
  readonly name: ProviderName = 'netlify';
  readonly displayName = 'Netlify';

  async detect(projectRoot: string): Promise<boolean> {
    return (
      existsSync(join(projectRoot, 'netlify.toml')) || existsSync(join(projectRoot, '.netlify'))
    );
  }

  targets(): string[] {
    return ['all'];
  }

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    // Check netlify CLI exists
    const version = await execCommand('netlify', ['--version']);
    if (version.exitCode === 127) {
      return {
        ok: false,
        missing: 'netlify CLI',
        fix: 'Install the Netlify CLI: `npm i -g netlify-cli` or `pnpm add -g netlify-cli`',
      };
    }

    // Check auth: `netlify status` succeeds
    const status = await execCommand('netlify', ['status']);
    if (status.exitCode !== 0) {
      return {
        ok: false,
        missing: 'Netlify authentication',
        fix: 'Run `netlify login` to authenticate with Netlify',
      };
    }

    // Check site is linked: .netlify/state.json exists
    const stateJson = join(process.cwd(), '.netlify', 'state.json');
    if (!existsSync(stateJson)) {
      return {
        ok: false,
        missing: 'Netlify site link',
        fix: 'Run `netlify link` to link this directory to a Netlify site',
      };
    }

    return { ok: true };
  }

  async listRemoteKeys(target: string): Promise<string[]> {
    const args = ['env:list', '--json'];

    const result = await execCommand('netlify', args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list Netlify ${target} env vars: ${result.stderr}`);
    }

    return parseEnvListOutput(result.stdout);
  }

  async pushSecrets(secrets: Record<string, string>, target: string): Promise<PushResult[]> {
    const results: PushResult[] = [];

    for (const [key, value] of Object.entries(secrets)) {
      const args = ['env:set', key, value];

      const result = await execCommand('netlify', args);
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
      const args = ['env:unset', key];

      const result = await execCommand('netlify', args);
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

export const netlifyProvider = new NetlifyProvider();

/** Reset Netlify provider state — for testing only. */
export function _resetNetlifyProvider(): void {
  // No cached state currently, but kept for consistency with other providers
}
