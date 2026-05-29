"use strict";

// Unit tests for the deterministic (zero-dependency, no-model, no-network) theme→client
// conversion core in convert/. The model-augmented path for UNKNOWN clients is a
// documented follow-on and is not exercised here. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const conv = require(path.join(ROOT, "convert", "schema-map.js"));
const registry = require(path.join(ROOT, "convert", "registry.json"));

const HEX = /^#[0-9a-f]{6}$/;
// A representative source palette keyed by Claude Code tokens.
const colors = {
  userMessageBackground: "#0F1F17",
  text: "#F0EDE5",
  error: "#D4686A",
  success: "#65A30D",
};

test("registry has the expected known clients + sources", () => {
  for (const c of ["alacritty", "kitty", "iterm2", "windows-terminal"]) {
    assert.ok(registry.clients[c], `client ${c}`);
    assert.ok(registry.clients[c].format, `client ${c} has a format`);
  }
  assert.ok(registry.sources["claude-code"], "claude-code source");
});

test("cosine is bounded [0,1] and self-similarity is 1", () => {
  const v = conv.vectorize("background");
  assert.ok(Math.abs(conv.cosine(v, v) - 1) < 1e-9, "self-similarity ~1");
  const c = conv.cosine(
    conv.vectorize("background"),
    conv.vectorize("foreground"),
  );
  assert.ok(c >= 0 && c <= 1, `cosine in range: ${c}`);
});

test("convert(alacritty) emits valid TOML with sensible mappings + confidences", () => {
  const out = conv.convert({
    sourceEntry: registry.sources["claude-code"],
    colors,
    clientEntry: registry.clients.alacritty,
    themeName: "Test",
  });
  assert.equal(out.format, "toml");
  assert.match(
    out.text,
    /\[colors\.primary\]/,
    "has a [colors.primary] section",
  );
  // every emitted hex value is valid lowercase #rrggbb
  for (const m of out.mappings) {
    if (m.value)
      assert.match(conv.normHex(m.value), HEX, `mapping value ${m.value}`);
    assert.ok(
      m.confidence >= 0 && m.confidence <= 1,
      `confidence in range: ${m.confidence}`,
    );
  }
  // the background should map into the primary section
  assert.match(out.text, /background = "#0f1f17"/);
});

test("conversion is deterministic (same input → byte-identical output)", () => {
  const args = {
    sourceEntry: registry.sources["claude-code"],
    colors,
    clientEntry: registry.clients.kitty,
    themeName: "Test",
  };
  assert.equal(conv.convert(args).text, conv.convert(args).text);
});

test("every known client format emits without throwing and yields valid hex", () => {
  for (const c of ["alacritty", "kitty", "iterm2", "windows-terminal"]) {
    const out = conv.convert({
      sourceEntry: registry.sources["claude-code"],
      colors,
      clientEntry: registry.clients[c],
      themeName: "Test",
    });
    assert.ok(
      typeof out.text === "string" && out.text.length > 0,
      `${c} produced text`,
    );
    for (const hx of out.text.match(/#[0-9a-fA-F]{6}/g) || []) {
      assert.match(hx.toLowerCase(), HEX, `${c}: valid hex ${hx}`);
    }
  }
});
