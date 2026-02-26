import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ProviderName } from '../types.js';

interface ProviderDetection {
  name: ProviderName;
  indicators: string[];
}

const PROVIDER_DETECTIONS: ProviderDetection[] = [
  {
    name: 'github',
    indicators: ['.github'],
  },
  {
    name: 'vercel',
    indicators: ['vercel.json', '.vercel'],
  },
  {
    name: 'netlify',
    indicators: ['netlify.toml', '.netlify'],
  },
];

/**
 * Auto-detect providers based on project config files.
 * If configProviders is provided (from .envguard.json), use those instead of auto-detection.
 */
export function detectProviders(
  projectRoot: string,
  configProviders?: ProviderName[],
): ProviderName[] {
  if (configProviders && configProviders.length > 0) {
    return configProviders;
  }

  const root = resolve(projectRoot);
  const detected: ProviderName[] = [];

  for (const detection of PROVIDER_DETECTIONS) {
    const found = detection.indicators.some((indicator) => existsSync(join(root, indicator)));
    if (found) {
      detected.push(detection.name);
    }
  }

  return detected;
}
