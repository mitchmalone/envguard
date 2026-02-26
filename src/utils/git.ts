import { execCommand } from './exec.js';

/**
 * Get the repository slug (owner/repo) for the current project.
 * Tries `gh repo view` first, falls back to parsing `git remote get-url origin`.
 */
export async function getRepoSlug(projectRoot: string): Promise<string | null> {
  // Try gh CLI first — most reliable
  const ghResult = await execCommand(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    { cwd: projectRoot },
  );
  if (ghResult.exitCode === 0 && ghResult.stdout.trim()) {
    return ghResult.stdout.trim();
  }

  // Fall back to git remote
  const gitResult = await execCommand('git', ['remote', 'get-url', 'origin'], {
    cwd: projectRoot,
  });
  if (gitResult.exitCode !== 0 || !gitResult.stdout.trim()) {
    return null;
  }

  return parseRemoteUrl(gitResult.stdout.trim());
}

/**
 * Parse a git remote URL into owner/repo format.
 * Handles SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
 */
export function parseRemoteUrl(url: string): string | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}
