"use strict";

// Pure unit tests for warp-channel.js (no I/O). Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");
const REPO = path.resolve(SKILL_DIR, "../../..");
const THEMES = path.join(REPO, "themes");

const warp = require(path.join(SKILL_DIR, "warp-channel.js"));
const { buildClaudeCodeTheme } = require(
  path.join(SKILL_DIR, "build-theme.js"),
);
const { relLuminance } = require(path.join(SKILL_DIR, "cli-derive.js"));

const HEX = /^#[0-9a-f]{6}$/;

function listThemes() {
  return fs
    .readdirSync(THEMES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(THEMES, e.name, "theme.json"))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
}

// The real worst-case settings.toml shape: nested multi-line inline table + trailing
// comma, a sibling system_theme key, and a [privacy] single-quoted regex full of braces.
const REAL_FIXTURE = [
  "[privacy]",
  "telemetry = false",
  "redact = ['\\\\b\\\\d{4,6}\\\\b', 'foo{1,3}bar', '[}{]']",
  "",
  "[appearance.cursor]",
  'cursor_display_type = "block"',
  "",
  "[appearance.themes]",
  "theme = {",
  '  custom_base_16 = { name = "Base16 Macintosh", path = "/Users/x/.warp/themes/b.yaml" },',
  "}",
  "system_theme = false",
  "",
  "[appearance.window]",
  "zoom_level = 110",
  "",
].join("\n");

// --- resolveHex (case 24) ----------------------------------------------------
test("resolveHex: hex/#rgb/rgb() -> lowercase #rrggbb; ansi -> fallback; never NaN", () => {
  assert.equal(warp.resolveHex("#ABC", "#000000"), "#aabbcc");
  assert.equal(warp.resolveHex("#FF0080", "#000000"), "#ff0080");
  assert.equal(warp.resolveHex("rgb(255, 0, 128)", "#000000"), "#ff0080");
  assert.equal(warp.resolveHex("rgb(300, -5, 128)", "#000000"), "#ff0080"); // clamp
  assert.equal(warp.resolveHex("ansi:magentaBright", "#abcdef"), "#abcdef"); // fallback
  assert.equal(warp.resolveHex("ansi256(5)", "#abcdef"), "#abcdef");
  assert.equal(warp.resolveHex(undefined, "#abcdef"), "#abcdef");
  assert.equal(warp.resolveHex("garbage", undefined), undefined);
  for (const v of ["ansi:x", "rgb(1,2,3)", "#abc", undefined]) {
    const out = warp.resolveHex(v, "#112233");
    assert.ok(out === undefined || HEX.test(out), `no NaN: ${out}`);
  }
});

// --- buildWarpTheme: per-theme invariants (cases 20-23, accent oracle, 26a) --
for (const theme of listThemes()) {
  test(`buildWarpTheme invariants: ${theme.id}`, () => {
    const cc = buildClaudeCodeTheme(theme);
    const yaml = warp.buildWarpTheme(theme, cc);
    const get = (k) =>
      (yaml.match(new RegExp(`(?:^|\\n)${k}: '?([^'\\n]+)'?`)) || [])[1];

    // Case 22: cross-channel background blend.
    const expectBg = warp.resolveHex(
      cc.overrides.userMessageBackground,
      warp.resolveHex(theme.tokens.color.background),
    );
    assert.equal(
      get("background"),
      expectBg,
      "warp bg == cc userMessageBackground",
    );

    // accent oracle.
    const t = theme.terminal || {};
    const expectAccent = warp.resolveHex(
      t.promptColor,
      warp.resolveHex(theme.tokens.color.brandPrimary),
    );
    assert.equal(get("accent"), expectAccent, "accent source chain");

    // Every emitted hex (incl accent/foreground) is valid lowercase #rrggbb.
    const hexes = yaml.match(/#[0-9A-Za-z]{3,6}/g) || [];
    for (const h of hexes) assert.ok(HEX.test(h), `valid lowercase hex: ${h}`);

    // Case 20: details keyword by polarity.
    const lum = relLuminance(expectBg);
    assert.equal(get("details"), lum < 0.5 ? "darker" : "lighter");

    // Case 23: ANSI black/white polarity + separation (catches inversion + two-darks).
    const black = (yaml.match(/normal:\n    black: '([^']+)'/) || [])[1];
    const whiteMatch = yaml.match(/normal:[\s\S]*?white: '([^']+)'/);
    const white = whiteMatch && whiteMatch[1];
    assert.ok(black && white, "black + white emitted");
    const lb = relLuminance(black);
    const lw = relLuminance(white);
    assert.ok(
      lb < 0.5 && lw > 0.5,
      `polarity black=${lb} white=${lw} (${theme.id})`,
    );
    assert.ok(lw - lb > 0.3, `separation ${lw - lb} (${theme.id})`);
  });
}

