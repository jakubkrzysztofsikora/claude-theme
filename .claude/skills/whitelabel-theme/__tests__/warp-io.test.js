"use strict";

// Integration tests for the Warp I/O wiring in build-theme.js. Each case runs the
// CLI as a subprocess with HOME pointed at a temp dir, so nothing touches the real
// ~/.warp or ~/.claude. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const BUILD = path.join(SKILL_DIR, "build-theme.js");
const REPO = path.resolve(SKILL_DIR, "../../..");
const THEMES = path.join(REPO, "themes");

const NATURE = path.join(THEMES, "nature", "theme.json"); // id forest-canopy
const CYBER = path.join(THEMES, "cyberpunk", "theme.json"); // id neon-district

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "warp-io-"));
}

// Run the CLI with an isolated HOME (+ optional extra env, e.g. WL_WARP_FAULT).
// Captures BOTH streams; `out` is the combined text (log() writes to stderr,
// console.log to stdout, so callers assert against the combination).
function run(home, args, extraEnv = {}) {
  const r = spawnSync("node", [BUILD, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    cwd: REPO,
    encoding: "utf8",
  });
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  return { status: r.status ?? 1, stdout, stderr, out: stdout + stderr };
}

const settingsPath = (home) => path.join(home, ".warp", "settings.toml");
const statePath = (home) =>
  path.join(home, ".warp", "themes", ".whitelabel-state.json");
const yamlPath = (home, id) => path.join(home, ".warp", "themes", `${id}.yaml`);
const bakPath = (home) =>
  path.join(home, ".warp", "settings.toml.whitelabel.bak");
const read = (p) => fs.readFileSync(p, "utf8");

function seedSettings(home, body) {
  fs.mkdirSync(path.join(home, ".warp"), { recursive: true });
  fs.writeFileSync(settingsPath(home), body);
}

const ORIGINAL =
  '[appearance.themes]\ntheme = "Base16 Macintosh"\nsystem_theme = false\n';

// 1 — apply A -> apply B -> reset restores the PRE-AUTOMATION original (not A/B).
test("apply A -> apply B -> reset restores pre-automation original", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  assert.equal(run(home, ["apply", NATURE]).status, 0);
  assert.equal(run(home, ["apply", CYBER]).status, 0);
  assert.equal(run(home, ["reset"]).status, 0);
  assert.equal(
    read(settingsPath(home)),
    ORIGINAL,
    "byte-identical original restored",
  );
  assert.ok(!fs.existsSync(statePath(home)), "state cleared");
});

// 2 — apply A -> apply A is idempotent (settings byte-identical, original preserved).
test("apply A -> apply A is idempotent", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  run(home, ["apply", NATURE]);
  const after1 = read(settingsPath(home));
  const state1 = read(statePath(home));
  run(home, ["apply", NATURE]);
  assert.equal(
    read(settingsPath(home)),
    after1,
    "settings byte-identical on re-apply",
  );
  assert.equal(read(statePath(home)), state1, "state unchanged");
});

// 3 — double reset is a clean no-op the second time.
test("apply -> reset -> reset (double reset no-op)", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  run(home, ["apply", NATURE]);
  assert.equal(run(home, ["reset"]).status, 0);
  const after = read(settingsPath(home));
  assert.equal(run(home, ["reset"]).status, 0);
  assert.equal(read(settingsPath(home)), after, "second reset changes nothing");
});

// 4 — reset with no prior apply: exit 0, no ~/.warp created.
test("reset with no prior apply is a clean no-op", () => {
  const home = tmpHome();
  assert.equal(run(home, ["reset"]).status, 0);
  assert.ok(
    !fs.existsSync(path.join(home, ".warp")),
    "~/.warp not created by reset",
  );
});

// 5 — apply, delete YAML, reset: no throw, settings still restored.
test("apply -> delete YAML -> reset still restores settings", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  run(home, ["apply", NATURE]);
  fs.unlinkSync(yamlPath(home, "forest-canopy"));
  assert.equal(run(home, ["reset"]).status, 0);
  assert.equal(read(settingsPath(home)), ORIGINAL);
});

// 6 — apply, delete state, reset: orphan YAML cleaned via CC slugHint.
test("apply -> delete state -> reset cleans orphan YAML via CC slug", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  run(home, ["apply", NATURE]); // also sets ~/.claude theme custom:forest-canopy
  fs.unlinkSync(statePath(home));
  assert.ok(fs.existsSync(yamlPath(home, "forest-canopy")));
  assert.equal(run(home, ["reset"]).status, 0);
  assert.ok(
    !fs.existsSync(yamlPath(home, "forest-canopy")),
    "orphan YAML removed via slugHint",
  );
});

// 7 — insert lines above the section, reset re-locates by content.
test("apply -> edit lines above section -> reset restores correct value", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  run(home, ["apply", NATURE]);
  const cur = read(settingsPath(home));
  fs.writeFileSync(settingsPath(home), "# prepended\n# lines\n" + cur);
  assert.equal(run(home, ["reset"]).status, 0);
  const out = read(settingsPath(home));
  assert.ok(
    out.startsWith("# prepended\n# lines\n"),
    "prepended lines preserved",
  );
  assert.ok(
    out.includes('theme = "Base16 Macintosh"'),
    "original value restored",
  );
  assert.ok(!out.includes("custom_forest_canopy"), "our value removed");
});

