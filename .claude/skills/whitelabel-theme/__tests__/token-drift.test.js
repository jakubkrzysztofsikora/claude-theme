"use strict";

// Token-drift guardrail: the offline half of the guard. The live `--check`
// against an installed claude binary runs in `claude-theme doctor` / CI; here we
// assert the in-code CC_TOKENS set never diverges from the committed lockfile.
// A code/lock divergence therefore fails with no binary present. Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL_DIR = path.resolve(__dirname, "..");
const { CC_TOKENS } = require(path.join(SKILL_DIR, "build-theme.js"));
const LOCKFILE_PATH = path.resolve(
  SKILL_DIR,
  "../../../scripts/cc-tokens.lock.json",
);

test("cc-tokens.lock.json is valid and well-formed", () => {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, "utf8"));
  assert.equal(typeof lock.version, "string", "lock.version must be a string");
  assert.ok(lock.version.length > 0, "lock.version must not be empty");
  assert.ok(Array.isArray(lock.tokens), "lock.tokens must be an array");
  assert.ok(lock.tokens.length > 0, "lock.tokens must not be empty");
  // No duplicates in the lockfile.
  assert.equal(
    new Set(lock.tokens).size,
    lock.tokens.length,
    "lock.tokens must not contain duplicates",
  );
});

test("CC_TOKENS deep-equals cc-tokens.lock.json tokens (order-independent)", () => {
  const lock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, "utf8"));
  // Compare as sorted arrays so ordering differences are not false positives,
  // while membership divergence (added/removed) still fails loudly.
  const fromCode = [...CC_TOKENS].sort();
  const fromLock = [...lock.tokens].sort();
  assert.deepEqual(
    fromCode,
    fromLock,
    "CC_TOKENS and cc-tokens.lock.json have drifted. Regenerate the lockfile: " +
      "node -e \"const {CC_TOKENS}=require('./.claude/skills/whitelabel-theme/build-theme.js');" +
      'process.stdout.write(JSON.stringify({version:"<v>",tokens:[...CC_TOKENS]},null,2))" ' +
      "> scripts/cc-tokens.lock.json",
  );
});