// --- case 21: bright = lighten(normal, 0.25) --------------------------------
test("buildWarpTheme: bright.red is lighter than normal.red", () => {
  const theme =
    listThemes().find((t) => t.id === "neon-district") || listThemes()[0];
  const yaml = warp.buildWarpTheme(theme, buildClaudeCodeTheme(theme));
  const nr = (yaml.match(/normal:[\s\S]*?red: '([^']+)'/) || [])[1];
  const br = (yaml.match(/bright:[\s\S]*?red: '([^']+)'/) || [])[1];
  assert.ok(nr && br && HEX.test(br));
  assert.ok(
    relLuminance(br) >= relLuminance(nr),
    "bright red >= normal red luminance",
  );
});

// --- case 25: name escaping --------------------------------------------------
test("buildWarpTheme: name with colon -> quoted YAML scalar", () => {
  const theme = listThemes()[0];
  const cloned = JSON.parse(JSON.stringify(theme));
  cloned.name = "Solarized: Dark";
  const yaml = warp.buildWarpTheme(cloned, buildClaudeCodeTheme(cloned));
  assert.ok(
    yaml.includes('name: "Solarized: Dark"'),
    "double-quoted scalar with colon",
  );
});

// --- case 26a: deriveAll:false omitting status colours -> slots omitted -----
test("buildWarpTheme: omits unresolved ANSI slots, no #NaN/#undefined", () => {
  const theme = JSON.parse(JSON.stringify(listThemes()[0]));
  theme.terminal = { base: "dark" }; // deriveAll off, no friendly status colours
  delete theme.tokens.color.error;
  delete theme.tokens.color.success;
  delete theme.tokens.color.warning;
  const yaml = warp.buildWarpTheme(theme, buildClaudeCodeTheme(theme));
  assert.ok(!/#NaN|#undefined|undefined/.test(yaml), "no NaN/undefined leaked");
  assert.ok(!/red:/.test(yaml), "red slot omitted");
  assert.ok(
    /black:/.test(yaml) && /white:/.test(yaml),
    "anchors still present",
  );
});

// --- TOML editor (cases 10-17) ----------------------------------------------
test("locate: nested multi-line inline table + trailing comma", () => {
  const loc = warp.locateThemeValue(REAL_FIXTURE);
  assert.equal(loc.kind, "found");
  assert.ok(loc.value.startsWith("{"), "value starts with brace");
  assert.ok(loc.value.includes("custom_base_16"), "captures full nested table");
  assert.ok(loc.value.trimEnd().endsWith("}"), "ends at outer brace");
});

test("replace: byte-preserve everything else incl system_theme + [privacy]", () => {
  const loc = warp.locateThemeValue(REAL_FIXTURE);
  const out = warp.replaceThemeValue(
    REAL_FIXTURE,
    loc,
    loc.indent + "theme = { x = 1 }",
  );
  assert.ok(out.includes("system_theme = false"), "sibling preserved");
  assert.ok(out.includes("foo{1,3}bar"), "[privacy] regex preserved");
  assert.ok(out.includes("zoom_level = 110"), "later section preserved");
  assert.ok(out.includes("theme = { x = 1 }"));
  assert.ok(!out.includes("custom_base_16"), "old value gone");
});

test("locate: system_theme sibling is NOT matched as the theme key", () => {
  const txt = '[appearance.themes]\nsystem_theme = false\ntheme = "X"\n';
  const loc = warp.locateThemeValue(txt);
  assert.equal(loc.kind, "found");
  assert.equal(loc.value, '"X"');
});

test("locate: theme under [appearance] (not .themes) -> duplicate bail", () => {
  const txt = '[appearance]\ntheme = "X"\n\n[other]\nk = 1\n';
  assert.equal(warp.locateThemeValue(txt).kind, "duplicate");
});

test("locate: CRLF round-trips; no-trailing-newline preserved", () => {
  const txt = '[appearance.themes]\r\ntheme = "A"\r\nsystem_theme = false';
  const loc = warp.locateThemeValue(txt);
  const out = warp.replaceThemeValue(txt, loc, 'theme = "B"');
  assert.ok(out.includes("\r\n"), "CRLF preserved");
  assert.ok(!out.endsWith("\n"), "no trailing newline added");
  assert.ok(out.includes("system_theme = false"));
});

test("locate: theme=, theme  =, tab-indent all located", () => {
  for (const line of ['theme="A"', 'theme  = "A"', '\ttheme = "A"']) {
    const loc = warp.locateThemeValue("[appearance.themes]\n" + line + "\n");
    assert.equal(loc.kind, "found", line);
    assert.equal(loc.value, '"A"');
  }
});

test("locate: comment containing } is ignored by the brace matcher", () => {
  const txt = "[appearance.themes]\ntheme = { a = 1 } # trailing } brace\n";
  const loc = warp.locateThemeValue(txt);
  assert.equal(loc.kind, "found");
  assert.ok(loc.value.trimEnd().endsWith("}") && !loc.value.includes("#"));
});

test("locate: never-closing brace and multiline string -> malformed bail", () => {
  assert.equal(
    warp.locateThemeValue("[appearance.themes]\ntheme = { a = 1\n").kind,
    "malformed",
  );
  assert.equal(
    warp.locateThemeValue('[appearance.themes]\ntheme = { a = """x\ny""" }\n')
      .kind,
    "malformed",
  );
});

// --- removeThemeValue (backs tests 8 & 33) ----------------------------------
test("remove: self-inserted empty section -> header gone", () => {
  let txt = "[other]\nk = 1\n";
  const ins = warp.insertThemeKey(
    txt,
    warp.locateThemeValue(txt),
    'theme = "A"',
    "\n",
  );
  assert.equal(ins.sectionInserted, true);
  const loc = warp.locateThemeValue(ins.text);
  const out = warp.removeThemeValue(ins.text, loc, {
    removeEmptySection: true,
  });
  assert.ok(
    !out.includes("[appearance.themes]"),
    "empty section header removed",
  );
  assert.ok(out.includes("[other]"), "unrelated section preserved");
});

test("remove: theme beside system_theme -> sibling + header survive", () => {
  const txt = '[appearance.themes]\ntheme = "A"\nsystem_theme = false\n';
  const loc = warp.locateThemeValue(txt);
  const out = warp.removeThemeValue(txt, loc, { removeEmptySection: true });
  assert.ok(
    out.includes("[appearance.themes]"),
    "header kept (body not empty)",
  );
  assert.ok(out.includes("system_theme = false"), "sibling kept");
  assert.ok(!/theme = "A"/.test(out), "theme line removed");
});

test("remove: removeEmptySection:false keeps header even if empty", () => {
  let txt = "[other]\nk = 1\n";
  const ins = warp.insertThemeKey(
    txt,
    warp.locateThemeValue(txt),
    'theme = "A"',
    "\n",
  );
  const loc = warp.locateThemeValue(ins.text);
  const out = warp.removeThemeValue(ins.text, loc, {
    removeEmptySection: false,
  });
  assert.ok(out.includes("[appearance.themes]"), "header kept");
});

// --- insert: missing section vs existing section -----------------------------
test("insert: existing [appearance.themes] without theme -> insert after header", () => {
  const txt = "[appearance.themes]\nsystem_theme = false\n";
  const loc = warp.locateThemeValue(txt);
  assert.equal(loc.kind, "missing");
  assert.equal(loc.sectionExists, true);
  const ins = warp.insertThemeKey(txt, loc, 'theme = "A"', "\n");
  assert.equal(ins.sectionInserted, false);
  assert.ok(/\[appearance\.themes\]\ntheme = "A"\nsystem_theme/.test(ins.text));
});

// --- round-trip identity (foundation for Phase-2 test 18) -------------------
test("round-trip: replace-with-original restores byte-identical", () => {
  const loc = warp.locateThemeValue(REAL_FIXTURE);
  const original = REAL_FIXTURE.slice(loc.start, loc.end);
  const changed = warp.replaceThemeValue(
    REAL_FIXTURE,
    loc,
    loc.indent + 'theme = "Z"',
  );
  const loc2 = warp.locateThemeValue(changed);
  const restored = warp.replaceThemeValue(changed, loc2, original);
  assert.equal(restored, REAL_FIXTURE, "byte-identical after replace->restore");
});
