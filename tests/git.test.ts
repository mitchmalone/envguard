import { describe, expect, it } from 'vitest';
import { parseRemoteUrl } from '../src/utils/git.js';

describe('parseRemoteUrl', () => {
  it('parses SSH remote URL', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('parses SSH remote URL without .git suffix', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo')).toBe('owner/repo');
  });

  it('parses HTTPS remote URL', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses HTTPS remote URL without .git suffix', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo')).toBe('owner/repo');
  });

  it('handles org names with hyphens', () => {
    expect(parseRemoteUrl('git@github.com:my-org/my-repo.git')).toBe('my-org/my-repo');
  });

  it('handles HTTPS with hyphens', () => {
    expect(parseRemoteUrl('https://github.com/my-org/my-repo.git')).toBe('my-org/my-repo');
  });

  it('returns null for unrecognized format', () => {
    expect(parseRemoteUrl('not-a-url')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRemoteUrl('')).toBeNull();
  });
});
