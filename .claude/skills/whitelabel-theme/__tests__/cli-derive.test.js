"use strict";

// Unit tests for the pure colour math + token derivation in cli-derive.js.
// Oracles are hand-computed and implementation-independent. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");
const {
  parseHex,
  toHex,
  mix,
  lighten,
  darken,
  relLuminance,
  contrastRatio,
  contrastFloor,
  hslToHex,
  saturationOf,
  shimmer,
  deriveTokens,
} = require(path.join(SKILL_DIR, "cli-derive.js"));
const { CC_TOKENS } = require(path.join(SKILL_DIR, "build-theme.js"));

const HEX = /^#[0-9a-fA-F]{6}$/;

test("parseHex handles #rgb and #rrggbb, rejects junk", () => {
  assert.deepEqual(parseHex("#abc"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseHex("#0A0612"), { r: 10, g: 6, b: 18 });
  assert.throws(() => parseHex("rgb(0,0,0)"));
  assert.throws(() => parseHex("#xyzxyz"));
  assert.throws(() => parseHex(123));
});

test("mix is linear sRGB with hand oracles", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  // 0 + 255*0.5 = 127.5 -> round 128 = 0x80
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  // clamps t out of range
  assert.equal(mix("#000000", "#ffffff", 2), "#ffffff");
});

test("lighten/darken are mix toward white/black", () => {
  assert.equal(lighten("#000000", 0.5), "#808080");
  assert.equal(darken("#ffffff", 0.5), "#808080");
  assert.equal(lighten("#ffffff", 0.3), "#ffffff");
  assert.equal(darken("#000000", 0.3), "#000000");
});

test("relLuminance + contrastRatio extremes", () => {
  assert.equal(relLuminance("#000000"), 0);
  assert.equal(relLuminance("#ffffff"), 1);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#123456", "#123456"), 1);
});

test("hslToHex hits primary colours", () => {
  assert.equal(hslToHex(0, 1, 0.5), "#ff0000");
  assert.equal(hslToHex(120, 1, 0.5), "#00ff00");
  assert.equal(hslToHex(240, 1, 0.5), "#0000ff");
  // hue wraps
  assert.equal(hslToHex(360, 1, 0.5), "#ff0000");
});

test("saturationOf is 0 for achromatic, 1 for pure", () => {
  assert.equal(saturationOf("#808080"), 0);
  assert.equal(saturationOf("#000000"), 0);
  assert.equal(saturationOf("#ff0000"), 1);
});

test("shimmer is luminance-aware (lighten dark, darken light)", () => {
  // On a dark base, shimmer brightens; on a light base it darkens.
  assert.equal(shimmer("#808080", "dark"), lighten("#808080", 0.14));
  assert.equal(shimmer("#808080", "light"), darken("#808080", 0.14));
  assert.equal(shimmer("#808080", "light-ansi"), darken("#808080", 0.14));
});

test("contrastFloor pushes low-contrast colours away from bg, keeps good ones", () => {
  // Near-bg colour gets pushed until it clears the floor.
  const pushed = contrastFloor("#0a0a0a", "#000000", 1.6);
  assert.notEqual(pushed, "#0a0a0a");
  assert.ok(contrastRatio(pushed, "#000000") >= 1.6);
  // Already-high-contrast colour is returned unchanged.
  assert.equal(contrastFloor("#ffffff", "#000000", 1.6), "#ffffff");
  // Mid-tone bg: must push toward the higher-headroom extreme (black for
  // #aaaaaa), not the luminance<0.5 default. Toward white it could only reach
  // ~2.3; toward black it clears 3 easily.
  const mid = contrastFloor("#a0a0a0", "#aaaaaa", 3);
  assert.ok(
    contrastRatio(mid, "#aaaaaa") >= 3,
    `mid-grey floor should reach 3, got ${contrastRatio(mid, "#aaaaaa")}`,
  );
});

test("deriveTokens covers exactly CC_TOKENS, all valid hex", () => {
  const palette = {
    bg: "#0A0612",
    text: "#F8F8FF",
    brand: "#FF007F",
    accent: "#00F0FF",
    success: "#39FF14",
    error: "#FF1A1A",
    warning: "#FFE600",
    userText: "#FF007F",
  };
  const out = deriveTokens(palette, { base: "dark" });
  const keys = Object.keys(out);
  assert.equal(
    keys.length,
    CC_TOKENS.size,
    "derived count must equal CC_TOKENS",
  );
  for (const k of keys) {
    assert.ok(CC_TOKENS.has(k), `derived unknown token "${k}"`);
    assert.match(out[k], HEX, `token "${k}" must be valid hex, got ${out[k]}`);
  }
  for (const t of CC_TOKENS) {
    assert.ok(t in out, `CC token "${t}" was not derived`);
  }
});

test("deriveTokens is idempotent / deterministic", () => {
  const palette = {
    bg: "#1a1a2e",
    text: "#e0e0ff",
    brand: "#6366f1",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
  };
  const a = deriveTokens(palette, { base: "dark" });
  const b = deriveTokens(palette, { base: "dark" });
  assert.deepEqual(a, b);
  // base must actually influence output (shimmer + lightness differ).
  const lightOut = deriveTokens(palette, { base: "light" });
  assert.notDeepEqual(a, lightOut);
});

test("deriveTokens accepts #rgb shorthand palette colours", () => {
  const out = deriveTokens(
    {
      bg: "#000",
      text: "#fff",
      brand: "#f0a",
      success: "#0f0",
      error: "#f00",
      warning: "#ff0",
    },
    { base: "dark" },
  );
  assert.equal(Object.keys(out).length, 55);
  for (const v of Object.values(out)) assert.match(v, HEX);
});

test("dimmed diffs are floored (not invisible) on a low-contrast dark bg", () => {
  const out = deriveTokens(
    {
      bg: "#101010",
      text: "#e0e0e0",
      brand: "#6366f1",
      success: "#22c55e",
      error: "#ef4444",
      warning: "#f59e0b",
    },
    { base: "dark" },
  );
  assert.ok(contrastRatio(out.diffAddedDimmed, "#101010") >= 1.25);
  assert.ok(contrastRatio(out.diffRemovedDimmed, "#101010") >= 1.25);
});

test("light-theme diffs respect the contrast floor (not invisible)", () => {
  const palette = {
    bg: "#ffffff",
    text: "#1a1a1a",
    brand: "#1d4ed8",
    success: "#16a34a",
    error: "#dc2626",
    warning: "#d97706",
  };
  const out = deriveTokens(palette, { base: "light" });
  assert.ok(contrastRatio(out.diffRemoved, "#ffffff") >= 1.6);
  assert.ok(contrastRatio(out.diffAdded, "#ffffff") >= 1.6);
  assert.ok(contrastRatio(out.text, "#ffffff") >= 3);
});

test("achromatic brand still yields a real full-spectrum rainbow", () => {
  const palette = {
    bg: "#000000",
    text: "#ffffff",
    brand: "#808080", // grey: S=0, must not collapse the spectrum
    success: "#22c55e",
    error: "#ef4444",
    warning: "#eab308",
  };
  const out = deriveTokens(palette, { base: "dark" });
  // The seven rainbow stops must be visibly distinct hues, not near-duplicates.
  const stops = [
    out.rainbow_red,
    out.rainbow_yellow,
    out.rainbow_green,
    out.rainbow_blue,
    out.rainbow_violet,
  ];
  assert.equal(new Set(stops).size, stops.length, "rainbow stops must differ");
  // red and blue should be far apart, not both pink/grey.
  assert.ok(contrastRatio(out.rainbow_red, out.rainbow_blue) > 1.1);
});
