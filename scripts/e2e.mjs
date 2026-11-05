#!/usr/bin/env node
// Live end-to-end check against a real Chalk environment (creds from CHALK_* env vars):
// provision a sandbox with Claude Code, upload a worktree, verify, always terminate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, REMOTE_WORKDIR, TMUX_SESSION, chalkEnv, runChalk, uploadWorktree } from "../src/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = { ...DEFAULT_CONFIG, cpu: "1", memory: "2Gi", lifetime: "20m", apiHost: process.env.CHALK_API_SERVER ?? null };
const root = mkdtempSync(path.join(tmpdir(), "herdr-e2e-"));
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stderr}`);
};
sh("git", ["init", "-q"]);
writeFileSync(path.join(root, "app.py"), "print('hi')\n");
writeFileSync(path.join(root, ".env"), "SECRET=1\n");
mkdirSync(path.join(root, "src"));
writeFileSync(path.join(root, "src", "b.py"), "x = 1\n");

const exec = (id, ...cmd) => runChalk(config, ["sandbox", "exec", "--id", id, "--", ...cmd], { cwd: root });
let id;
try {
  const name = `herdr-e2e-${Date.now().toString(36)}`;
  const p = spawnSync("uv", ["run", "--quiet", "--script", path.join(here, "../src/provision.py"),
    "--name", name, "--cpu", config.cpu, "--memory", config.memory, "--lifetime", config.lifetime],
  { cwd: root, env: chalkEnv(config), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  assert.equal(p.status, 0, "provisioning failed");
  ({ id } = JSON.parse(p.stdout.trim().split("\n").at(-1)));
  console.log(`provisioned ${name} (${id})`);

  assert.equal(await uploadWorktree(config, id, root), 2, "should upload exactly app.py and src/b.py");
  const ls = exec(id, "sh", "-c", `cd ${REMOTE_WORKDIR} && find . -type f | sort`);
  assert.equal(ls.stdout.trim(), "./app.py\n./src/b.py", "worktree contents (and .env exclusion)");

  const v = exec(id, "claude", "--version");
  assert.match(v.stdout, /Claude Code/);
  console.log(v.stdout.trim());

  const t = exec(id, "sh", "-c", `tmux new-session -d -s ${TMUX_SESSION} -c ${REMOTE_WORKDIR} 'sleep 60' && tmux has-session -t ${TMUX_SESSION}`);
  assert.equal(t.status, 0, `tmux session: ${t.stderr}`);

  const info = runChalk(config, ["sandbox", "get", "--id", id, "--json"], { cwd: root });
  assert.match(info.stdout, /SANDBOX_STATUS_RUNNING/);
  console.log("e2e ok");
} finally {
  if (id) {
    const r = runChalk(config, ["sandbox", "terminate", "--id", id, "--no-spinners"], { cwd: root });
    console.log(r.status === 0 ? `terminated ${id}` : `TERMINATE FAILED for ${id}: ${r.stderr}`);
  }
}
