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
 *     Report-only mode. Exit code 0 always. Tokens with 0 occurrences are
 *     flagged so they can be removed from CC_TOKENS.
 *
 *   node scripts/extract-cc-tokens.js --check <path-to-claude-binary>
 *     Drift gate. Compares the live binary's quoted-occurrence token set to
 *     scripts/cc-tokens.lock.json and EXITS NON-ZERO if a token was added or
 *     removed (printing the diff). Tokens in JUDGMENT_EXCLUDED (quoted in the
 *     bundle but intentionally kept out of CC_TOKENS, e.g. `background`) are
 *     never flagged as drift.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOCKFILE = path.join(__dirname, "cc-tokens.lock.json");

// Tokens whose quoted form appears in the bundle but which are intentionally
// EXCLUDED from CC_TOKENS by judgement (not measurement). `background` is a
// common word that appears quoted in unrelated code; the rest are documented
// names that either don't exist or aren't real override tokens in this build.
// These must NOT be reported as drift by --check.
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

/**
 * Run `strings` over the binary once and return the dump. Counting quoted
 * occurrences in JS avoids spawning grep per token and any shell-injection
 * surface. `-a` scans the whole file (not just loaded sections) for consistency
 * across GNU/BSD strings. `--` stops flag parsing so a path beginning with `-`
 * is treated as a file. maxBuffer is sized well above the ~205MB binary
 * (strings output <= input). Exits the process on failure.
 */
function dumpStrings(binPath) {
  if (!fs.existsSync(binPath)) {
    process.stderr.write(`No such file: ${binPath}\n`);
    process.exit(2);
  }
  try {
    return execFileSync("strings", ["-a", "--", binPath], {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: "latin1",
    });
  } catch (err) {
    process.stderr.write(`Failed to run \`strings\` on binary: ${err.message}\n`);
    process.exit(2);
  }
}

/** Count occurrences of the quoted token ("<tok>") in the dump. */
function quotedCount(dump, tok) {
  const needle = `"${tok}"`;
  let count = 0;
  let idx = dump.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = dump.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * --check mode: compare the live binary's quoted-occurrence token set against
 * the lockfile and exit non-zero on drift. Candidate names come from the union
 * of the lockfile tokens and the report CANDIDATES so a newly-introduced token
 * is detected. JUDGMENT_EXCLUDED names are never counted as drift.
 */
function runCheck(binPath) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  } catch (err) {
    process.stderr.write(`Failed to read lockfile ${LOCKFILE}: ${err.message}\n`);
    process.exit(2);
  }
  const locked = new Set(lock.tokens || []);
  const dump = dumpStrings(binPath);

  // Anchor sanity (shared with the report): if no distinctive token is found,
  // the target is not a real Claude Code bundle — fail loudly rather than
  // reporting every locked token as "removed".
  const ANCHORS = ["red_FOR_SUBAGENTS_ONLY", "rate_limit_fill", "diffAdded"];
  if (!ANCHORS.some((a) => quotedCount(dump, a) > 0)) {
    process.stderr.write(
      `Refusing to check: none of the anchor tokens (${ANCHORS.join(", ")}) ` +
        `were found. The target does not look like a Claude Code bundle.\n`,
    );
    process.exit(3);
  }

  // Names to probe: everything in the lock + the report candidates (catches
  // additions), minus the judgement-excluded set (never drift).
  const probe = new Set([...locked, ...CANDIDATES]);
  for (const x of JUDGMENT_EXCLUDED) probe.delete(x);

  const present = new Set();
  for (const tok of probe) {
    if (quotedCount(dump, tok) > 0) present.add(tok);
  }

  // Removed: in the lock but no longer present in the binary.
  const removed = [...locked].filter((t) => !present.has(t)).sort();
  // Added: present in the binary, not in the lock, not excluded by judgement.
  const added = [...present].filter((t) => !locked.has(t)).sort();

  process.stdout.write(`Checked: ${binPath}\n`);
  process.stdout.write(`Lockfile: ${LOCKFILE} (version ${lock.version})\n`);

  if (removed.length === 0 && added.length === 0) {
    process.stdout.write(`\nNo token drift. CC_TOKENS lock is up to date.\n`);
    process.exit(0);
  }

  process.stdout.write(`\nTOKEN DRIFT DETECTED:\n`);
  if (added.length) {
    process.stdout.write(`\n  ADDED (in binary, not in lock):\n`);
    for (const t of added) process.stdout.write(`    + ${t}\n`);
  }
  if (removed.length) {
    process.stdout.write(`\n  REMOVED (in lock, not in binary):\n`);
    for (const t of removed) process.stdout.write(`    - ${t}\n`);
  }
  process.stdout.write(
    `\nUpdate CC_TOKENS in build-theme.js and regenerate ` +
      `scripts/cc-tokens.lock.json, then re-run.\n`,
  );
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--check") {
    const binPath = argv[1];
    if (!binPath) {
      process.stderr.write(
        "Usage: node scripts/extract-cc-tokens.js --check <path-to-claude-binary>\n",
      );
      process.exit(2);
    }
    runCheck(binPath);
    return;
  }

  const binPath = argv[0];
  if (!binPath) {
    process.stderr.write(
      "Usage: node scripts/extract-cc-tokens.js [--check] <path-to-claude-binary>\n",
    );
    process.exit(2);
  }

  const dump = dumpStrings(binPath);

  const present = [];
  const absent = [];
  for (const tok of CANDIDATES) {
    const count = quotedCount(dump, tok);
    (count > 0 ? present : absent).push({ tok, count });
  }

  // Sanity floor: distinctive tokens that any real Claude Code build must carry.
  // If none are present, the target is almost certainly the wrong file (e.g. a
  // launcher shim/symlink rather than the JS bundle) — fail loudly instead of
  // reporting a bogus all-absent result that could nuke CC_TOKENS on a bump.
  const ANCHORS = ["red_FOR_SUBAGENTS_ONLY", "rate_limit_fill", "diffAdded"];
  const anchorsFound = ANCHORS.filter((a) =>
    present.some((p) => p.tok === a),
  ).length;
  if (anchorsFound === 0) {
    process.stderr.write(
      `Refusing to report: none of the anchor tokens (${ANCHORS.join(", ")}) ` +
        `were found. The target does not look like a Claude Code bundle — check ` +
        `that you pointed at the real binary, not a launcher shim/symlink.\n`,
    );
    process.exit(3);
  }

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

main();
