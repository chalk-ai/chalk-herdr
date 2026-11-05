#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, readState, runChalk, shellQuote, updateState } from "./lib.mjs";

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const actionId = process.env.HERDR_PLUGIN_ACTION_ID;
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
const paneId = process.env.HERDR_PANE_ID;
const bridge = path.join(path.dirname(fileURLToPath(import.meta.url)), "bridge.mjs");

function herdrCli(args) {
  const r = spawnSync(herdr, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`herdr ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function findCwd() {
  return (
    context.pane?.cwd ?? context.focused_pane?.cwd ?? context.worktree?.path ?? context.workspace?.cwd ?? process.env.PWD
  );
}

function splitAndRun(sourcePane, cwd, title, mode, extra = []) {
  const out = JSON.parse(herdrCli(["pane", "split", sourcePane, "--direction", "right", "--ratio", "0.5", "--cwd", cwd, "--focus"]));
  const newPane = out?.result?.pane?.pane_id;
  if (!newPane) throw new Error(`Herdr did not return a pane id: ${JSON.stringify(out)}`);
  herdrCli(["pane", "rename", newPane, title]);
  const cmd = [
    "HERDR_AGENT=claude", "node", shellQuote(bridge), mode,
    "--state-dir", shellQuote(stateDir), "--config-dir", shellQuote(configDir),
    "--pane-id", shellQuote(newPane), "--cwd", shellQuote(cwd), ...extra,
  ].join(" ");
  herdrCli(["pane", "run", newPane, cmd]);
  return newPane;
}

async function main() {
  const state = await readState(stateDir);
  const entry = paneId ? state.panes[paneId] : undefined;
  switch (actionId) {
    case "start-agent": {
      const cwd = findCwd();
      if (!cwd || !paneId) throw new Error("Run Start from a Herdr pane inside a Git worktree.");
      if (entry) throw new Error(`This pane already maps to sandbox ${entry.sandboxName}. Use Reconnect.`);
      console.log(`Started pane ${splitAndRun(paneId, cwd, "Claude · Chalk Sandbox", "start")}`);
      break;
    }
    case "reconnect": {
      if (!entry) throw new Error("No Chalk sandbox is mapped to this pane.");
      const cwd = entry.localRoot;
      console.log(`Reconnecting in pane ${splitAndRun(paneId, cwd, "Claude · Chalk Sandbox", "connect", ["--sandbox-id", shellQuote(entry.sandboxId)])}`);
      break;
    }
    case "info": {
      if (!entry) throw new Error("No Chalk sandbox is mapped to this pane.");
      const config = await readConfig(configDir);
      const r = runChalk(config, ["sandbox", "get", "--id", entry.sandboxId, "--json"], { cwd: entry.chalkDir });
      console.log(JSON.stringify({ ...entry, remote: r.status === 0 ? JSON.parse(r.stdout) : r.stderr.trim() }, null, 2));
      break;
    }
    case "terminate": {
      if (!entry) throw new Error("No Chalk sandbox is mapped to this pane.");
      const config = await readConfig(configDir);
      const r = runChalk(config, ["sandbox", "terminate", "--id", entry.sandboxId, "--no-spinners"], { cwd: entry.chalkDir });
      if (r.status !== 0) throw new Error(`terminate failed: ${r.stderr}`);
      await updateState(stateDir, (s) => delete s.panes[paneId]);
      console.log(`Terminated ${entry.sandboxName}`);
      break;
    }
    default:
      throw new Error(`Unknown action: ${actionId}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
