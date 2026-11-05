import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readState, updateState, configForEntry, chalkEnv } from "../src/lib.mjs";

test("concurrent processes preserve every pane mapping", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "chalk-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const url = new URL("../src/lib.mjs", import.meta.url).href;
  await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((resolve, reject) => {
    const code = `import { updateState } from ${JSON.stringify(url)}; await updateState(${JSON.stringify(dir)}, s => { s.panes[${i}] = { sandboxId: ${i} }; });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
    let error = ""; child.stderr.on("data", (d) => { error += d; });
    child.on("error", reject);
    child.on("close", (status) => status === 0 ? resolve() : reject(new Error(error)));
  })));
  assert.equal(Object.keys((await readState(dir)).panes).length, 12);
  assert.deepEqual(await readdir(dir), ["state.json"]);
});

test("failed state updates release the lock without corrupting saved state", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "chalk-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await updateState(dir, (s) => { s.panes.one = {}; });
  await assert.rejects(updateState(dir, () => { throw new Error("fixture failure"); }), /fixture failure/);
  await updateState(dir, (s) => { s.panes.two = {}; });
  assert.deepEqual(Object.keys((await readState(dir)).panes), ["one", "two"]);
});

test("saved sandbox routing overrides changed config and inherited API host", (t) => {
  const previous = process.env.CHALK_API_SERVER;
  process.env.CHALK_API_SERVER = "https://changed.example.com";
  t.after(() => { if (previous === undefined) delete process.env.CHALK_API_SERVER; else process.env.CHALK_API_SERVER = previous; });
  const config = configForEntry({ apiHost: "https://changed.example.com", chalkDir: "/changed" }, { apiHost: "https://saved.example.com", chalkDir: "/saved" });
  assert.equal(config.apiHost, "https://saved.example.com");
  assert.equal(config.chalkDir, "/saved");
  assert.equal(chalkEnv(config).CHALK_API_SERVER, "https://saved.example.com");
  assert.equal(chalkEnv(configForEntry({}, { apiHost: null, chalkDir: "/saved" })).CHALK_API_SERVER, undefined);
});
