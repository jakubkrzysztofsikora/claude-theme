#!/usr/bin/env node
"use strict";

/**
 * Verify Claude Code custom-theme override tokens against an installed claude
 * binary. The token list in build-theme.js (CC_TOKENS) is authoritative only
 * for the build it was checked against; Claude Code renames/removes tokens
 * between versions. Run this when bumping the target version.
 *
 * Method: tokens appear in the minified bundle as quoted object keys / string
 * literals (e.g. `"diffAdded"`). A token with zero quoted occurrences does not
 * exist in that build. Whole-line matching is unreliable (short names collide,
 * minified vars like `selectionBgCode` create false positives), so we count
 * the quoted form only.
 *
 * Usage:
 *   node scripts/extract-cc-tokens.js <path-to-claude-binary>
 *     Report mode. Exit code 0 always (this is a report, not a gate). Tokens
 *     with 0 occurrences are flagged so they can be removed from CC_TOKENS.
 *
 *   node scripts/extract-cc-tokens.js --check <path-to-claude-binary>
 *     Gate mode. Compares the live binary's quoted-occurrence token set against
 *     scripts/cc-tokens.lock.json (the verified set) and EXITS NON-ZERO on any
 *     drift (a locked token that vanished, or a candidate token that newly
 *     appeared). Prints the diff. Use in CI / `claude-theme doctor`.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCKFILE_PATH = path.join(__dirname, "cc-tokens.lock.json");

// Candidate tokens: the current CC_TOKENS set plus documented/community names
// worth re-checking on each version bump. Presence is decided empirically.
const CANDIDATES = [
  "claude",
  "claudeShimmer",
  "text",
  "inverseText",
  "inactive",
  "subtle",
  "suggestion",
  "remember",
  "success",
  "error",
  "warning",
  "merged",
  "promptBorder",
  "permission",
  "planMode",
  "autoAccept",
  "bashBorder",
  "ide",
  "fastMode",
  "diffAdded",
  "diffRemoved",
  "diffAddedDimmed",
  "diffRemovedDimmed",
  "diffAddedWord",
  "diffRemovedWord",
  "userMessageBackground",
  "userMessageBackgroundHover",
  "bashMessageBackgroundColor",
  "memoryBackgroundColor",
  "rate_limit_fill",
  "rate_limit_empty",
  "briefLabelYou",
  "briefLabelClaude",
  "red_FOR_SUBAGENTS_ONLY",
  "blue_FOR_SUBAGENTS_ONLY",
  "green_FOR_SUBAGENTS_ONLY",
  "yellow_FOR_SUBAGENTS_ONLY",
  "purple_FOR_SUBAGENTS_ONLY",
  "orange_FOR_SUBAGENTS_ONLY",
  "pink_FOR_SUBAGENTS_ONLY",
  "cyan_FOR_SUBAGENTS_ONLY",
  "rainbow_red",
  "rainbow_orange",
  "rainbow_yellow",
  "rainbow_green",
  "rainbow_blue",
  "rainbow_indigo",
  "rainbow_violet",
  "rainbow_red_shimmer",
  "rainbow_orange_shimmer",
  "rainbow_yellow_shimmer",
  "rainbow_green_shimmer",
  "rainbow_blue_shimmer",
  "rainbow_indigo_shimmer",
  "rainbow_violet_shimmer",
  // Known-doubtful — kept here so the report keeps flagging them:
  "messageActionsBackground",
  "selectionBg",
  // `background` is a common word; its quoted form WILL appear (unrelated code),
  // so the report lists it as PRESENT. It is excluded from CC_TOKENS by judgement,
  // not measurement — do not blindly re-add it on a PRESENT result.
  "background",
  "promptBorderShimmer",
  "permissionShimmer",
  "warningShimmer",
  "fastModeShimmer",
  "inactiveShimmer",
];

// Tokens intentionally kept OUT of CC_TOKENS by judgement rather than by a
// zero-occurrence measurement. `background` is a common word whose quoted form
// appears in unrelated minified code, so it tests PRESENT without being a real
// custom-theme override; the rest are documented/community names we deliberately
// exclude. The `--check` gate must not treat these as "added" drift — otherwise
// the check would fail on every run. (They still surface in the report.)
const JUDGMENT_EXCLUDED = new Set([
  "background",
  "messageActionsBackground",
  "selectionBg",
  "promptBorderShimmer",
  "permissionShimmer",
  "warningShimmer",
  "fastModeShimmer",
  "inactiveShimmer",
]);

// Distinctive tokens that any real Claude Code build must carry. If none are
// present the target is almost certainly the wrong file (e.g. a launcher
// shim/symlink rather than the JS bundle) — fail loudly instead of reporting a
// bogus all-absent result that could nuke CC_TOKENS / pass a drift check.
const ANCHORS = ["red_FOR_SUBAGENTS_ONLY", "rate_limit_fill", "diffAdded"];

/**
 * Resolve and validate the binary path, run `strings` over it, and return the
 * latin1 dump. Exits the process on any failure (no such file, strings error).
 */
