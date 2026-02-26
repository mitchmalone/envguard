# CLAUDE.md — Agent Onboarding for envguard

## What is envguard?

envguard is a CLI tool that guards your environment secrets. It detects local `.env` variables, compares them against remote providers (GitHub Actions, Codespaces, Vercel, Netlify), and ensures secrets are synced before you push code. No more failed builds from forgotten env vars.

## Commands

```
envguard check        # Compare local .env keys against remote providers (default command)
envguard push         # Interactive TUI to select and push secrets to providers
envguard hook install # Install git pre-push hook
envguard hook remove  # Remove git pre-push hook
envguard config       # Show current config
envguard config init  # Create .envguard.json interactively
```

## Architecture

This is a **medium CLI** with Ink TUI for the interactive `push` command.

```
src/
├── cli.ts              # Thin entry — injects process deps, 5 lines
├── cli-main.ts         # Bootstrap, Commander setup, error handling
├── commands/
│   ├── check.ts        # Compare local vs remote secrets
│   ├── push.ts         # Interactive push flow (Ink)
│   ├── delete.ts       # Interactive delete flow (Ink)
│   ├── hook.ts         # Git hook management
│   └── config.ts       # Config management
├── providers/
│   ├── types.ts        # Provider interface
│   ├── github.ts       # GitHub Actions + Codespaces
│   ├── vercel.ts       # Vercel environments
│   └── netlify.ts      # Netlify env vars
├── core/
│   ├── env-parser.ts   # .env file discovery and parsing
│   ├── detector.ts     # Auto-detect providers from project config
│   └── comparator.ts   # Diff local vs remote secrets
├── ui/
│   ├── PushWizard.tsx  # Ink push flow
│   ├── DeleteWizard.tsx# Ink delete flow
│   ├── CheckReport.tsx # Ink check output
│   └── components/     # Shared Ink components
├── utils/
│   ├── terminal.ts     # Colors, TTY detection
│   ├── errors.ts       # CliError class, EPIPE handler
│   └── config.ts       # Config file loading (.envguard.json)
└── types.ts            # Domain types + Zod schemas
```

## Stack

- **Language:** TypeScript (ESM, target ES2022, Node ≥20)
- **CLI framework:** Commander.js with `exitOverride()`
- **TUI:** Ink (React for CLIs) — used for `push` command
- **Validation:** Zod for config schemas
- **Testing:** Vitest with v8 coverage (≥75% threshold)
- **Linting:** Biome (not ESLint/Prettier)
- **Package manager:** pnpm
- **Build:** tsc → dist/

## Key Patterns

### Entry Point DI
`cli.ts` is a thin shim that injects `process.argv`, `process.env`, `process.stdout`, `process.stderr`, and `process.exit`. Everything else receives these as parameters. Tests call `runCli()` directly with mocks.

### Provider Interface
All providers implement the same interface:
```typescript
interface Provider {
  name: string;
  detect(projectRoot: string): Promise<boolean>;
  listRemoteKeys(): Promise<string[]>;
  pushSecrets(secrets: Record<string, string>): Promise<PushResult[]>;
}
```

### Never Pull Secrets
envguard is **push-only by design**. It checks if keys *exist* remotely but never reads remote secret values. This is a security invariant — do not add pull/download functionality.

### Underlying CLIs
Providers shell out to existing CLIs (`gh`, `vercel`, `netlify`) rather than using their APIs directly. This reduces auth complexity and benefits from existing user sessions.

## Build / Test / Lint

```bash
pnpm install              # Install deps
pnpm run build            # tsc → dist/
pnpm run check            # biome check . && tsc --noEmit && vitest run
pnpm test                 # vitest run
pnpm test -- --watch      # vitest watch mode
```

## Gate Command (run before every commit)

```bash
pnpm run check
```

## Commit Conventions

Use Conventional Commits:
- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `refactor:` code changes that neither fix bugs nor add features
- `test:` adding or updating tests
- `chore:` tooling, deps, config

## Config File

`.envguard.json` in project root:
```json
{
  "envFiles": [".env.local"],
  "providers": ["github", "vercel"],
  "ignore": ["NODE_ENV", "DEBUG"],
  "envMapping": {
    ".env.production": "production",
    ".env.local": "development"
  }
}
```

## Gotchas

- Always use `exitOverride()` on Commander to prevent process.exit during tests
- Ink components go in `src/ui/`, not `src/commands/` — keep rendering separate from logic
- Provider detection is based on config file presence (vercel.json, netlify.toml, .github/)
- The `check` command must work non-interactively (for git hooks and CI)
- Handle EPIPE errors for piped output (`envguard check | head`)
- Respect `NO_COLOR` env var
