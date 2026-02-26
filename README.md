# envguard

[![CI](https://github.com/beebeebeeebeee/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/beebeebeeebeee/envguard/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/envguard.svg)](https://www.npmjs.com/package/envguard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Guards your environment secrets. Catches missing env vars before your CI does.

## The Problem

You add an API key to `.env.local`, write some code, push to GitHub, and... the build fails. You forgot to add the secret to Vercel. Or GitHub Actions. Or both.

envguard fixes this by checking that your local environment variables exist on your remote providers before you push.

## Install

```bash
npm install -g envguard
# or
npx envguard
```

Requires Node.js 20 or later.

## Quick Start

```bash
# Check if your local secrets exist on remote providers
envguard check

# Interactive push — select secrets and providers, confirm, done
envguard push

# Install a git hook to check automatically before every push
envguard hook install
```

## Commands

### `envguard check`

Compares your local `.env` keys against remote providers and reports what's missing. This is the default command — running `envguard` with no arguments does the same thing.

```
$ envguard check

  envguard · checking secrets

  ✓ 12 secrets from .env.local
  ✓ Providers: GitHub Actions, GitHub Codespaces, Vercel

  ⚠ 3 secrets missing from remote:

    STRIPE_KEY      → GitHub Actions, Vercel (production)
    DATABASE_URL    → Vercel (production)
    RESEND_API_KEY  → GitHub Actions

  Run envguard push to sync them.
  Run envguard hook install to catch missing secrets before pushing.
```

Exits with code 1 if secrets are missing — perfect for git hooks and CI.

### `envguard push`

Interactive TUI for pushing secrets to remote providers.

```
$ envguard push
```

Non-interactive mode:

```bash
envguard push --force        # Push all missing secrets without prompting
envguard push --dry-run      # Show what would be pushed
```

### `envguard delete`

Interactive TUI for deleting secrets from remote providers.

```
$ envguard delete
```

Non-interactive mode:

```bash
envguard delete --provider github --target actions --keys "KEY1,KEY2" --yes
envguard delete --provider vercel --target production --all --yes
envguard delete --provider github --target actions --keys "KEY1" --dry-run
```

### `envguard hook install`

Installs a git `pre-push` hook that runs `envguard check --quiet` automatically.

```bash
$ envguard hook install
✓ Installed envguard pre-push hook at .git/hooks/pre-push

$ envguard hook remove
✓ Removed pre-push hook.
```

### `envguard config`

Manage project configuration.

```bash
envguard config          # Show current config (or auto-detected settings)
envguard config init     # Create .envguard.json interactively
```

## Provider Detection

envguard auto-detects providers from your project:

| File | Provider |
|------|----------|
| `.github/` directory | GitHub Actions + Codespaces |
| `vercel.json` or `.vercel/` | Vercel |
| `netlify.toml` or `.netlify/` | Netlify |

Override with `.envguard.json`:

```json
{
  "providers": ["github", "vercel"]
}
```

## Env File Discovery

envguard finds your env files automatically:

- `.env`
- `.env.local`
- `.env.development`
- `.env.production`
- `.env.staging`

Or specify in config:

```json
{
  "envFiles": [".env.local", ".env.production"]
}
```

## Environment Mapping

Map different `.env` files to different provider environments:

```json
{
  "envMapping": {
    ".env.production": "production",
    ".env.local": "development",
    ".env.staging": "preview"
  }
}
```

## Configuration

Create `.envguard.json` in your project root:

```json
{
  "envFiles": [".env.local"],
  "providers": ["github", "vercel"],
  "ignore": ["NODE_ENV", "DEBUG", "PORT"],
  "envMapping": {
    ".env.production": "production",
    ".env.local": "development"
  }
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `envFiles` | Which .env files to read | Auto-detected |
| `providers` | Which providers to check/push to | Auto-detected |
| `ignore` | Secret names to skip | `[]` |
| `envMapping` | Map env files to provider environments | All environments |

## Global Flags

```
--color auto|always|never    Control color output (respects NO_COLOR)
--json                       Machine-readable JSON output
-q, --quiet                  Suppress non-essential output
-v, --verbose                Extra debug information
--version                    Print version
--help                       Show help
```

## Prerequisites

envguard uses your existing CLI tools under the hood:

- **GitHub:** [GitHub CLI (`gh`)](https://cli.github.com/) — must be authenticated (`gh auth login`)
- **Vercel:** [Vercel CLI](https://vercel.com/docs/cli) — must be authenticated (`vercel login`) and project linked (`vercel link`)
- **Netlify:** [Netlify CLI](https://docs.netlify.com/cli/get-started/) — must be authenticated (`netlify login`) and site linked (`netlify link`)

envguard will tell you exactly what's missing and how to set it up.

## Security

- **Push-only.** envguard never reads or downloads remote secret values.
- **Existence checks only.** It verifies that a key *exists* remotely, not what the value is.
- **No secret storage.** envguard doesn't store, cache, or transmit your secrets — it reads `.env` files and passes values to provider CLIs.
- **Local only.** No analytics, no telemetry, no network calls except to your configured providers via their CLIs.

## License

MIT
