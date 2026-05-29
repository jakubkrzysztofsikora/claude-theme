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
  validateTheme,
  isColorValue,
  generatePopupHtml,
  lighten,
  pickBase,
  CC_TOKENS,
  VALID_BASES,
  CLAUDE_THEMES_DIR,
  THEMES_DIR,
} = require(BUILD);

// Mirror buildClaudeCodeTheme's base resolution: an explicit, valid terminal.base wins;
// otherwise the tag-inferred pickBase. (Daltonized/ansi a11y themes set an explicit base.)
function expectedBase(theme) {
  const b = theme.terminal && theme.terminal.base;
  return b && VALID_BASES.includes(b) ? b : pickBase(theme);
}

// A minimal valid theme; spread + override per test.
function validBase(extra = {}) {
  return {
    name: "Test",
    id: "test",
    version: "1.0.0",
    author: "Tester",
    description: "A test theme",
    license: "MIT",
    tags: ["dark"],
    preview: {
      background: "#000000",
      surface: "#111111",
      textPrimary: "#ffffff",
      brandPrimary: "#ff007f",
      userMessageText: "#ffffff",
    },
    tokens: {
      color: {
        brandPrimary: "#ff007f",
        background: "#0a0612",
        surface: "#1a1025",
        textPrimary: "#f8f8ff",
        userMessageText: "#ffffff",
        success: "#39ff14",
        error: "#ff1a1a",
        warning: "#ffe600",
      },
    },
    ...extra,
  };
}

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

