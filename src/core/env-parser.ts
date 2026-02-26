import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Config, SecretEntry } from '../types.js';

const DEFAULT_ENV_PATTERNS = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.staging',
];

/**
 * Discover .env files in the project root.
 * If configEnvFiles is provided, use those paths; otherwise scan for common patterns.
 */
export function discoverEnvFiles(projectRoot: string, configEnvFiles?: string[]): string[] {
  const root = resolve(projectRoot);

  if (configEnvFiles && configEnvFiles.length > 0) {
    return configEnvFiles.map((f) => join(root, f)).filter((f) => existsSync(f));
  }

  // Scan project root for files matching .env patterns
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .filter((name) => DEFAULT_ENV_PATTERNS.includes(name))
    .sort()
    .map((name) => join(root, name));
}

/**
 * Parse a .env file into a key-value record.
 * Handles:
 * - Empty lines and comments (# prefix)
 * - KEY=value (unquoted)
 * - KEY="value" (double-quoted, preserves inner spaces)
 * - KEY='value' (single-quoted, preserves inner spaces)
 * - KEY= (empty value)
 * - export KEY=value (export prefix)
 * - Inline comments for unquoted values
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    // Strip optional 'export ' prefix
    const stripped = line.startsWith('export ') ? line.slice(7) : line;

    // Find the first '='
    const eqIndex = stripped.indexOf('=');
    if (eqIndex === -1) continue;

    const key = stripped.slice(0, eqIndex).trim();
    if (key === '') continue;

    let value = stripped.slice(eqIndex + 1);

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      // Remove surrounding quotes
      value = value.slice(1, -1);
    } else {
      // For unquoted values, strip inline comments
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex);
      }
      value = value.trim();
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load all secrets from discovered .env files.
 * Returns a flat array of SecretEntry objects.
 */
export function loadSecrets(projectRoot: string, config?: Config): SecretEntry[] {
  const files = discoverEnvFiles(projectRoot, config?.envFiles);
  const ignoreSet = new Set(config?.ignore ?? []);
  const secrets: SecretEntry[] = [];

  for (const filePath of files) {
    const parsed = parseEnvFile(filePath);
    const source = basename(filePath);

    for (const [key, value] of Object.entries(parsed)) {
      if (ignoreSet.has(key)) continue;
      secrets.push({ key, value, source });
    }
  }

  return secrets;
}
