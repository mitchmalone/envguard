import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetRegistry,
  getAllProviders,
  getProvider,
  getProviders,
  registerProvider,
} from '../src/providers/registry.js';
import type { Provider } from '../src/providers/types.js';

function makeFakeProvider(name: 'github' | 'vercel' | 'netlify'): Provider {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    detect: async () => false,
    targets: () => ['default'],
    listRemoteKeys: async () => [],
    pushSecrets: async () => [],
    deleteSecrets: async () => [],
    checkPrerequisites: async () => ({ ok: true }),
  };
}

describe('Provider registry', () => {
  afterEach(() => {
    _resetRegistry();
  });

  it('registers and retrieves a provider', () => {
    const fake = makeFakeProvider('github');
    registerProvider(fake);
    expect(getProvider('github')).toBe(fake);
  });

  it('throws on unknown provider', () => {
    expect(() => getProvider('github')).toThrow('Unknown provider: github');
  });

  it('retrieves multiple providers by name', () => {
    const gh = makeFakeProvider('github');
    const vc = makeFakeProvider('vercel');
    registerProvider(gh);
    registerProvider(vc);

    const result = getProviders(['github', 'vercel']);
    expect(result).toEqual([gh, vc]);
  });

  it('throws if any provider in getProviders is missing', () => {
    const gh = makeFakeProvider('github');
    registerProvider(gh);
    expect(() => getProviders(['github', 'netlify'])).toThrow('Unknown provider: netlify');
  });

  it('getAllProviders returns all registered', () => {
    expect(getAllProviders()).toHaveLength(0);
    registerProvider(makeFakeProvider('github'));
    registerProvider(makeFakeProvider('vercel'));
    expect(getAllProviders()).toHaveLength(2);
  });

  it('overwrites a previously registered provider with the same name', () => {
    const first = makeFakeProvider('github');
    const second = makeFakeProvider('github');
    registerProvider(first);
    registerProvider(second);
    expect(getProvider('github')).toBe(second);
    expect(getAllProviders()).toHaveLength(1);
  });
});
