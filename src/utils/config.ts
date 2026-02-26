import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Config, configSchema } from '../types.js';

const CONFIG_FILENAME = '.envguard.json';

/**
 * Load and validate the .envguard.json config from the given project root.
 * Returns null if the file doesn't exist.
 * Throws if the file exists but is invalid JSON or fails schema validation.
 */
export function loadConfig(projectRoot: string): Config | null {
  const configPath = join(resolve(projectRoot), CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read ${CONFIG_FILENAME}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${CONFIG_FILENAME}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid ${CONFIG_FILENAME}:\n${issues}`);
  }

  return result.data;
}

/**
 * Get the project root directory by walking up from cwd looking for package.json.
 * Falls back to cwd if no package.json is found.
 */
export function getProjectRoot(startDir?: string): string {
  let dir = resolve(startDir ?? process.cwd());

  // Walk up to find package.json
  const root = dir.startsWith('/') ? '/' : dir.slice(0, 3);

  while (dir !== root) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Check root itself
  if (existsSync(join(dir, 'package.json'))) {
    return dir;
  }

  // Fallback to start dir
  return resolve(startDir ?? process.cwd());
}
