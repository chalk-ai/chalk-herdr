import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = fileURLToPath(new URL("../src/action.mjs", import.meta.url));
const bridge = fileURLToPath(new URL("../src/bridge.mjs", import.meta.url));

function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "chalk-actions-")));
  const stateDir = path.join(base, "state");
  const configDir = path.join(base, "config");
  const bin = path.join(base, "bin");
  for (const dir of [stateDir, configDir, bin]) mkdirSync(dir);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const entry = { sandboxId: "sandbox-1", sandboxName: "test", localRoot: base, chalkDir: base, apiHost: "https://saved.example.com" };
  const stateFile = path.join(stateDir, "state.json");
  const log = path.join(base, "log.jsonl");
  writeFileSync(stateFile, JSON.stringify({ panes: { original: entry, sibling: entry, unrelated: { ...entry, sandboxId: "sandbox-2" } } }));
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ chalkDir: "/does-not-exist", apiHost: "https://changed.example.com" }));
  const executable = (name, code) => writeFileSync(path.join(bin, name), `#!${process.execPath}\n${code}\n`, { mode: 0o755 });
  executable("chalk", `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), host: process.env.CHALK_API_SERVER, cwd: process.cwd() })+String.fromCharCode(10)); console.log('{}');`);
  executable("herdr", `const fs = require('node:fs'); const args=process.argv.slice(2); if(args[1]==='split') console.log(JSON.stringify({result:{pane:{pane_id:'new-pane'}}})); if(args[1]==='run') { const state=JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)})); if(!state.panes['new-pane']) process.exit(3); }`);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HERDR_BIN_PATH: path.join(bin, "herdr"), HERDR_PLUGIN_STATE_DIR: stateDir, HERDR_PLUGIN_CONFIG_DIR: configDir, HERDR_PANE_ID: "original", HERDR_PLUGIN_CONTEXT_JSON: "{}" };
  const run = (id) => spawnSync(process.execPath, [action], { env: { ...env, HERDR_PLUGIN_ACTION_ID: id }, encoding: "utf8" });
  return { base, stateDir, configDir, stateFile, entry, env, log, run, executable };
}

test("reconnect maps the new pane before launching its bridge", (t) => {
  const f = fixture(t);
  const r = f.run("reconnect");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.stateFile)).panes["new-pane"], f.entry);
});

test("info uses the saved server and credentials directory", (t) => {
  const f = fixture(t);
  const r = f.run("info");
  assert.equal(r.status, 0, r.stderr);
  const call = JSON.parse(readFileSync(f.log, "utf8").trim());
  assert.equal(call.host, f.entry.apiHost);
  assert.equal(call.cwd, f.entry.chalkDir);
  assert.ok(call.args.includes(f.entry.apiHost));
});

test("terminate clears all matching panes but preserves other sandboxes", (t) => {
  const f = fixture(t);
  const r = f.run("terminate");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(f.stateFile)).panes), ["unrelated"]);
});

test("a failed terminate retains mappings for recovery", (t) => {
  const f = fixture(t);
  f.executable("chalk", "process.exit(1)");
  const r = f.run("terminate");
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(f.stateFile)).panes.original, f.entry);
});

test("connect bridge attaches using the mapping rather than current config", (t) => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [bridge, "connect", "--state-dir", f.stateDir, "--config-dir", f.configDir, "--pane-id", "original", "--cwd", f.base], { env: f.env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const call = JSON.parse(readFileSync(f.log, "utf8").trim());
  assert.equal(call.host, f.entry.apiHost);
  assert.equal(call.cwd, f.entry.chalkDir);
  assert.ok(call.args.includes(f.entry.sandboxId));
  assert.ok(call.args.includes("tmux"));
});
