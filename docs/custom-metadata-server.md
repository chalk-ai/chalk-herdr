# Custom metadata server (API host)

Chalk's "metadata server" is the API server the CLI and SDK talk to: it authenticates you,
resolves your environment, and creates, lists, and terminates sandboxes. By default that is
`https://api.chalk.ai`. Staging, isolated deployments, and local `go-api-server` builds have
their own hosts. This plugin lets you point at any of them.

## Setting it

In `$(herdr plugin config-dir chalk.sandbox)/config.json`:

```json
{
  "apiHost": "https://api.staging.chalk.dev",
  "chalkDir": "/path/to/dir/containing/chalk.yml"
}
```

`apiHost` is applied in two places for every sandbox operation:

| Layer | How |
| --- | --- |
| `chalk` CLI (`sandbox get/exec/terminate`) | `--api-host <apiHost>` |
| Python SDK (`src/provision.py`, which creates the sandbox) | `CHALK_API_SERVER=<apiHost>` |

## Resolution order when `apiHost` is unset

1. `CHALK_API_SERVER` in the environment Herdr was launched from
2. The `apiServer` of the credentials found from `chalkDir` (a project directory with
   `chalk.yml`, as in `chalk config --dir <chalkDir>`) or `~/.chalk.yml`
3. `https://api.chalk.ai`

`chalkDir` matters: `chalk` resolves the active environment and token relative to its working
directory. With the fraud-template-staging project (ftqa), `chalk config --dir <dir>` reports
`API Server https://api.staging.chalk.dev`, so setting only `chalkDir` is enough there.

## Notes

- The sandbox mapping stored per pane records `apiHost` and `chalkDir`. Reconnect, Info, and
  Terminate reuse the values saved at start, so a pane keeps talking to the server that created it.
- The sandbox itself runs with Chalk-injected `CHALK_API_SERVER`, so in-sandbox calls reach the
  same server.
- Credentials are never copied into the sandbox. The Anthropic token is optional and injected
  by Chalk's credential proxy (`anthropicSecret`), not by the plugin.
- A wrong or unreachable host fails at provisioning, before any pane mapping is written.
