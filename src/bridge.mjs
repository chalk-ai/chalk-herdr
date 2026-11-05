#!/usr/bin/env node
// Runs inside the new Herdr pane: provision (start) or just attach (connect).
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachArgs, chalkEnv, configForEntry, readConfig, readState, updateState, uploadWorktree } from "./lib.mjs";

const [mode, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].slice(2).replaceAll("-", "_")] = rest[i + 1];
let config = await readConfig(opt.config_dir);
const saved = mode === "connect" ? (await readState(opt.state_dir)).panes[opt.pane_id] : null;
if (mode === "connect" && !saved) fail("No Chalk sandbox is mapped to this pane.");
if (saved) config = configForEntry(config, saved);
else config.apiHost ??= process.env.CHALK_API_SERVER ?? null;
const chalkDir = path.resolve(opt.cwd, config.chalkDir ?? ".");
const provision = path.join(path.dirname(fileURLToPath(import.meta.url)), "provision.py");

function fail(msg) {
  console.error(`\n${msg}`);
  process.exit(1);
}

async function start() {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: opt.cwd, encoding: "utf8" });
  if (git.status !== 0) fail("Run Start from a Herdr pane inside a Git worktree.");
  const localRoot = git.stdout.trim();
  const name = `herdr-${opt.pane_id.replace(/[^a-z0-9]/gi, "").slice(-6)}-${Date.now().toString(36)}`;
  console.log(`Provisioning Chalk sandbox ${name} (first build of the image can take a few minutes)...`);
  const args = [provision, "--name", name, "--cpu", config.cpu, "--memory", config.memory, "--lifetime", config.lifetime];
  if (config.claudeVersion) args.push("--claude-version", config.claudeVersion);
  if (config.anthropicSecret) args.push("--anthropic-secret", config.anthropicSecret);
  const r = spawnSync("uv", ["run", "--quiet", "--locked", "--script", ...args], {
    cwd: chalkDir, env: chalkEnv(config), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) fail("Sandbox provisioning failed.");
  const { id } = JSON.parse(r.stdout.trim().split("\n").at(-1));
  // Print the id before saving state so it remains recoverable if the local write fails.
  console.log(`Created sandbox ${id}.`);
  try {
    await updateState(opt.state_dir, (s) => {
      s.panes[opt.pane_id] = {
        sandboxId: id, sandboxName: name, localRoot, chalkDir,
        apiHost: config.apiHost, createdAt: new Date().toISOString(),
      };
    });
  } catch (e) {
    fail(`Could not save sandbox ${id}: ${e.message}. Terminate it with the Chalk CLI.`);
  }
  console.log(`Sandbox ${id} ready. Uploading worktree...`);
  try {
    console.log(`Uploaded ${await uploadWorktree({ ...config, chalkDir }, id, localRoot)} files.`);
  } catch (e) {
    fail(`Upload failed: ${e.message}. Sandbox ${id} is still running; use Terminate to clean up.`);
  }
  attach(id);
}

function attach(id) {
  const child = spawn("chalk", attachArgs(config, id), { cwd: chalkDir, env: chalkEnv(config), stdio: "inherit" });
  child.on("error", (e) => fail(`Could not attach to sandbox ${id}: ${e.message}`));
  child.on("exit", (code) => {
    console.log(`\nDetached (exit ${code}). Sandbox keeps running; use Reconnect or Terminate.`);
    process.exit(code ?? 0);
  });
}

if (mode === "start") await start();
else if (mode === "connect") attach(saved.sandboxId);
else fail(`Unknown mode: ${mode}`);
