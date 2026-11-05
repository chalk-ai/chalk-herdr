# Contributing

Bug reports and pull requests are welcome. Describe the expected behavior, actual behavior,
OS, Node version, Herdr version, and Chalk CLI version. Redact credentials and private paths.
For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Local development

Install Node 20+ (a maintained LTS release is recommended), Git, tar, and
[uv](https://docs.astral.sh/uv/). There are no npm dependencies or npm install steps.

```sh
git clone https://github.com/chalk-ai/chalk-herdr.git
cd chalk-herdr
npm run check
npm test
uv run --locked --script src/provision.py --check
herdr plugin link "$PWD"
```

Unit and regression tests use local fixtures and fake CLIs. They do not need Chalk credentials,
start agents, or provision remote resources. CI runs on Linux and macOS with Node 20, 22, and 24.

Keep changes focused and add regression tests for behavior changes. By submitting a contribution,
you agree to license it under this repository's Apache-2.0 license.

## Python dependencies

`src/provision.py` uses PEP 723 metadata and a committed uv lockfile. To update the SDK, change
its version in the script, then run:

```sh
uv lock --script src/provision.py --upgrade
uv run --locked --script src/provision.py --check
```

Resolve dependencies from public PyPI, not a private package index. Review the lockfile changes
and run the live test before releasing SDK upgrades. GitHub Actions updates are proposed by
Dependabot; keep all `uses:` references pinned to full commit SHAs.

## Optional live test

`npm run e2e` creates a real sandbox with a 20-minute lifetime and incurs Chalk usage. It checks
file upload, Claude Code installation, tmux, status, and termination; it does not send a prompt
to Claude. Supply `CHALK_CLIENT_ID`, `CHALK_CLIENT_SECRET`, and `CHALK_ENVIRONMENT` through your
secret manager or local environment; set `CHALK_API_SERVER` for a custom endpoint. Never commit
these values. The test terminates its sandbox in `finally`; abrupt process termination relies
on the lifetime limit, so check for leftovers after an interrupted run.

For CI, maintainers can create a `sandbox-e2e` GitHub environment with required reviewers and
those secrets, then dispatch `ci` on `main` with `live_e2e` enabled. Use a dedicated, least-privilege
test account. PRs and ordinary pushes never receive these credentials. Do not use
`pull_request_target` to execute contribution code with credentials.
