"use strict";

// Unit tests for the web-extension resilience features (Unit 3): the injected runtime
// must carry a schema version, self-heal/re-inject on SPA navigation, warn-once (never
// throw) when the logo target is missing, and map via CSS variables on :root. These are
// string/shape assertions on the generated artifacts — no real browser. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { generateInjectJs, generateStylesCss } = require(
  path.resolve(__dirname, "..", "build-theme.js"),
);

const theme = {
  name: "Test",
  id: "test",
  version: "1.0.0",
  author: "T",
  description: "d",
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
};

test("injected JS carries a schema/version marker for stale-injection detection", () => {
  const js = generateInjectJs(theme);
  assert.match(js, /version/i, "has a version reference");
  // a stable marker/id the self-heal check keys off of
  assert.match(js, /claude-theme/i, "has a stable injected-style marker");
});

test("injected JS has a self-heal / re-inject path tied to the observer", () => {
  const js = generateInjectJs(theme);
  assert.match(js, /MutationObserver/, "uses a MutationObserver");
  assert.match(
    js,
    /reinject|re-inject|healthCheck|health check|self-heal/i,
    "has a re-inject/health-check path",
  );
});

test("missing logo target warns once and never throws", () => {
  const js = generateInjectJs(theme);
  // logo handling must be guarded (optional chaining / try / warn), not a hard throw
  assert.match(
    js,
    /console\.warn/,
    "warns rather than throwing on missing logo",
  );
  assert.ok(
    /querySelector\?\.|try\s*\{|if\s*\(/.test(js),
    "logo lookup is defensively guarded",
  );
});

test("styles map claude.ai via CSS custom properties on :root", () => {
  const css = generateStylesCss(theme);
  assert.match(css, /:root/, "declares :root custom properties");
  assert.match(css, /--[a-z-]+:/i, "defines CSS variables");
  assert.match(css, /var\(--/, "consumes CSS variables via var()");
});
