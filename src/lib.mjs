import { spawnSync, spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temporary = path.join(stateDir, `state-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, path.join(stateDir, "state.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function updateState(stateDir, fn) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lock = path.join(stateDir, "state.lock");
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() >= deadline) throw new Error(`State is locked: ${lock}. If no plugin action is running, remove this directory and retry.`);
      await delay(25);
    }
  }
  try {
    const state = await readState(stateDir);
    fn(state);
    await writeState(stateDir, state);
  } finally {
    await rm(lock, { recursive: true });
  }
}

/** Preserve the server and credentials directory selected when the sandbox was created. */
export function configForEntry(config, entry) {
  return { ...config, apiHost: entry.apiHost ?? null, chalkDir: entry.chalkDir, ignoreApiHostEnv: true };
}

/** Environment for chalk-related child processes, honoring the custom API server. */
export function chalkEnv(config) {
  const env = { ...process.env };
  if (config.apiHost) env.CHALK_API_SERVER = config.apiHost;
  else if (config.ignoreApiHostEnv) delete env.CHALK_API_SERVER;
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
  return paths.filter((p) => p && !path.posix.isAbsolute(p) && !p.split("/").some((part) =>
    part === "." || part === ".." || /^(?:\.git|\.env.*|\.vercel|\.chalk\.ya?ml|\.npmrc|\.pypirc|\.netrc|\.ssh|\.aws|\.azure|\.gnupg|\.kube|id_[a-z0-9_]+|.*\.(?:pem|key|p12|pfx))$/i.test(part)));
}

export function gitFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed in ${root}: ${r.stderr}`);
  // Never let tar recurse into submodules/directories or follow symlinked parents.
  // Deleted tracked files are absent from a worktree snapshot.
  return [...new Set(uploadable(r.stdout.split("\0")))].filter((p) => {
    let current = root;
    try {
      const parts = p.split("/");
      for (const [i, part] of parts.entries()) {
        current = path.join(current, part);
        const stat = lstatSync(current);
        if (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) return false;
      }
      return true;
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") return false;
      throw e;
    }
  });
}

/** Stream a tar of the worktree into the sandbox via `chalk sandbox exec` stdin. */
export async function uploadWorktree(config, sandboxId, root) {
  const files = gitFiles(root);
  const tar = spawn("tar", ["-c", "--no-recursion", "--null", "-T", "-"], {
    cwd: root, env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: ["pipe", "pipe", "inherit"],
  });
  const extract = spawn(
    "chalk",
    chalkArgs(config, ["sandbox", "exec", "--id", sandboxId, "--", "tar", "-x", "-C", REMOTE_WORKDIR]),
    { cwd: config.chalkDir ?? root, env: chalkEnv(config), stdio: ["pipe", "inherit", "inherit"] },
  );
  const completion = (child, label) => new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`${label} failed (${signal ?? code})`)));
  });
  const streams = new Promise((_, reject) => {
    for (const stream of [tar.stdin, tar.stdout, extract.stdin]) stream.on("error", reject);
  });
  try {
    const completed = Promise.all([completion(tar, "tar"), completion(extract, "upload")]);
    tar.stdout.pipe(extract.stdin);
    // NUL delimiters preserve newlines and make leading '-' names literal on GNU/BSD tar.
    tar.stdin.end(files.map((p) => `./${p}\0`).join(""));
    await Promise.race([completed, streams]);
    return files.length;
  } catch (e) {
    tar.stdout.unpipe(extract.stdin);
    tar.kill();
    extract.kill();
    tar.stdin.destroy();
    extract.stdin.destroy();
    throw e;
  }
}

export function attachArgs(config, sandboxId) {
  return chalkArgs(config, [
    "sandbox", "exec", "--id", sandboxId, "-t", "--",
    "tmux", "new-session", "-A", "-s", TMUX_SESSION, "-c", REMOTE_WORKDIR, "claude",
  ]);
}
