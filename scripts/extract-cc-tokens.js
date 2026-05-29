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
 *
 * Exit code 0 always (this is a report, not a gate). Tokens with 0 occurrences
 * are flagged so they can be removed from CC_TOKENS.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");

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

function main() {
  const binPath = process.argv[2];
  if (!binPath) {
    process.stderr.write(
      "Usage: node scripts/extract-cc-tokens.js <path-to-claude-binary>\n",
    );
    process.exit(2);
  }
  if (!fs.existsSync(binPath)) {
    process.stderr.write(`No such file: ${binPath}\n`);
    process.exit(2);
  }

  // Run `strings` once, then count quoted occurrences in JS (avoids spawning
  // grep per token and avoids shell-injection surface entirely). `-a` scans the
  // whole file (not just loaded sections) for consistency across GNU/BSD strings.
  // `--` stops flag parsing so a path beginning with `-` is treated as a file.
  // maxBuffer is sized well above the ~205MB binary (strings output <= input).
  let dump;
  try {
    dump = execFileSync("strings", ["-a", "--", binPath], {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: "latin1",
    });
  } catch (err) {
    process.stderr.write(
      `Failed to run \`strings\` on binary: ${err.message}\n`,
    );
    process.exit(2);
  }

  const present = [];
  const absent = [];
  for (const tok of CANDIDATES) {
    // Count occurrences of the quoted token: "<tok>"
    const needle = `"${tok}"`;
    let count = 0;
    let idx = dump.indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = dump.indexOf(needle, idx + needle.length);
    }
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
