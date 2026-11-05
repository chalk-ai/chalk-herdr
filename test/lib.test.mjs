import assert from "node:assert/strict";
import test from "node:test";
import { attachArgs, chalkArgs, uploadable } from "../src/lib.mjs";

test("uploadable drops secrets and .git", () => {
  assert.deepEqual(uploadable(["a.py", ".env", "x/.env.local", ".git/config", "k.pem", "src/b.ts"]), ["a.py", "src/b.ts"]);
});

test("apiHost becomes --api-host", () => {
  assert.deepEqual(chalkArgs({ apiHost: "https://h" }, ["sandbox", "list"]), ["sandbox", "list", "--api-host", "https://h"]);
  assert.deepEqual(chalkArgs({}, ["sandbox", "list"]), ["sandbox", "list"]);
});

test("attach uses tmux new-session -A", () => {
  assert.ok(attachArgs({}, "id1").join(" ").includes("tmux new-session -A -s agent"));
});

test("--api-host goes before the remote command separator", () => {
  const a = chalkArgs({ apiHost: "https://h" }, ["sandbox", "exec", "--id", "x", "--", "tar", "-x"]);
  assert.deepEqual(a, ["sandbox", "exec", "--id", "x", "--api-host", "https://h", "--", "tar", "-x"]);
  assert.ok(attachArgs({ apiHost: "https://h" }, "x").indexOf("--api-host") < attachArgs({ apiHost: "https://h" }, "x").indexOf("--"));
});
