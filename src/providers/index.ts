import { githubProvider } from './github.js';
import { registerProvider } from './registry.js';
import { vercelProvider } from './vercel.js';

// Register all built-in providers
registerProvider(githubProvider);
registerProvider(vercelProvider);

export { getProvider, getProviders, getAllProviders } from './registry.js';
export { githubProvider } from './github.js';
export { vercelProvider } from './vercel.js';
