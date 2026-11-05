import { spawnSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const REMOTE_WORKDIR = "/workspace/repo";
export const TMUX_SESSION = "agent";

export const DEFAULT_CONFIG = Object.freeze({
  // Directory holding chalk.yml / credentials for `chalk` (e.g. an environment repo). Default: the worktree.
  chalkDir: null,
  // Chalk API ("metadata") server override. Passed as --api-host and CHALK_API_SERVER. See docs/custom-metadata-server.md.
  apiHost: null,
  cpu: "2",
  memory: "8Gi",
  lifetime: "8h",
  claudeVersion: null,
  // Name of a Chalk secret containing CLAUDE_CODE_OAUTH_TOKEN. Null means log in inside the sandbox.
  anthropicSecret: null,
});

export function shellQuote(v) {
  return `'${String(v).replaceAll("'", `'\\''`)}'`;
}

export async function readConfig(configDir) {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(path.join(configDir, "config.json"), "utf8")) };
  } catch (e) {
    if (e.code === "ENOENT") return { ...DEFAULT_CONFIG };
    throw new Error(`Invalid ${configDir}/config.json: ${e.message}`);
  }
}

export async function readState(stateDir) {
  try {
    return JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { panes: {} };
    throw e;
  }
}

export async function writeState(stateDir, state) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
}

export async function updateState(stateDir, fn) {
  const state = await readState(stateDir);
  fn(state);
  await writeState(stateDir, state);
}

/** Environment for chalk-related child processes, honoring the custom API server. */
export function chalkEnv(config) {
  const env = { ...process.env };
  if (config.apiHost) env.CHALK_API_SERVER = config.apiHost;
  return env;
}

/** Add --api-host before any `--` separator, so it is never passed to the remote command. */
export function chalkArgs(config, args) {
  if (!config.apiHost) return args;
  const sep = args.indexOf("--");
  const at = sep === -1 ? args.length : sep;
  return [...args.slice(0, at), "--api-host", config.apiHost, ...args.slice(at)];
}

export function runChalk(config, args, { cwd, capture = true, input } = {}) {
  return spawnSync("chalk", chalkArgs(config, args), {
    cwd: cwd ?? config.chalkDir ?? process.cwd(),
    env: chalkEnv(config),
    encoding: "utf8",
    input,
    stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
  });
}

/** Files to upload: tracked + untracked-not-ignored, minus .git and env/secret files. */
export function uploadable(paths) {
  return paths.filter((p) => p && !/(^|\/)(\.git|\.env[^/]*|\.vercel|\.chalk\.yml|id_[a-z0-9]+|[^/]*\.pem)(\/|$)/.test(p));
}

export function gitFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed in ${root}: ${r.stderr}`);
  return uploadable(r.stdout.split("\0"));
}

/** Stream a tar of the worktree into the sandbox via `chalk sandbox exec` stdin. */
export function uploadWorktree(config, sandboxId, root) {
  const files = gitFiles(root);
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-c", "-T", "-"], { cwd: root, env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const extract = spawn(
      "chalk",
      chalkArgs(config, ["sandbox", "exec", "--id", sandboxId, "--", "tar", "-x", "-C", REMOTE_WORKDIR]),
      { cwd: config.chalkDir ?? root, env: chalkEnv(config), stdio: ["pipe", "inherit", "inherit"] },
    );
    tar.stdout.pipe(extract.stdin);
    tar.stdin.end(files.join("\n") + "\n");
    tar.on("error", reject);
    extract.on("error", reject);
    extract.on("close", (code) => (code === 0 ? resolve(files.length) : reject(new Error(`upload failed (exit ${code})`))));
  });
}

export function attachArgs(config, sandboxId) {
  return chalkArgs(config, [
    "sandbox", "exec", "--id", sandboxId, "-t", "--",
    "tmux", "new-session", "-A", "-s", TMUX_SESSION, "-c", REMOTE_WORKDIR, "claude",
  ]);
}
