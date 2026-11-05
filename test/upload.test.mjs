import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gitFiles, uploadWorktree, uploadable } from "../src/lib.mjs";

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), "chalk-upload-"));
  const root = path.join(base, "repo");
  const bin = path.join(base, "bin");
  mkdirSync(root); mkdirSync(bin);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; rmSync(base, { recursive: true, force: true }); });
  const executable = (name, code) => writeFileSync(path.join(bin, name), `#!${process.execPath}\n${code}\n`, { mode: 0o755 });
  const archive = path.join(base, "upload.tar");
  executable("chalk", `const fs = require('node:fs'); process.stdin.pipe(fs.createWriteStream(${JSON.stringify(archive)}));`);
  return { base, root, bin, archive, executable };
}

test("upload filters common credentials and unsafe paths", () => {
  assert.deepEqual(uploadable(["src/a.js", ".npmrc", "x/.aws/credentials", "id_ed25519", ".netrc", "key.KEY", ".chalk.yml", "../outside", "/absolute"]), ["src/a.js"]);
});

test("archive preserves hostile filenames literally and excludes credentials", async (t) => {
  const { root, archive } = fixture(t);
  const names = ["normal.txt", "-C", "line\nbreak.txt", "-C\n..\noutside.txt", "back\\slash", "space name"];
  for (const name of names) writeFileSync(path.join(root, name), name);
  writeFileSync(path.join(root, ".env"), "private fixture");
  writeFileSync(path.join(root, ".npmrc"), "private fixture");
  assert.equal(await uploadWorktree({}, "test", root), names.length);
  // Inspect tar headers directly: tar -t escapes newline names differently on macOS/Linux.
  const data = readFileSync(archive);
  for (const name of names) assert.ok(data.includes(Buffer.from(name)), `missing ${name}`);
  assert.ok(!data.includes(Buffer.from("private fixture")));
  const extracted = path.join(root, "extracted"); mkdirSync(extracted);
  const r = spawnSync("tar", ["-xf", archive, "-C", extracted]);
  assert.equal(r.status, 0, r.stderr?.toString());
  for (const name of names) assert.equal(readFileSync(path.join(extracted, name), "utf8"), name);
});

test("deleted files, symlinks, symlinked parents and submodules are not uploaded", (t) => {
  const { root, base } = fixture(t);
  writeFileSync(path.join(root, "deleted"), "gone");
  mkdirSync(path.join(root, "parent"));
  writeFileSync(path.join(root, "parent/file"), "tracked");
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  rmSync(path.join(root, "deleted"));
  rmSync(path.join(root, "parent"), { recursive: true });
  mkdirSync(path.join(base, "external"));
  writeFileSync(path.join(base, "external/file"), "private");
  symlinkSync(path.join(base, "external"), path.join(root, "parent"));
  symlinkSync(path.join(base, "external/file"), path.join(root, "link"));
  mkdirSync(path.join(root, "submodule"));
  writeFileSync(path.join(root, "submodule/.env"), "private");
  assert.equal(spawnSync("git", ["update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,submodule"], { cwd: root }).status, 0);
  assert.deepEqual(gitFiles(root), []);
});

test("a tar failure rejects even when the receiver succeeds", async (t) => {
  const { root, executable } = fixture(t);
  writeFileSync(path.join(root, "app"), "content");
  executable("tar", "process.stdin.resume(); process.stdin.on('end', () => process.exit(2));");
  await assert.rejects(uploadWorktree({}, "test", root), /tar failed/);
});

test("remote upload failure rejects without an unhandled broken pipe", async (t) => {
  const { root, executable } = fixture(t);
  writeFileSync(path.join(root, "large"), Buffer.alloc(2 * 1024 * 1024));
  executable("chalk", "process.exit(7);");
  await assert.rejects(uploadWorktree({}, "test", root));
});

test("a missing upload executable rejects cleanly", async (t) => {
  const { root, bin } = fixture(t);
  process.env.PATH = bin;
  // gitFiles must run first, so provide a small git stand-in.
  writeFileSync(path.join(bin, "git"), `#!${process.execPath}\nprocess.stdout.write('');`, { mode: 0o755 });
  rmSync(path.join(bin, "chalk"));
  await assert.rejects(uploadWorktree({}, "test", root), /ENOENT/);
});
