import { getProvider } from '../providers/registry.js';
import type {
  CheckResult,
  Config,
  MissingSecret,
  Provider,
  ProviderName,
  ProviderStatus,
  RemoteKeyInfo,
  SecretEntry,
} from '../types.js';
import { detectProviders } from './detector.js';
import { loadSecrets } from './env-parser.js';

/**
 * Compare local secrets against remote provider keys.
 * Returns missing secrets — keys that exist locally but not on some provider/target.
 */
export function compareSecrets(
  localSecrets: SecretEntry[],
  remoteKeys: RemoteKeyInfo[],
): MissingSecret[] {
  // De-dup local keys — use first occurrence for source
  const seen = new Set<string>();
  const uniqueSecrets: SecretEntry[] = [];
  for (const secret of localSecrets) {
    if (!seen.has(secret.key)) {
      seen.add(secret.key);
      uniqueSecrets.push(secret);
    }
  }

  const missing: MissingSecret[] = [];

  for (const secret of uniqueSecrets) {
    const missingFrom: Array<{ provider: ProviderName; target: string }> = [];

    for (const remote of remoteKeys) {
      if (!remote.keys.includes(secret.key)) {
        missingFrom.push({ provider: remote.provider, target: remote.target });
      }
    }

    if (missingFrom.length > 0) {
      missing.push({
        key: secret.key,
        source: secret.source,
        missingFrom,
      });
    }
  }

  return missing;
}

/**
 * Run the full check: load secrets, detect providers, list remote keys, compare.
 */
export async function runCheck(projectRoot: string, config: Config | null): Promise<CheckResult> {
  const localSecrets = loadSecrets(projectRoot, config ?? undefined);
  const providerNames = detectProviders(projectRoot, config?.providers);

  const remoteKeys: RemoteKeyInfo[] = [];
  const providers: ProviderStatus[] = [];

  for (const name of providerNames) {
    let provider: Provider;
    try {
      provider = getProvider(name);
    } catch {
      providers.push({
        provider: name,
        displayName: name,
        available: false,
        error: `Provider "${name}" is not registered`,
      });
      continue;
    }

    const prereq = await provider.checkPrerequisites();
    if (!prereq.ok) {
      providers.push({
        provider: name,
        displayName: provider.displayName,
        available: false,
        error: prereq.missing,
        fix: prereq.fix,
      });
      continue;
    }

    providers.push({
      provider: name,
      displayName: provider.displayName,
      available: true,
    });

    for (const target of provider.targets()) {
      try {
        const keys = await provider.listRemoteKeys(target);
        remoteKeys.push({ provider: name, target, keys });
      } catch {
        // Target listing failed — skip it so we don't produce false positives
      }
    }
  }

  const missing = compareSecrets(localSecrets, remoteKeys);

  return {
    localSecrets,
    remoteKeys,
    providers,
    missing,
    allSynced: missing.length === 0,
  };
}