test("CC_TOKENS pins the binary-verified set (2.1.154)", () => {
  // The subset guard elsewhere catches over-emission; this pins the set itself
  // so a careless edit or a bad version bump fails loudly. Re-verify with
  // scripts/extract-cc-tokens.js when bumping the target Claude Code version.
  assert.equal(CC_TOKENS.size, 55);
  // Canaries that must be present (distinctive, low false-positive risk):
  for (const t of [
    "claude",
    "claudeShimmer",
    "diffAdded",
    "diffRemovedWord",
    "rate_limit_fill",
    "red_FOR_SUBAGENTS_ONLY",
    "rainbow_violet_shimmer",
  ]) {
    assert.ok(CC_TOKENS.has(t), `expected CC_TOKENS to include "${t}"`);
  }
  // Phantom tokens from the docs that do NOT exist in the build:
  for (const t of [
    "messageActionsBackground",
    "selectionBg",
    "promptBorderShimmer",
    "permissionShimmer",
    "warningShimmer",
    "fastModeShimmer",
    "inactiveShimmer",
    "background",
  ]) {
    assert.ok(!CC_TOKENS.has(t), `expected CC_TOKENS to exclude "${t}"`);
  }
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
    assert.ok(out.base === expectedBase(theme));
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

// --- deriveAll, overrides, base (Phase 3 behaviour) ----------------------

test("default path (no deriveAll) emits only the friendly subset", () => {
  const out = buildClaudeCodeTheme(validBase());
  assert.ok(Object.keys(out.overrides).length <= 14);
  assert.ok(!("diffAdded" in out.overrides));
  assert.ok(!("rainbow_red" in out.overrides));
});

test("deriveAll emits the full token set; explicit terminal.* wins", () => {
  const out = buildClaudeCodeTheme(
    validBase({ terminal: { deriveAll: true, promptColor: "#abcdef" } }),
  );
  assert.equal(Object.keys(out.overrides).length, CC_TOKENS.size);
  assert.ok("diffAdded" in out.overrides);
  assert.ok("rainbow_violet_shimmer" in out.overrides);
  // explicit promptColor overrides derived claude/promptBorder
  assert.equal(out.overrides.claude, "#abcdef");
  assert.equal(out.overrides.promptBorder, "#abcdef");
});

test("terminal.overrides win over derived and friendly", () => {
  const out = buildClaudeCodeTheme(
    validBase({
      terminal: {
        deriveAll: true,
        promptColor: "#abcdef",
        overrides: { claude: "#111111", diffAdded: "#222222" },
      },
    }),
  );
  assert.equal(out.overrides.claude, "#111111"); // beats explicit promptColor
  assert.equal(out.overrides.diffAdded, "#222222"); // beats derived
});

test("terminal.base is respected; absent falls back to pickBase", () => {
  const withBase = buildClaudeCodeTheme(
    validBase({ terminal: { base: "dark-ansi" } }),
  );
  assert.equal(withBase.base, "dark-ansi");
  const noBase = buildClaudeCodeTheme(validBase());
  assert.equal(noBase.base, "dark"); // pickBase from tags
});

test("systemColor maps to planMode/ide and validates", () => {
  const theme = validBase({ terminal: { systemColor: "#00f0ff" } });
  assert.deepEqual(validateTheme(theme), []);
  const out = buildClaudeCodeTheme(theme);
  assert.equal(out.overrides.planMode, "#00f0ff");
  assert.equal(out.overrides.ide, "#00f0ff");
});

// --- validation: colorValue --------------------------------------------------

test("isColorValue accepts the documented forms, rejects the rest", () => {
  for (const v of [
    "#fff",
    "#FF007F",
    "rgb(255,0,127)",
    "rgb( 0 , 0 , 0 )",
    "ansi256(213)",
    "ansi:magentaBright",
  ]) {
    assert.ok(isColorValue(v), `should accept ${v}`);
  }
  for (const v of [
    "#ff",
    "rgb(300,0,0)",
    "ansi256(256)",
    "ansi:bogus",
    "rgb(0,0,0);url(x)",
    "#000}",
    "red",
    42,
    null,
  ]) {
    assert.ok(!isColorValue(v), `should reject ${v}`);
  }
});

// --- validation: security rejects -------------------------------------------

test("terminal.overrides rejects prototype-pollution keys", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const errs = validateTheme(
      validBase({ terminal: { overrides: { [key]: "#000000" } } }),
    );
    assert.ok(
      errs.some((e) => e.includes(key) || e.toLowerCase().includes("illegal")),
      `expected rejection for ${key}: ${errs}`,
    );
  }
  // ...and the build path does not pollute Object.prototype. Use a COMPUTED
  // key (own enumerable, mirroring JSON.parse) with a value that WOULD pollute
  // if assigned onto a prototype — a plain `{ __proto__: ... }` literal would
  // invoke the proto-setter instead and prove nothing.
  const evil = validBase({
    terminal: { overrides: { ["__proto__"]: { polluted: true } } },
  });
  validateTheme(evil);
  buildClaudeCodeTheme(evil);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("terminal.overrides rejects unknown token + bad colorValue", () => {
  assert.ok(
    validateTheme(
      validBase({ terminal: { overrides: { notAToken: "#000000" } } }),
    ).some((e) => e.includes("Unknown override token")),
  );
  assert.ok(
    validateTheme(
      validBase({ terminal: { overrides: { diffAdded: "rgb(300,0,0)" } } }),
    ).some((e) => e.includes("diffAdded")),
  );
});

test("terminal.overrides enforces a key-count cap", () => {
  const overrides = {};
  for (let i = 0; i < 201; i++) overrides[`k${i}`] = "#000000";
  assert.ok(
    validateTheme(validBase({ terminal: { overrides } })).some((e) =>
      e.includes("too many keys"),
    ),
  );
});

test("rejects CSS-breakout fontFamily and over-large tokens.color", () => {
  assert.ok(
    validateTheme(
      validBase({
        tokens: {
          color: validBase().tokens.color,
          typography: { fontFamily: "Inter; } body { background: red }" },
        },
      }),
    ).some((e) => e.includes("fontFamily")),
  );
  const color = { ...validBase().tokens.color };
  for (let i = 0; i < 201; i++) color[`x${i}`] = "#000000";
  assert.ok(
    validateTheme(validBase({ tokens: { color } })).some((e) =>
      e.includes("too many keys"),
    ),
  );
});

test("readJson rejects an oversized theme file (apply exits non-zero)", () => {
  const home = tmpHome();
  const big = path.join(home, "big-theme.json");
  const theme = JSON.parse(
    fs.readFileSync(path.join(THEMES, "cyberpunk", "theme.json"), "utf8"),
  );
  // pad with a huge, ignored field to exceed the 512KB cap
  theme._pad = "x".repeat(600 * 1024);
  fs.writeFileSync(big, JSON.stringify(theme));
  const r = run(home, ["apply", big]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /too large/i);
});

test("deriveAll requires hex success/error/warning", () => {
  const theme = validBase({ terminal: { deriveAll: true } });
  delete theme.tokens.color.success;
  assert.ok(
    validateTheme(theme).some(
      (e) => e.includes("deriveAll") && e.includes("success"),
    ),
  );
});

test("terminal rejects unknown direct keys and bad base", () => {
  assert.ok(
    validateTheme(validBase({ terminal: { bogusField: "#000000" } })).some(
      (e) => e.includes("Unknown"),
    ),
  );
  assert.ok(
    validateTheme(validBase({ terminal: { base: "neon" } })).some((e) =>
      e.includes("terminal.base"),
    ),
  );
});

test("ansi color value with non-ansi base validates (warn is runtime, not error)", () => {
  const theme = validBase({
    terminal: { base: "dark", overrides: { planMode: "ansi:cyanBright" } },
  });
  assert.deepEqual(validateTheme(theme), []);
});

// --- validation: injection / XSS boundary -----------------------------------

test("rejects breakout characters in name (incl. comment breakout)", () => {
  for (const name of [
    "x'; fetch(1); y='",
    "<img src=x>",
    "a*/b",
    "a/b",
    "back`tick",
  ]) {
    assert.ok(
      validateTheme(validBase({ name })).some((e) => e.includes('"name"')),
      `expected rejection for name ${JSON.stringify(name)}`,
    );
  }
  assert.deepEqual(validateTheme(validBase({ name: "Neon District" })), []);
});

test("rejects angle brackets in description; rejects unanchored version", () => {
  assert.ok(
    validateTheme(
      validBase({ description: "</em><img src=x onerror=alert(1)>" }),
    ).some((e) => e.includes("description")),
  );
  assert.ok(
    validateTheme(
      validBase({ version: '1.0.0"><img src=x onerror=alert(1)>' }),
    ).some((e) => e.includes("version")),
  );
  assert.deepEqual(validateTheme(validBase({ version: "1.0.0-beta.1" })), []);
});

test("generatePopupHtml escapes untrusted fields (defence in depth)", () => {
  const html = generatePopupHtml(
    validBase({ author: "</div><img src=x onerror=alert(1)>" }),
  );
  assert.ok(!html.includes("<img src=x onerror"), "author must be escaped");
  assert.ok(html.includes("&lt;") || html.includes("&#"), "expected escaping");
});
