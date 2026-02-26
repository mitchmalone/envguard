# envguard

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

Compares your local `.env` keys against remote providers and reports what's missing.

```
$ envguard check

  envguard · checking secrets

  ✓ 12 local secrets found in .env.local
  ✓ Detected providers: GitHub Actions, Vercel

  ⚠ 3 secrets missing from remote environments:

    STRIPE_KEY         missing on → GitHub Actions, Vercel
    DATABASE_URL       missing on → Vercel
    RESEND_API_KEY     missing on → GitHub Actions

  Run envguard push to sync them.
```

Exits with code 1 if secrets are missing — perfect for git hooks and CI.

### `envguard push`

Interactive TUI for pushing secrets to remote providers.

```
$ envguard push

  envguard · push secrets

  ? Select secrets to push:
    ✓ STRIPE_KEY
    ✓ DATABASE_URL
    ✓ RESEND_API_KEY

  ? Push to:
    ✓ GitHub Actions
    ✓ GitHub Codespaces
    ✓ Vercel (production, preview, development)

  Pushing 3 secrets to 3 providers...
  ✓ STRIPE_KEY        → GitHub Actions ✓  Codespaces ✓  Vercel ✓
  ✓ DATABASE_URL      → Vercel ✓
  ✓ RESEND_API_KEY    → GitHub Actions ✓

  ✓ 3 secrets synced to 3 providers.
```

### `envguard hook install`

Installs a git `pre-push` hook that runs `envguard check` automatically.

```bash
$ envguard hook install
✓ Installed pre-push hook at .git/hooks/pre-push

$ envguard hook remove
✓ Removed pre-push hook
```

### `envguard config`

Manage project configuration.

```bash
$ envguard config          # Show current config
$ envguard config init     # Create .envguard.json interactively
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

envguard finds your env files automatically (in priority order):

1. `.env.local`
2. `.env`
3. `.env.development`

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

## Flags

```
--color auto|always|never    Control color output (respects NO_COLOR)
--json                       Machine-readable JSON output
--quiet                      Suppress non-essential output
--verbose                    Extra debug information
--version                    Print version
--help                       Show help
```

## Prerequisites

envguard uses your existing CLI tools under the hood:

- **GitHub:** [GitHub CLI (`gh`)](https://cli.github.com/) — must be authenticated
- **Vercel:** [Vercel CLI](https://vercel.com/docs/cli) — must be authenticated
- **Netlify:** [Netlify CLI](https://docs.netlify.com/cli/get-started/) — must be authenticated

envguard will tell you exactly what's missing and how to set it up.

## Security

- **Push-only.** envguard never reads or downloads remote secret values.
- **Existence checks only.** It verifies that a key *exists* remotely, not what the value is.
- **No secret storage.** envguard doesn't store, cache, or transmit your secrets — it reads `.env` files and passes values to provider CLIs.
- **Local only.** No analytics, no telemetry, no network calls except to your configured providers via their CLIs.

## License

MIT
