# Chalk Sandbox for Herdr

Run Claude Code in a Chalk sandbox, one sandbox per Herdr pane. Herdr stays the local control
room: the pane is a local terminal attached with `chalk sandbox exec -t` to a `tmux` session
running `claude` inside the sandbox, so you can detach and reconnect.

## Requirements

- Herdr 0.7.5+ (tested on 0.9.5), Node 20+, Git, `tar`
- A Chalk account with sandbox access and the [`chalk` CLI](https://docs.chalk.ai/docs/setup-guide), logged in (or a `chalk.yml` project directory with credentials)
- [`uv`](https://docs.astral.sh/uv/) (runs `src/provision.py` with the `chalkcompute` SDK)

## Install

```bash
herdr plugin install chalk-ai/chalk-herdr
# For local development: herdr plugin link /path/to/chalk-herdr
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
  (tracked + untracked-not-ignored regular files), and attaches Claude Code.
  See the upload exclusions below before starting.
  The first image build takes a few minutes; later starts reuse the cached image.
- **reconnect**: re-attaches to the `agent` tmux session.
- **info**: prints the mapping and the sandbox's status from Chalk.
- **terminate**: terminates the sandbox and forgets the mapping.

Sandboxes outlive the pane. Terminate them, or let `lifetime` expire.

## What is uploaded and retained

Uploads are a one-time snapshot of the entire Git worktree, including uncommitted changes.
The plugin excludes `.git`, `.env*`, common credential files (including `.chalk.yml`, `.npmrc`,
`.netrc`, SSH/cloud credential directories and private-key extensions), symlinks, submodules,
and deleted files. Git-ignored untracked files are excluded; tracked files remain eligible
even if later added to `.gitignore`. Filename filtering cannot detect credentials embedded in
source code. Review the files and use a dedicated worktree when necessary.

Local edits after upload and edits inside the sandbox are **not synchronized**. The uploaded
snapshot has no Git history. Copy any remote changes you want to keep before terminating the
sandbox or allowing its lifetime to expire. For example, from a local terminal in your Chalk
credentials directory, save a remote snapshot (replace the sandbox ID):

```sh
chalk sandbox exec --id SANDBOX_ID -- tar -c -C /workspace/repo . > sandbox-backup.tar
```

Inspect the archive and extract it into a separate directory before copying changes into your
worktree. For a custom API server, supply `--api-host` before `--`.

Closing a pane or detaching does not stop the sandbox or its usage charges. Use **Terminate**
or let `lifetime` expire. Info and Terminate work from the original mapped pane and from a
reconnected pane; terminating removes every local mapping for that sandbox.

## Development and CI

```sh
npm run check
npm test
uv run --locked --script src/provision.py --check
```

These checks do not require Chalk credentials. The Python SDK and its dependencies are locked
from public PyPI; there are no npm dependencies. The live integration test is optional and uses
a real Chalk sandbox. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and the
protected GitHub environment used by that test.

## Security

See [SECURITY.md](SECURITY.md) for data handling and private vulnerability reporting.

## License

Copyright 2026 Chalk AI, Inc. Licensed under [Apache-2.0](LICENSE).
The plugin requires separately installed Herdr, Chalk tooling, and Claude Code. Those tools
and the hosted Chalk and Anthropic services retain their own licenses and terms; this license
covers the plugin source.