function dumpBinary(binPath) {
  if (!fs.existsSync(binPath)) {
    process.stderr.write(`No such file: ${binPath}\n`);
    process.exit(2);
  }
  // Run `strings` once, then count quoted occurrences in JS (avoids spawning
  // grep per token and avoids shell-injection surface entirely). `-a` scans the
  // whole file (not just loaded sections) for consistency across GNU/BSD strings.
  // `--` stops flag parsing so a path beginning with `-` is treated as a file.
  // maxBuffer is sized well above the ~205MB binary (strings output <= input).
  try {
    return execFileSync("strings", ["-a", "--", binPath], {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: "latin1",
    });
  } catch (err) {
    process.stderr.write(
      `Failed to run \`strings\` on binary: ${err.message}\n`,
    );
    process.exit(2);
  }
}

/** Count quoted occurrences (`"<tok>"`) of a token in the dump. */
function countQuoted(dump, tok) {
  const needle = `"${tok}"`;
  let count = 0;
  let idx = dump.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = dump.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Set of tokens with at least one quoted occurrence in the dump. */
function presentTokens(dump, candidates) {
  const present = new Set();
  for (const tok of candidates) {
    if (countQuoted(dump, tok) > 0) present.add(tok);
  }
  return present;
}

/** Exit(3) if the dump carries none of the anchor tokens (wrong file). */
function assertLooksLikeBundle(present, binPath) {
  if (!ANCHORS.some((a) => present.has(a))) {
    process.stderr.write(
      `Refusing to proceed: none of the anchor tokens (${ANCHORS.join(", ")}) ` +
        `were found in ${binPath}. The target does not look like a Claude Code ` +
        `bundle — check that you pointed at the real binary, not a launcher ` +
        `shim/symlink.\n`,
    );
    process.exit(3);
  }
}

/**
 * Report mode: list which candidates are present/absent in the binary.
 */
function runReport(binPath) {
  const dump = dumpBinary(binPath);
  const present = [];
  const absent = [];
  for (const tok of CANDIDATES) {
    const count = countQuoted(dump, tok);
    (count > 0 ? present : absent).push({ tok, count });
  }

  assertLooksLikeBundle(new Set(present.map((p) => p.tok)), binPath);

  process.stdout.write(`Scanned: ${binPath}\n`);
  process.stdout.write(`\nPRESENT (${present.length}):\n`);
  for (const { tok, count } of present.sort((a, b) =>
    a.tok.localeCompare(b.tok),
  )) {
    process.stdout.write(`  ${tok.padEnd(32)} ${count}\n`);
  }
  process.stdout.write(
    `\nABSENT — exclude from CC_TOKENS (${absent.length}):\n`,
  );
  for (const { tok } of absent.sort((a, b) => a.tok.localeCompare(b.tok))) {
    process.stdout.write(`  ${tok}\n`);
  }
}

/**
 * Gate mode: compare the live binary's token set against the lockfile and exit
 * non-zero on any drift.
 *
 * Drift is computed over the candidate universe (lockfile tokens ∪ CANDIDATES):
 *  - REMOVED: a locked token that no longer appears quoted in the binary.
 *  - ADDED:   a candidate token (not in the lock) that newly appears quoted.
 * Candidates not in the lock that stay absent are not drift (still excluded).
 */
function runCheck(binPath) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(
      `Failed to read lockfile ${LOCKFILE_PATH}: ${err.message}\n`,
    );
    process.exit(2);
  }
  const locked = new Set(lock.tokens || []);

  const dump = dumpBinary(binPath);
  // Probe the union so a token that drops out of the lock OR newly appears is seen.
  const universe = new Set([...locked, ...CANDIDATES]);
  const present = presentTokens(dump, universe);

  assertLooksLikeBundle(present, binPath);

  const removed = [...locked].filter((t) => !present.has(t)).sort();
  const added = [...present]
    .filter((t) => !locked.has(t) && !JUDGMENT_EXCLUDED.has(t))
    .sort();

  process.stdout.write(`Checking ${binPath} against lock v${lock.version}\n`);

  if (removed.length === 0 && added.length === 0) {
    process.stdout.write(
      `OK: no token drift (${locked.size} tokens match the binary).\n`,
    );
    return;
  }

  process.stderr.write(
    `\nTOKEN DRIFT DETECTED vs cc-tokens.lock.json (v${lock.version}):\n`,
  );
  if (removed.length) {
    process.stderr.write(
      `\n  REMOVED (in lock, absent from binary — drop from CC_TOKENS):\n`,
    );
    for (const t of removed) process.stderr.write(`    - ${t}\n`);
  }
  if (added.length) {
    process.stderr.write(
      `\n  ADDED (present in binary, not in lock — consider adding to CC_TOKENS):\n`,
    );
    for (const t of added) process.stderr.write(`    + ${t}\n`);
  }
  process.stderr.write(
    `\nUpdate CC_TOKENS in build-theme.js, regenerate cc-tokens.lock.json, ` +
      `and re-run. See scripts/extract-cc-tokens.js for the report mode.\n`,
  );
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  let checkMode = false;
  const rest = [];
  for (const a of argv) {
    if (a === "--check") checkMode = true;
    else rest.push(a);
  }

  const binPath = rest[0];
  if (!binPath) {
    process.stderr.write(
      "Usage: node scripts/extract-cc-tokens.js [--check] <path-to-claude-binary>\n",
    );
    process.exit(2);
  }

  if (checkMode) runCheck(binPath);
  else runReport(binPath);
}

main();
