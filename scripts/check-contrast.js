#!/usr/bin/env node

/**
 * Contrast Checker
 *
 * Detailed WCAG contrast analysis for theme.json files.
 * Zero dependencies -- uses only Node.js built-in modules.
 *
 * Usage:
 *   node scripts/check-contrast.js <theme.json> [options]
 *   node scripts/check-contrast.js themes/dark/theme.json --detailed
 *   node scripts/check-contrast.js themes/dark/theme.json --json
 *
 * Options:
 *   --detailed   Show all color pair combinations
 *   --json       Output as JSON
 *   --aaa        Check against WCAG AAA standards (7:1)
 */

const fs = require('fs');
const { readFile } = require('fs/promises');

// ---------------------------------------------------------------------------
// Color Math
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function hexToLuminance(hex) {
  const rgb = hexToRgb(hex).map((c) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(hex1, hex2) {
  const l1 = hexToLuminance(hex1);
  const l2 = hexToLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminanceToHexRelative(lum) {
  return ((lum + 0.05) / 0.05).toFixed(2);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const WCAG_AA = 4.5;
const WCAG_AAA = 7.0;
const WCAG_AA_LARGE = 3.0;

function getWcagLevel(ratio, aaaTarget) {
  const target = aaaTarget ? WCAG_AAA : WCAG_AA;
  if (ratio >= WCAG_AAA) return { level: 'AAA', pass: true, passAA: true, passAAA: true };
  if (ratio >= WCAG_AA) return { level: 'AA', pass: true, passAA: true, passAAA: false };
  if (ratio >= WCAG_AA_LARGE) return { level: 'AA Large', pass: true, passAA: true, passAAA: false };
  return { level: 'FAIL', pass: false, passAA: false, passAAA: false };
}

function analyzeTheme(theme, options = {}) {
  const { detailed = false, aaa = false } = options;
  const colors = theme.colors || {};

  // Define the standard contrast checks
  const standardChecks = [
    { fg: colors.textPrimary, bg: colors.backgroundPrimary, label: 'Primary text on main bg' },
    { fg: colors.textPrimary, bg: colors.backgroundSecondary, label: 'Primary text on card bg' },
    { fg: colors.textSecondary, bg: colors.backgroundPrimary, label: 'Secondary text on main bg' },
    { fg: colors.textSecondary, bg: colors.backgroundSecondary, label: 'Secondary text on card bg' },
    { fg: colors.textMuted, bg: colors.backgroundPrimary, label: 'Muted text on main bg' },
    { fg: colors.textMuted, bg: colors.backgroundSecondary, label: 'Muted text on card bg' },
    { fg: colors.accent, bg: colors.backgroundPrimary, label: 'Accent on main bg' },
    { fg: colors.accent, bg: colors.backgroundSecondary, label: 'Accent on card bg' },
    { fg: colors.error, bg: colors.backgroundPrimary, label: 'Error on main bg' },
    { fg: colors.error, bg: colors.backgroundSecondary, label: 'Error on card bg' },
    { fg: colors.warning, bg: colors.backgroundPrimary, label: 'Warning on main bg' },
    { fg: colors.success, bg: colors.backgroundPrimary, label: 'Success on main bg' },
    { fg: colors.terminalUser, bg: colors.backgroundPrimary, label: 'Terminal user on main bg' },
    { fg: colors.terminalAssistant, bg: colors.backgroundPrimary, label: 'Terminal assistant on main bg' },
    { fg: colors.terminalSystem, bg: colors.backgroundPrimary, label: 'Terminal system on main bg' },
  ];

  // Filter out checks with missing colors
  const validChecks = standardChecks.filter((c) => c.fg && c.bg);

  const results = validChecks.map((check) => {
    const ratio = contrastRatio(check.fg, check.bg);
    const wcag = getWcagLevel(ratio, aaa);
    return {
      ...check,
      ratio: Math.round(ratio * 100) / 100,
      ...wcag,
    };
  });

  // Detailed analysis: all color pairs
  let detailedResults = [];
  if (detailed) {
    const colorEntries = Object.entries(colors).filter(([, v]) => /^#[0-9A-Fa-f]{6}$/.test(v));
    const bgFields = ['backgroundPrimary', 'backgroundSecondary', 'backgroundTertiary'];
    const bgColors = colorEntries.filter(([k]) => bgFields.includes(k));
    const fgColors = colorEntries.filter(([k]) => !bgFields.includes(k));

    detailedResults = [];
    for (const [bgName, bgValue] of bgColors) {
      for (const [fgName, fgValue] of fgColors) {
        const ratio = contrastRatio(fgValue, bgValue);
        const wcag = getWcagLevel(ratio, aaa);
        detailedResults.push({
          fg: fgValue,
          bg: bgValue,
          fgName,
          bgName,
          label: `${fgName} on ${bgName}`,
          ratio: Math.round(ratio * 100) / 100,
          ...wcag,
        });
      }
    }

    // Sort by ratio ascending (worst first)
    detailedResults.sort((a, b) => a.ratio - b.ratio);
  }

  // Terminal color distinctness
  const terminalColors = {
    user: colors.terminalUser,
    assistant: colors.terminalAssistant,
    system: colors.terminalSystem,
  };

  const terminalPairs = [];
  const terminalKeys = Object.keys(terminalColors);
  for (let i = 0; i < terminalKeys.length; i++) {
    for (let j = i + 1; j < terminalKeys.length; j++) {
      const k1 = terminalKeys[i];
      const k2 = terminalKeys[j];
      if (terminalColors[k1] && terminalColors[k2]) {
        const ratio = contrastRatio(terminalColors[k1], terminalColors[k2]);
        terminalPairs.push({
          color1: k1,
          color2: k2,
          hex1: terminalColors[k1],
          hex2: terminalColors[k2],
          ratio: Math.round(ratio * 100) / 100,
        });
      }
    }
  }

  return {
    themeName: theme.name || theme.id || 'Unknown',
    standard: results,
    detailed: detailedResults,
    terminalDistinctness: terminalPairs,
    summary: {
      totalChecks: results.length,
      passedAA: results.filter((r) => r.passAA).length,
      passedAAA: results.filter((r) => r.passAAA).length,
      failed: results.filter((r) => !r.passAA).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function colorBlock(hex) {
  // Use ANSI escape codes for colored squares in terminals
  const rgb = hexToRgb(hex);
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m\u2588\u2588\x1b[0m`;
}

function formatResults(results, options = {}) {
  const { detailed = false } = options;
  const lines = [];

  lines.push(`${'='.repeat(70)}`);
  lines.push(`Contrast Analysis: ${results.themeName}`);
  lines.push(`${'='.repeat(70)}`);

  lines.push(`\n--- Standard Checks ---\n`);

  for (const check of results.standard) {
    const status = check.passAA ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const block = colorBlock(check.fg);
    lines.push(
      `${block} ${check.label.padEnd(42)} ${String(check.ratio).padStart(5)}:1  ${status}  (${check.level})`
    );
  }

  if (detailed && results.detailed.length > 0) {
    lines.push(`\n--- All Color Pairs (sorted by contrast) ---\n`);

    for (const check of results.detailed) {
      const status = check.passAA ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      lines.push(
        `${check.label.padEnd(50)} ${String(check.ratio).padStart(5)}:1  ${status}`
      );
    }
  }

  if (results.terminalDistinctness.length > 0) {
    lines.push(`\n--- Terminal Color Distinctness ---\n`);
    lines.push('(Higher is better -- terminal colors should be easily distinguishable)\n');

    for (const pair of results.terminalDistinctness) {
      const b1 = colorBlock(pair.hex1);
      const b2 = colorBlock(pair.hex2);
      lines.push(
        `${b1} ${pair.color1.padEnd(10)} vs  ${b2} ${pair.color2.padEnd(10)}  ${pair.ratio}:1`
      );
    }
  }

  // Summary
  const { summary } = results;
  lines.push(`\n${'='.repeat(70)}`);
  lines.push('Summary');
  lines.push(`${'='.repeat(70)}`);
  lines.push(`  Total checks:  ${summary.totalChecks}`);
  lines.push(`  WCAG AA pass:  ${summary.passedAA}/${summary.totalChecks}`);
  lines.push(`  WCAG AAA pass: ${summary.passedAAA}/${summary.totalChecks}`);

  if (summary.failed > 0) {
    lines.push(`\n  \x1b[31m${summary.failed} check(s) failed WCAG AA minimum.\x1b[0m`);
  } else {
    lines.push(`\n  \x1b[32mAll checks pass WCAG AA minimum!\x1b[0m`);
  }

  if (summary.passedAAA === summary.totalChecks) {
    lines.push(`  \x1b[32mAll checks pass WCAG AAA! Excellent accessibility.\x1b[0m`);
  }

  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Contrast Checker

Analyzes WCAG contrast ratios for theme.json files.

Usage:
  node check-contrast.js <theme.json> [options]

Options:
  --detailed   Show all foreground/background color combinations
  --json       Output results as JSON
  --aaa        Use WCAG AAA (7:1) as the target standard
  --help, -h   Show this help message

Examples:
  node check-contrast.js themes/dark/theme.json
  node check-contrast.js themes/dark/theme.json --detailed --json
`);
    process.exit(0);
  }

  const themePath = args.find((a) => !a.startsWith('--'));
  if (!themePath) {
    console.error('Error: No theme file specified.');
    process.exit(2);
  }

  if (!fs.existsSync(themePath)) {
    console.error(`File not found: ${themePath}`);
    process.exit(4);
  }

  const options = {
    detailed: args.includes('--detailed'),
    aaa: args.includes('--aaa'),
    json: args.includes('--json'),
  };

  let theme;
  try {
    const content = await readFile(themePath, 'utf-8');
    theme = JSON.parse(content);
  } catch (err) {
    console.error(`Error reading theme: ${err.message}`);
    process.exit(4);
  }

  const results = analyzeTheme(theme, options);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatResults(results, options));
  }

  process.exit(results.summary.failed > 0 ? 3 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
