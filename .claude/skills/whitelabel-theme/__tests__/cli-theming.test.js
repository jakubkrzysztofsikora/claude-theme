"use strict";

// Isolated tests for the Claude Code CLI theming half of build-theme.js.
// Integration cases run the CLI as a subprocess with HOME pointed at a temp dir,
// so nothing touches the developer's real ~/.claude. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const BUILD = path.join(SKILL_DIR, "build-theme.js");
const REPO = path.resolve(SKILL_DIR, "../../..");
const THEMES = path.join(REPO, "themes");
const GOLDEN = path.join(__dirname, "golden");

const {
  buildClaudeCodeTheme,
  lighten,
  pickBase,
  CC_TOKENS,
  CLAUDE_THEMES_DIR,
  THEMES_DIR,
} = require(BUILD);

const HEX = /^#[0-9A-Fa-f]{6}$/;

function listThemes() {
  return fs
    .readdirSync(THEMES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(THEMES, e.name, "theme.json"))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-theme-"));
}

// Run the CLI with an isolated HOME. Returns { status, stdout, stderr }.
function run(home, args) {
  try {
    const stdout = execFileSync("node", [BUILD, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

const readSettings = (home) =>
  JSON.parse(
    fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"),
  );
const themeFilePath = (home, id) =>
  path.join(home, ".claude", "themes", `${id}.json`);

// --- pure helpers ---------------------------------------------------------

test("lighten moves a color toward white and stays valid hex", () => {
  assert.match(lighten("#0A0612"), HEX);
  assert.equal(lighten("#ffffff"), "#ffffff");
  assert.equal(lighten("#000000", 0), "#000000");
  // Hand-computed oracle (10 + (255-10)*0.06 = 24.7 -> 25 = 0x19, etc.).
  // Independent of the implementation so it would catch a bug baked into goldens too.
  assert.equal(lighten("#0A0612"), "#191520");
});

test("pickBase derives base from tags, defaults to dark", () => {
  assert.equal(pickBase({ tags: ["light", "warm"] }), "light");
  assert.equal(pickBase({ tags: ["dark-ansi", "x"] }), "dark-ansi");
  assert.equal(pickBase({ tags: ["cyberpunk"] }), "dark");
  assert.equal(pickBase({}), "dark");
});

test("THEMES_DIR (repo) and CLAUDE_THEMES_DIR (user) are distinct paths", () => {
  assert.notEqual(path.resolve(THEMES_DIR), path.resolve(CLAUDE_THEMES_DIR));
});

// --- generated theme correctness -----------------------------------------

for (const theme of listThemes()) {
  test(`buildClaudeCodeTheme matches golden + invariants: ${theme.id}`, () => {
    const out = buildClaudeCodeTheme(theme);

    // every key is a real Claude Code token; every value is #rrggbb
    for (const [k, v] of Object.entries(out.overrides)) {
      assert.ok(CC_TOKENS.has(k), `unknown token ${k}`);
      assert.match(v, HEX, `bad color for ${k}: ${v}`);
    }
    assert.ok(!("messageActionsBackground" in out.overrides));
    assert.ok(!("selectionBg" in out.overrides));
    assert.ok(out.base === pickBase(theme));
    assert.equal(out.name, theme.name);

    const golden = JSON.parse(
      fs.readFileSync(path.join(GOLDEN, `${theme.id}.json`), "utf8"),
    );
    assert.deepEqual(out, golden);
  });
}

test("falls back to tokens.color when no terminal block", () => {
  const out = buildClaudeCodeTheme({
    name: "X",
    id: "x",
    tags: ["dark"],
    tokens: { color: { brandPrimary: "#112233", background: "#000000" } },
  });
  assert.equal(out.overrides.claude, "#112233");
  assert.equal(out.overrides.userMessageBackground, "#000000");
});

test("no background anywhere → no background tokens, no nulls", () => {
  const out = buildClaudeCodeTheme({
    name: "Y",
    id: "y",
    tags: [],
    tokens: { color: { brandPrimary: "#445566" } },
  });
  assert.ok(!("userMessageBackground" in out.overrides));
  assert.ok(!("userMessageBackgroundHover" in out.overrides));
  assert.equal(out.base, "dark");
  for (const v of Object.values(out.overrides)) assert.ok(v);
});

// --- apply (integration, isolated HOME) ----------------------------------

test("apply writes a string theme ref + matching theme file", () => {
  const home = tmpHome();
  const r = run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readSettings(home).theme, "custom:neon-district");
  const written = JSON.parse(
    fs.readFileSync(themeFilePath(home, "neon-district"), "utf8"),
  );
  assert.deepEqual(
    written,
    JSON.parse(
      fs.readFileSync(path.join(GOLDEN, "neon-district.json"), "utf8"),
    ),
  );
});

test("apply preserves unrelated settings keys", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: ["x"] }, env: { A: "1" } }),
  );
  run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]);
  const s = readSettings(home);
  assert.deepEqual(s.permissions, { allow: ["x"] });
  assert.deepEqual(s.env, { A: "1" });
  assert.equal(s.theme, "custom:neon-district");
});

test("apply refuses to clobber an unparseable settings.json", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const p = path.join(home, ".claude", "settings.json");
  fs.writeFileSync(p, "{ not valid json ,,, ");
  const r = run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(p, "utf8"), "{ not valid json ,,, ");
});

test("apply A then B prunes A's orphan theme file", () => {
  const home = tmpHome();
  run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]); // neon-district
  run(home, ["apply", path.join(THEMES, "dark", "theme.json")]); // midnight-forge
  assert.ok(!fs.existsSync(themeFilePath(home, "neon-district")));
  assert.ok(fs.existsSync(themeFilePath(home, "midnight-forge")));
  assert.equal(readSettings(home).theme, "custom:midnight-forge");
});

// --- reset (integration, isolated HOME) ----------------------------------

test("apply then reset removes file and clears theme", () => {
  const home = tmpHome();
  run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]);
  const r = run(home, ["reset"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(themeFilePath(home, "neon-district")));
  assert.ok(!("theme" in readSettings(home)));
});

test("reset leaves a built-in theme string untouched", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ theme: "dark", permissions: { allow: ["x"] } }),
  );
  const r = run(home, ["reset"]);
  assert.equal(r.status, 0);
  const s = readSettings(home);
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.permissions, { allow: ["x"] });
});

test("reset with stale custom: pointing at missing file clears key without throwing", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ theme: "custom:gone" }),
  );
  const r = run(home, ["reset"]);
  assert.equal(r.status, 0);
  assert.ok(!("theme" in readSettings(home)));
});

test("reset refuses an unsafe (path-traversal) slug", () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ theme: "custom:../../evil" }),
  );
  const r = run(home, ["reset"]);
  assert.notEqual(r.status, 0);
  assert.equal(readSettings(home).theme, "custom:../../evil"); // unchanged
});

test("double reset is a no-op and exits 0", () => {
  const home = tmpHome();
  run(home, ["apply", path.join(THEMES, "cyberpunk", "theme.json")]);
  assert.equal(run(home, ["reset"]).status, 0);
  assert.equal(run(home, ["reset"]).status, 0);
});

test("reset with no settings.json at all exits 0 and creates nothing", () => {
  const home = tmpHome();
  const r = run(home, ["reset"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(home, ".claude", "settings.json")));
});