// 8 — fresh machine (no ~/.warp): apply creates minimal file; reset -> no theme key.
test("fresh machine: apply creates minimal settings; reset removes our section", () => {
  const home = tmpHome();
  const res = run(home, ["apply", NATURE]);
  assert.equal(res.status, 0);
  const s = read(settingsPath(home));
  assert.ok(
    s.includes("[appearance.themes]") && s.includes("custom_forest_canopy"),
  );
  assert.equal(run(home, ["reset"]).status, 0);
  assert.ok(
    !read(settingsPath(home)).includes("custom_forest_canopy"),
    "theme removed",
  );
  assert.ok(
    !read(settingsPath(home)).includes("[appearance.themes]"),
    "self-inserted section removed",
  );
});

// 18 — round-trip: apply then reset is byte-identical to the seed.
test("round-trip apply -> reset is byte-identical (real-shape seed)", () => {
  const home = tmpHome();
  const seed =
    '[appearance.themes]\ntheme = {\n  custom_base_16 = { name = "Base16", path = "/x.yaml" },\n}\nsystem_theme = false\n';
  seedSettings(home, seed);
  run(home, ["apply", NATURE]);
  run(home, ["reset"]);
  assert.equal(
    read(settingsPath(home)),
    seed,
    "byte-identical after apply->reset",
  );
});

// 19 + 19a — crash before settings rename: original intact; .bak byte-identical.
test("crash-before-rename leaves settings.toml intact; .bak == pre-automation", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  const res = run(home, ["apply", NATURE], {
    WL_WARP_FAULT: "crash-before-rename",
  });
  assert.notEqual(res.status, 0, "apply crashes (non-zero exit)");
  assert.equal(
    read(settingsPath(home)),
    ORIGINAL,
    "settings.toml not torn / unchanged",
  );
  assert.equal(
    read(bakPath(home)),
    ORIGINAL,
    ".bak is the pre-automation original",
  );
});

// 26 — validation-forbidden name -> apply exits non-zero before buildWarpTheme.
test("forbidden theme name -> apply exits non-zero, no Warp YAML written", () => {
  const home = tmpHome();
  const bad = JSON.parse(read(NATURE));
  bad.name = 'Bad" name';
  bad.id = "bad-theme";
  const f = path.join(home, "bad.json");
  fs.writeFileSync(f, JSON.stringify(bad));
  const res = run(home, ["apply", f]);
  assert.notEqual(res.status, 0, "validation rejects the name");
  assert.ok(
    !fs.existsSync(yamlPath(home, "bad-theme")),
    "no Warp YAML written",
  );
});

// 29 — abort-if-changed: concurrent edit between read and write.
test("concurrency: settings changed mid-apply -> not activated, edit survives", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  const res = run(home, ["apply", NATURE], {
    WL_WARP_FAULT: "mutate-settings",
  });
  assert.equal(res.status, 0, "apply still exits 0");
  assert.ok(/NOT activated/.test(res.out), "prints not-activated notice");
  assert.ok(
    /theme = \{ custom_forest_canopy/.test(res.out),
    "prints paste-line",
  );
  const s = read(settingsPath(home));
  assert.ok(
    s.includes("# concurrent edit"),
    "concurrent edit survives (not clobbered)",
  );
  assert.ok(!s.includes("custom_forest_canopy"), "our theme NOT written");
  assert.ok(
    fs.existsSync(yamlPath(home, "forest-canopy")),
    "YAML still written",
  );
});

// 30 — not-activated branches: malformed + duplicate.
test("not-activated: malformed settings -> warn + paste-line, YAML written", () => {
  const home = tmpHome();
  seedSettings(home, "[appearance.themes]\ntheme = { a = 1\n"); // never-closing brace
  const res = run(home, ["apply", NATURE]);
  assert.equal(res.status, 0);
  assert.ok(/NOT activated/.test(res.out));
  assert.ok(fs.existsSync(yamlPath(home, "forest-canopy")));
  assert.ok(
    read(settingsPath(home)).includes("theme = { a = 1"),
    "malformed file untouched",
  );
});

test("not-activated: theme under [appearance] -> duplicate bail, untouched", () => {
  const home = tmpHome();
  const seed = '[appearance]\ntheme = "X"\n';
  seedSettings(home, seed);
  const res = run(home, ["apply", NATURE]);
  assert.equal(res.status, 0);
  assert.ok(/NOT activated/.test(res.out));
  assert.equal(read(settingsPath(home)), seed, "untouched on duplicate bail");
});

// 32 — writeTextAtomic preserves file mode.
test("mode preservation: 0600 settings.toml stays 0600 after activation", () => {
  const home = tmpHome();
  seedSettings(home, ORIGINAL);
  fs.chmodSync(settingsPath(home), 0o600);
  run(home, ["apply", NATURE]);
  const mode = fs.statSync(settingsPath(home)).mode & 0o777;
  assert.equal(mode, 0o600, `mode preserved (got ${mode.toString(8)})`);
});

// 33 — additive insert into a settings.toml without [appearance.themes].
test("additive insert: no [appearance.themes] -> append; reset removes exactly", () => {
  const home = tmpHome();
  const seed = "[appearance.window]\nzoom_level = 110\n";
  seedSettings(home, seed);
  run(home, ["apply", NATURE]);
  const after = read(settingsPath(home));
  assert.ok(after.startsWith(seed), "original content preserved at top");
  assert.ok(
    after.includes("[appearance.themes]") &&
      after.includes("custom_forest_canopy"),
  );
  run(home, ["reset"]);
  assert.equal(
    read(settingsPath(home)),
    seed,
    "reset removes exactly what was inserted",
  );
});
