import type { Provider, ProviderName } from './types.js';

const providers = new Map<ProviderName, Provider>();

export function registerProvider(provider: Provider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: ProviderName): Provider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getProviders(names: ProviderName[]): Provider[] {
  return names.map(getProvider);
}

export function getAllProviders(): Provider[] {
  return [...providers.values()];
}

/** Reset registry — for testing only. */
export function _resetRegistry(): void {
  providers.clear();
}
