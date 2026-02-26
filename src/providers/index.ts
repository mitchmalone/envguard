import { githubProvider } from './github.js';
import { registerProvider } from './registry.js';

// Register all built-in providers
registerProvider(githubProvider);

export { getProvider, getProviders, getAllProviders } from './registry.js';
export { githubProvider } from './github.js';
