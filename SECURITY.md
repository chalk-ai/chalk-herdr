# Security

Report suspected vulnerabilities privately to [support@chalk.ai](mailto:support@chalk.ai),
with “chalk-herdr security” in the subject. Include the affected commit/version, a description
of the impact, and a minimal reproduction. Do not include live credentials or customer data.
Please avoid public issues for unpatched vulnerabilities.

## Data and trust boundaries

This plugin sends local worktree files to a remote Chalk sandbox. Only use it with repositories
and local configuration you trust. Upload filtering is based on filenames, not content inspection:
secrets embedded in otherwise ordinary source files can still be uploaded.

The upload excludes `.git`, `.env*`, common credential files/directories, private-key extensions,
symlinks, and submodules. Git-ignored untracked files are excluded; already tracked files remain
eligible even if later added to `.gitignore`. Review the upload set before starting an agent.

The sandbox is a separate machine. Its code and agents can read uploaded files, use any access
you grant, and make network requests allowed by your Chalk deployment. Credentials configured
through `anthropicSecret` use Chalk's credential proxy. This plugin does not restrict the agent's
network access or provide a local sandbox for plugin actions.

## Maintainers

Never commit plaintext credentials, private keys, or production test data. Scan all Git history
before making the repository public: deleting a file from the current branch does not remove
historical versions. Rotate any credential that was exposed. Keep live CI credentials in a
protected GitHub environment, separate from public contribution checks.
