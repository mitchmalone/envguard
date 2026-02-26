import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execCommand } from '../utils/exec.js';
import { getRepoSlug } from '../utils/git.js';
import type { PrerequisiteResult, Provider, ProviderName, PushResult } from './types.js';

/** Validate that a secret name is valid for GitHub Actions/Codespaces. */
export function validateSecretName(name: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return `Invalid secret name "${name}": must contain only alphanumeric characters and underscores, and cannot start with a number`;
  }
  if (name.startsWith('GITHUB_')) {
    return `Invalid secret name "${name}": cannot start with GITHUB_ prefix (reserved by GitHub)`;
  }
  return null;
}

function targetFlag(target: string): string[] {
  return target === 'codespaces' ? ['--app', 'codespaces'] : [];
}

class GitHubProvider implements Provider {
  readonly name: ProviderName = 'github';
  readonly displayName = 'GitHub';

  private repoSlug: string | null = null;

  async detect(projectRoot: string): Promise<boolean> {
    return existsSync(join(projectRoot, '.github'));
  }

  targets(): string[] {
    return ['actions', 'codespaces'];
  }

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    // Check gh CLI exists
    const ghVersion = await execCommand('gh', ['--version']);
    if (ghVersion.exitCode === 127) {
      return {
        ok: false,
        missing: 'gh CLI',
        fix: 'Install the GitHub CLI: https://cli.github.com/ or `brew install gh`',
      };
    }

    // Check gh is authenticated
    const authStatus = await execCommand('gh', ['auth', 'status']);
    if (authStatus.exitCode !== 0) {
      return {
        ok: false,
        missing: 'GitHub authentication',
        fix: 'Run `gh auth login` to authenticate with GitHub',
      };
    }

    return { ok: true };
  }

  async listRemoteKeys(target: string): Promise<string[]> {
    const repo = await this.getRepo();
    const args = ['secret', 'list', '--repo', repo, '--json', 'name'];
    args.push(...targetFlag(target));

    const result = await execCommand('gh', args);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list ${target} secrets: ${result.stderr}`);
    }

    const parsed = JSON.parse(result.stdout) as Array<{ name: string }>;
    return parsed.map((s) => s.name);
  }

  async pushSecrets(secrets: Record<string, string>, target: string): Promise<PushResult[]> {
    const repo = await this.getRepo();
    const results: PushResult[] = [];

    for (const [key, value] of Object.entries(secrets)) {
      const validationError = validateSecretName(key);
      if (validationError) {
        results.push({
          key,
          provider: this.name,
          target,
          status: 'error',
          error: validationError,
        });
        continue;
      }

      const args = ['secret', 'set', key, '--body', value, '--repo', repo];
      args.push(...targetFlag(target));

      const result = await execCommand('gh', args);
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
    const repo = await this.getRepo();
    const results: PushResult[] = [];

    for (const key of keys) {
      const args = ['secret', 'delete', key, '--repo', repo];
      args.push(...targetFlag(target));

      const result = await execCommand('gh', args);
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

  private async getRepo(): Promise<string> {
    if (this.repoSlug) {
      return this.repoSlug;
    }
    const slug = await getRepoSlug(process.cwd());
    if (!slug) {
      throw new Error(
        'Could not determine GitHub repository. Run this command from a git repo with a GitHub remote.',
      );
    }
    this.repoSlug = slug;
    return slug;
  }
}

export const githubProvider = new GitHubProvider();

/** Reset cached repo slug — for testing only. */
export function _resetGitHubProvider(): void {
  (githubProvider as unknown as { repoSlug: string | null }).repoSlug = null;
}
