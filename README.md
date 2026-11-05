# Chalk Sandbox for Herdr

Run Claude Code in a Chalk sandbox, one sandbox per Herdr pane. Herdr stays the local control
room: the pane is a local terminal attached with `chalk sandbox exec -t` to a `tmux` session
running `claude` inside the sandbox, so you can detach and reconnect.

## Requirements

- Herdr 0.7.5+ (tested on 0.9.5), Node 20+, Git, `tar`
- The `chalk` CLI, logged in (or a `chalk.yml` project directory with credentials)
- [`uv`](https://docs.astral.sh/uv/) (runs `src/provision.py` with the `chalkcompute` SDK)

## Install

```bash
herdr plugin link /path/to/chalk-herdr   # or: herdr plugin install <owner>/chalk-herdr
herdr plugin config-dir chalk.sandbox
```

Bind the actions in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+s"
type = "plugin_action"
command = "chalk.sandbox.start-agent"
description = "start Claude Code in a Chalk sandbox"

[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "chalk.sandbox.reconnect"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "chalk.sandbox.info"

[[keys.command]]
key = "prefix+shift+q"
type = "plugin_action"
command = "chalk.sandbox.terminate"
```

## Config (`config.json` in the plugin config dir)

| Key | Default | Meaning |
| --- | --- | --- |
| `chalkDir` | worktree | Directory `chalk` runs in (credentials / `chalk.yml`) |
| `apiHost` | from credentials | Custom API server; see [docs/custom-metadata-server.md](docs/custom-metadata-server.md) |
| `cpu`, `memory` | `2`, `8Gi` | Sandbox resources |
| `lifetime` | `8h` | Auto-termination (`90s`, `30m`, `8h`, `1d`) |
| `claudeVersion` | SDK default | Pin Claude Code version |
| `anthropicSecret` | none | Chalk secret holding `CLAUDE_CODE_OAUTH_TOKEN`; otherwise run `/login` in the sandbox |

## Actions

- **start-agent**: splits a pane, builds/starts the sandbox, uploads the Git worktree
  (tracked + untracked-not-ignored files; never `.git`, `.env*`, keys), attaches Claude Code.
  The first image build takes a few minutes; later starts reuse the cached image.
- **reconnect**: re-attaches to the `agent` tmux session.
- **info**: prints the mapping and the sandbox's status from Chalk.
- **terminate**: terminates the sandbox and forgets the mapping.

Sandboxes outlive the pane. Terminate them, or let `lifetime` expire.

## CI

`.github/workflows/ci.yml` (all actions pinned by commit sha):

- **test**: manifest validation, `node --check`, unit tests, `provision.py` compile, and a check that every
  `uses:` is sha-pinned.
- **e2e**: live test against the ftqa Chalk environment (`scripts/e2e.mjs`): provisions a sandbox with Claude Code,
  uploads a worktree, checks the contents (including that `.env` is not uploaded), starts a tmux session, and
  always terminates the sandbox. Skipped on fork PRs.

## Secrets (SOPS)

`secrets/ftqa.enc.env` holds the ftqa service-account creds (`CHALK_CLIENT_ID`, `CHALK_CLIENT_SECRET`,
`CHALK_ENVIRONMENT`, `CHALK_API_SERVER`), encrypted with SOPS (`.sops.yaml`) to:

- an **age** key: CI decrypts with the `SOPS_AGE_KEY` repo secret (the private key; keep a copy in your password
  manager and at `~/.config/sops/age/keys.txt` or set `SOPS_AGE_KEY_FILE`);
- the shared **GCP KMS** key `chalk-infra/cost-monitoring/sops-key`, so `gcp-developers` can decrypt locally.

```bash
sops exec-env secrets/ftqa.enc.env 'npm run e2e'     # run the live test locally
sops secrets/ftqa.enc.env                            # edit in place
```

To rotate: regenerate the creds, `sops secrets/ftqa.enc.env`, commit. To rotate the age key, generate a new one,
update `.sops.yaml`, run `sops updatekeys secrets/ftqa.enc.env`, and update the `SOPS_AGE_KEY` repo secret.
