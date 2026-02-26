import { describe, expect, it } from 'vitest';
import {
  type CheckResult,
  type Config,
  type EnvFile,
  type MissingSecret,
  type PrerequisiteResult,
  type ProviderName,
  type PushResult,
  type SecretEntry,
  configSchema,
  providerNameSchema,
} from '../src/types.js';

describe('Zod schemas', () => {
  describe('providerNameSchema', () => {
    it('accepts valid provider names', () => {
      expect(providerNameSchema.parse('github')).toBe('github');
      expect(providerNameSchema.parse('vercel')).toBe('vercel');
      expect(providerNameSchema.parse('netlify')).toBe('netlify');
    });

    it('rejects invalid provider names', () => {
      expect(() => providerNameSchema.parse('aws')).toThrow();
      expect(() => providerNameSchema.parse('')).toThrow();
      expect(() => providerNameSchema.parse(123)).toThrow();
    });
  });

  describe('configSchema', () => {
    it('parses a full valid config', () => {
      const raw = {
        envFiles: ['.env.local', '.env.production'],
        providers: ['github', 'vercel'],
        ignore: ['NODE_ENV', 'DEBUG'],
        envMapping: {
          '.env.production': 'production',
          '.env.local': 'development',
        },
      };

      const result = configSchema.parse(raw);
      expect(result.envFiles).toEqual(['.env.local', '.env.production']);
      expect(result.providers).toEqual(['github', 'vercel']);
      expect(result.ignore).toEqual(['NODE_ENV', 'DEBUG']);
      expect(result.envMapping).toEqual({
        '.env.production': 'production',
        '.env.local': 'development',
      });
    });

    it('parses an empty config (all fields optional)', () => {
      const result = configSchema.parse({});
      expect(result).toEqual({});
    });

    it('parses a partial config', () => {
      const result = configSchema.parse({ providers: ['netlify'] });
      expect(result.providers).toEqual(['netlify']);
      expect(result.envFiles).toBeUndefined();
    });

    it('rejects invalid provider in config', () => {
      expect(() => configSchema.parse({ providers: ['aws'] })).toThrow();
    });

    it('rejects non-string envFiles', () => {
      expect(() => configSchema.parse({ envFiles: [123] })).toThrow();
    });
  });
});

describe('Domain types', () => {
  it('SecretEntry is structurally valid', () => {
    const entry: SecretEntry = {
      key: 'API_KEY',
      value: 'secret123',
      source: '.env.local',
    };
    expect(entry.key).toBe('API_KEY');
    expect(entry.value).toBe('secret123');
    expect(entry.source).toBe('.env.local');
  });

  it('EnvFile is structurally valid', () => {
    const envFile: EnvFile = {
      path: '/project/.env',
      filename: '.env',
      secrets: { API_KEY: 'abc', DB_URL: 'postgres://...' },
    };
    expect(envFile.filename).toBe('.env');
    expect(Object.keys(envFile.secrets)).toHaveLength(2);
  });

  it('MissingSecret is structurally valid', () => {
    const missing: MissingSecret = {
      key: 'SECRET_KEY',
      source: '.env',
      missingFrom: [
        { provider: 'github', target: 'actions' },
        { provider: 'vercel', target: 'production' },
      ],
    };
    expect(missing.missingFrom).toHaveLength(2);
    expect(missing.missingFrom[0].provider).toBe('github');
  });

  it('CheckResult is structurally valid', () => {
    const result: CheckResult = {
      localSecrets: [{ key: 'A', value: '1', source: '.env' }],
      remoteKeys: { github: ['A', 'B'] },
      missing: [],
      allSynced: true,
    };
    expect(result.allSynced).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('PushResult is structurally valid', () => {
    const ok: PushResult = {
      key: 'API_KEY',
      provider: 'vercel',
      target: 'production',
      status: 'ok',
    };
    expect(ok.status).toBe('ok');
    expect(ok.error).toBeUndefined();

    const fail: PushResult = {
      key: 'API_KEY',
      provider: 'vercel',
      target: 'production',
      status: 'error',
      error: 'not authenticated',
    };
    expect(fail.status).toBe('error');
    expect(fail.error).toBe('not authenticated');
  });

  it('PrerequisiteResult is structurally valid', () => {
    const ok: PrerequisiteResult = { ok: true };
    expect(ok.ok).toBe(true);

    const missing: PrerequisiteResult = {
      ok: false,
      missing: 'gh CLI',
      fix: 'brew install gh',
    };
    expect(missing.ok).toBe(false);
    expect(missing.missing).toBe('gh CLI');
    expect(missing.fix).toBe('brew install gh');
  });
});
