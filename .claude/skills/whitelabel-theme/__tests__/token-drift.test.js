"use strict";

// Token-drift guardrail (offline half): CC_TOKENS in build-theme.js is the
// authoritative override-token set; scripts/cc-tokens.lock.json pins the same
// set so a live `--check` against an installed claude binary can detect drift.
// If code and lock ever diverge (someone edits one without the other), this test
// fails — even with no claude binary present. The live half lives in the
// token-drift CI workflow (runs `extract-cc-tokens.js --check`).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { CC_TOKENS } = require("../build-theme.js");
const LOCKFILE = path.resolve(
  __dirname,
  "../../../../scripts/cc-tokens.lock.json",
);

test("CC_TOKENS deep-equals the lockfile token set (order-independent)", () => {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  assert.ok(Array.isArray(lock.tokens), "lockfile has a tokens array");

  const code = [...CC_TOKENS].sort();
  const locked = [...lock.tokens].sort();
  assert.deepEqual(
    code,
    locked,
    "CC_TOKENS (build-theme.js) and cc-tokens.lock.json have diverged — " +
      "update both together",
  );
});

test("lockfile has no duplicate tokens", () => {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  assert.equal(
    new Set(lock.tokens).size,
    lock.tokens.length,
    "lockfile tokens contain duplicates",
  );
});

test("lockfile declares a version string", () => {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  assert.equal(typeof lock.version, "string");
  assert.ok(lock.version.length > 0, "version is non-empty");
});
