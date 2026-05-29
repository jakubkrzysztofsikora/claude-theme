"use strict";

// Regression tests for install/packaging path behavior (Phase 0): the CLI must write
// its outputs to the user's CWD (not the package dir, which is read-only under npm),
// and the generated manifest must not reference icon files the build never emits.
// Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const BUILD = path.join(SKILL_DIR, "build-theme.js");
const REPO = path.resolve(SKILL_DIR, "../../..");
const NATURE = path.join(REPO, "themes", "nature", "theme.json");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-pkg-"));
}
// Run the CLI from a chosen cwd (isolated HOME too, so nothing touches the real config).
function run(cwd, args) {
  const home = tmp();
  const r = spawnSync("node", [BUILD, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

// Snapshot the repo's extension/ + themes/ mtimes so we can prove a foreign-cwd run
// never writes back into the package.
function repoSnapshot() {
  const walk = (d) =>
    fs.existsSync(d)
      ? fs
          .readdirSync(d, { withFileTypes: true, recursive: true })
          .filter((e) => e.isFile())
          .map((e) => {
            const p = path.join(e.parentPath || e.path, e.name);
            return p + ":" + fs.statSync(p).mtimeMs;
          })
          .sort()
          .join("\n")
      : "";
  return (
    walk(path.join(REPO, "themes")) + "||" + walk(path.join(REPO, "extension"))
  );
}

test("compile writes extension/ into the CWD, not the package, and repo is untouched", () => {
  const cwd = tmp();
  const before = repoSnapshot();
  const r = run(cwd, ["compile", NATURE]);
  assert.equal(r.status, 0, r.out);
  assert.ok(
    fs.existsSync(path.join(cwd, "extension", "manifest.json")),
    "extension written under the run CWD",
  );
  assert.equal(
    repoSnapshot(),
    before,
    "repo themes/ + extension/ untouched by foreign-cwd run",
  );
});

test("compiled manifest has NO icons key (would otherwise 404 / fail CWS)", () => {
  const cwd = tmp();
  run(cwd, ["compile", NATURE]);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cwd, "extension", "manifest.json"), "utf8"),
  );
  assert.ok(!("icons" in manifest), "no top-level icons key");
  assert.ok(
    !(manifest.action && "default_icon" in manifest.action),
    "no action.default_icon",
  );
  assert.equal(manifest.manifest_version, 3);
});

test("compile --out <dir> writes to the explicit directory", () => {
  const cwd = tmp();
  const r = run(cwd, ["compile", NATURE, "--out", "build/ext"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(
    fs.existsSync(path.join(cwd, "build", "ext", "manifest.json")),
    "extension written to --out path",
  );
  assert.ok(
    !fs.existsSync(path.join(cwd, "extension")),
    "default extension/ NOT created when --out given",
  );
});

test("init writes a new theme under CWD/themes, not the package", () => {
  const cwd = tmp();
  const before = repoSnapshot();
  const r = run(cwd, ["init", "My Probe Theme"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(
    fs.existsSync(path.join(cwd, "themes", "my-probe-theme", "theme.json")),
    "new theme under CWD/themes",
  );
  assert.equal(
    repoSnapshot(),
    before,
    "repo themes/ untouched by init in a foreign cwd",
  );
});
