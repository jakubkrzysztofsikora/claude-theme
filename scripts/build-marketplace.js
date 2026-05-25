#!/usr/bin/env node

/**
 * build-marketplace.js — Marketplace Data Generator
 *
 * Scans the themes/ directory for valid theme definitions, validates each
 * one against the schema, and generates the marketplace data files used by
 * the theme browser UI.
 *
 * Generated files:
 *   marketplace/src/data/themes.json  — Full theme catalog with metadata
 *   marketplace/src/data/stats.json   — Aggregate statistics (tag counts, etc.)
 *
 * Usage:
 *   node scripts/build-marketplace.js
 *   node scripts/build-marketplace.js --dry-run    (validate only, don't write)
 *   node scripts/build-marketplace.js --themes-dir <path>
 *   node scripts/build-marketplace.js --output-dir <path>
 *
 * Exit codes:
 *   0 — Success, marketplace data generated
 *   1 — Validation errors found or I/O error
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Default paths (relative to repository root)
const DEFAULT_THEMES_DIR = path.resolve(__dirname, '..', 'themes');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'marketplace', 'src', 'data');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file. Returns null on error.
 */
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write a JSON file with consistent formatting.
 */
function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Format a number with commas.
 */
function formatNumber(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Simple logger with colored prefixes.
 */
function log(level, message) {
  const colors = {
    info: '\x1b[36m[INFO]\x1b[0m',
    ok: '\x1b[32m[OK]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m',
    step: '\x1b[35m[STEP]\x1b[0m',
  };
  // eslint-disable-next-line no-console
  console.error(`${colors[level] || colors.info} ${message}`);
}

// ---------------------------------------------------------------------------
// Validation (embedded copy for zero-dependency operation)
// ---------------------------------------------------------------------------

const SCHEMA_REQUIRED = ['name', 'id', 'version', 'author', 'description', 'license', 'preview', 'tokens'];
const PREVIEW_REQUIRED = ['background', 'surface', 'textPrimary', 'brandPrimary', 'userMessageText'];
const COLOR_REQUIRED = ['brandPrimary', 'background', 'surface', 'textPrimary', 'userMessageText'];

/**
 * Validate a theme object. Returns array of error strings.
 */
function validateTheme(theme) {
  const errors = [];

  if (typeof theme !== 'object' || theme === null) {
    return ['Theme must be a JSON object'];
  }

  // Required fields
  for (const field of SCHEMA_REQUIRED) {
    if (!(field in theme)) errors.push(`Missing required field: "${field}"`);
  }

  // id
  if ('id' in theme) {
    if (typeof theme.id !== 'string' || !KEBAB_RE.test(theme.id)) {
      errors.push(`Invalid "id": must be kebab-case, got "${theme.id}"`);
    }
  }

  // name
  if ('name' in theme) {
    if (typeof theme.name !== 'string' || theme.name.length === 0 || theme.name.length > 64) {
      errors.push(`Invalid "name": must be 1-64 characters`);
    }
  }

  // version
  if ('version' in theme) {
    if (typeof theme.version !== 'string' || !SEMVER_RE.test(theme.version)) {
      errors.push(`Invalid "version": must be SemVer, got "${theme.version}"`);
    }
  }

  // author
  if ('author' in theme) {
    if (typeof theme.author !== 'string' || theme.author.length === 0) {
      errors.push(`Invalid "author": must be a non-empty string`);
    }
  }

  // description
  if ('description' in theme) {
    if (typeof theme.description !== 'string' || theme.description.length === 0 || theme.description.length > 512) {
      errors.push(`Invalid "description": must be 1-512 characters`);
    }
  }

  // license
  if ('license' in theme) {
    if (typeof theme.license !== 'string' || theme.license.length === 0) {
      errors.push(`Invalid "license": must be a non-empty string`);
    }
  }

  // tags
  if ('tags' in theme) {
    if (!Array.isArray(theme.tags)) {
      errors.push(`"tags" must be an array`);
    } else {
      const seen = new Set();
      for (const tag of theme.tags) {
        if (typeof tag !== 'string' || tag.length === 0 || tag.length > 32) {
          errors.push(`Invalid tag: "${tag}"`);
        }
        if (seen.has(tag)) errors.push(`Duplicate tag: "${tag}"`);
        seen.add(tag);
      }
    }
  }

  // preview
  if ('preview' in theme) {
    if (typeof theme.preview !== 'object' || theme.preview === null) {
      errors.push(`"preview" must be an object`);
    } else {
      for (const field of PREVIEW_REQUIRED) {
        if (!(field in theme.preview)) {
          errors.push(`Missing "preview.${field}"`);
        } else if (!HEX_COLOR_RE.test(theme.preview[field])) {
          errors.push(`Invalid "preview.${field}": must be #RRGGBB, got "${theme.preview[field]}"`);
        }
      }
    }
  }

  // tokens
  if ('tokens' in theme) {
    if (typeof theme.tokens !== 'object' || theme.tokens === null) {
      errors.push(`"tokens" must be an object`);
    } else {
      if (!('color' in theme.tokens)) {
        errors.push(`Missing "tokens.color"`);
      } else {
        const color = theme.tokens.color;
        if (typeof color !== 'object' || color === null) {
          errors.push(`"tokens.color" must be an object`);
        } else {
          for (const field of COLOR_REQUIRED) {
            if (!(field in color)) {
              errors.push(`Missing "tokens.color.${field}"`);
            } else if (!HEX_COLOR_RE.test(color[field])) {
              errors.push(`Invalid "tokens.color.${field}": must be #RRGGBB, got "${color[field]}"`);
            }
          }
          for (const [key, val] of Object.entries(color)) {
            if (!HEX_COLOR_RE.test(val)) {
              errors.push(`Invalid "tokens.color.${key}": must be #RRGGBB, got "${val}"`);
            }
          }
        }
      }

      // typography (optional)
      if ('typography' in theme.tokens) {
        const typo = theme.tokens.typography;
        if (typeof typo === 'object' && typo !== null) {
          if (typo.fontUrl && !/^https?:\/\/.+/.test(typo.fontUrl)) {
            errors.push(`Invalid "tokens.typography.fontUrl": must be HTTP(S)`);
          }
          if (typo.fontSizeBase && !/^\d+(\.\d+)?(px|rem|em)$/.test(typo.fontSizeBase)) {
            errors.push(`Invalid "tokens.typography.fontSizeBase"`);
          }
          if (typo.lineHeight !== undefined && (typeof typo.lineHeight !== 'number' || typo.lineHeight < 1 || typo.lineHeight > 3)) {
            errors.push(`Invalid "tokens.typography.lineHeight": must be 1-3`);
          }
        }
      }

      // logo (optional)
      if ('logo' in theme.tokens) {
        const logo = theme.tokens.logo;
        if (typeof logo === 'object' && logo !== null) {
          if (!['svg', 'text', 'emoji'].includes(logo.type)) {
            errors.push(`Invalid "tokens.logo.type": must be "svg", "text", or "emoji"`);
          }
          if (logo.type === 'svg' && logo.viewBox && !/^\d+( \d+){3}$/.test(logo.viewBox)) {
            errors.push(`Invalid "tokens.logo.viewBox"`);
          }
        }
      }
    }
  }

  // terminal (optional)
  if ('terminal' in theme) {
    if (typeof theme.terminal === 'object' && theme.terminal !== null) {
      for (const [key, val] of Object.entries(theme.terminal)) {
        if (!HEX_COLOR_RE.test(val)) {
          errors.push(`Invalid "terminal.${key}": must be #RRGGBB, got "${val}"`);
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Theme Discovery
// ---------------------------------------------------------------------------

/**
 * Scan the themes directory for all theme.json files.
 * Returns an array of { dirName, filePath, theme } objects.
 */
function discoverThemes(themesDir) {
  const themes = [];

  if (!fs.existsSync(themesDir)) {
    log('warn', `Themes directory does not exist: ${themesDir}`);
    return themes;
  }

  const entries = fs.readdirSync(themesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'schema.json') continue;
    if (entry.name.startsWith('.')) continue;

    const themeJsonPath = path.join(themesDir, entry.name, 'theme.json');
    if (!fs.existsSync(themeJsonPath)) {
      log('warn', `Skipping ${entry.name}: no theme.json found`);
      continue;
    }

    const theme = readJson(themeJsonPath);
    if (!theme) {
      log('warn', `Skipping ${entry.name}: failed to parse theme.json`);
      continue;
    }

    themes.push({
      dirName: entry.name,
      filePath: themeJsonPath,
      theme,
    });
  }

  return themes.sort((a, b) => (a.theme.id || '').localeCompare(b.theme.id || ''));
}

// ---------------------------------------------------------------------------
// Statistics Calculation
// ---------------------------------------------------------------------------

/**
 * Compute aggregate statistics from a collection of validated themes.
 */
function computeStats(themes) {
  const tagCounts = {};
  const authorCounts = {};
  const licenseCounts = {};
  let withTypography = 0;
  let withLogo = 0;
  let withFavicon = 0;
  let withTerminal = 0;
  let withFontUrl = 0;
  let darkThemes = 0;
  let lightThemes = 0;
  let totalColorTokens = 0;

  for (const { theme } of themes) {
    // Tag counts
    for (const tag of theme.tags || []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }

    // Author counts
    if (theme.author) {
      authorCounts[theme.author] = (authorCounts[theme.author] || 0) + 1;
    }

    // License counts
    if (theme.license) {
      licenseCounts[theme.license] = (licenseCounts[theme.license] || 0) + 1;
    }

    // Feature flags
    if (theme.tokens?.typography) withTypography++;
    if (theme.tokens?.logo) withLogo++;
    if (theme.tokens?.favicon) withFavicon++;
    if (theme.terminal) withTerminal++;
    if (theme.tokens?.typography?.fontUrl) withFontUrl++;

    // Light/dark detection
    const tags = (theme.tags || []).map(t => t.toLowerCase());
    if (tags.includes('dark')) darkThemes++;
    if (tags.includes('light')) lightThemes++;

    // Color token count
    if (theme.tokens?.color) {
      totalColorTokens += Object.keys(theme.tokens.color).length;
    }
  }

  // Sort tag counts by frequency (descending), then alphabetically
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Sort authors by count (descending)
  const sortedAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Sort licenses by count (descending)
  const sortedLicenses = Object.entries(licenseCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    generatedAt: new Date().toISOString(),
    totalThemes: themes.length,
    featureBreakdown: {
      withTypography,
      withLogo,
      withFavicon,
      withTerminal,
      withFontUrl,
    },
    tagCounts: Object.fromEntries(sortedTags),
    authorCounts: Object.fromEntries(sortedAuthors),
    licenseCounts: Object.fromEntries(sortedLicenses),
    themeTypeCounts: {
      dark: darkThemes,
      light: lightThemes,
      unspecified: themes.length - darkThemes - lightThemes,
    },
    averageColorTokens: themes.length > 0 ? Math.round(totalColorTokens / themes.length * 10) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Data Transformation
// ---------------------------------------------------------------------------

/**
 * Transform a full theme into a marketplace catalog entry.
 * Strips internal-only fields and adds computed metadata.
 */
function toCatalogEntry({ dirName, filePath, theme }) {
  // Compute a content hash for cache-busting / change detection
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(theme))
    .digest('hex')
    .slice(0, 12);

  // Extract only the fields needed by the marketplace UI
  return {
    id: theme.id,
    name: theme.name,
    version: theme.version,
    author: theme.author,
    description: theme.description,
    license: theme.license,
    tags: theme.tags || [],
    preview: theme.preview,
    hasTypography: !!theme.tokens?.typography,
    hasLogo: !!theme.tokens?.logo,
    hasFavicon: !!theme.tokens?.favicon,
    hasTerminal: !!theme.terminal,
    colorTokenCount: theme.tokens?.color ? Object.keys(theme.tokens.color).length : 0,
    sourceDir: dirName,
    contentHash: hash,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let themesDir = DEFAULT_THEMES_DIR;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      // eslint-disable-next-line no-console
      console.log(`
Marketplace Data Generator — Zero-Dependency CLI

Usage:
  node scripts/build-marketplace.js [options]

Options:
  --themes-dir <path>   Path to themes directory (default: themes/)
  --output-dir <path>   Path to output directory (default: marketplace/src/data/)
  --dry-run             Validate only, don't write output files
  --help, -h            Show this help message

Description:
  Scans the themes/ directory, validates all theme.json files, and generates
  marketplace data files (themes.json and stats.json) for the theme browser UI.
`);
      process.exit(0);
    }
    if (args[i] === '--themes-dir' && args[i + 1]) {
      themesDir = path.resolve(args[i + 1]);
      i++;
    }
    if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = path.resolve(args[i + 1]);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  log('step', `Scanning themes directory: ${themesDir}`);
  log('step', `Output directory: ${outputDir}`);

  // --- Discover themes ---
  const discovered = discoverThemes(themesDir);
  log('info', `Found ${discovered.length} theme(s)`);

  if (discovered.length === 0) {
    log('warn', 'No themes found. Generating empty marketplace data.');
    if (!dryRun) {
      writeJson(path.join(outputDir, 'themes.json'), []);
      writeJson(path.join(outputDir, 'stats.json'), computeStats([]));
    }
    log('ok', 'Done (empty).');
    process.exit(0);
  }

  // --- Validate all themes ---
  const validThemes = [];
  const invalidThemes = [];
  const seenIds = new Map();

  for (const entry of discovered) {
    const errors = validateTheme(entry.theme);

    // Cross-theme ID uniqueness
    if (entry.theme.id) {
      if (seenIds.has(entry.theme.id)) {
        errors.push(`Duplicate theme ID "${entry.theme.id}" — already used by ${seenIds.get(entry.theme.id)}`);
      } else {
        seenIds.set(entry.theme.id, entry.dirName);
      }
    }

    if (errors.length === 0) {
      validThemes.push(entry);
      log('ok', `Valid: "${entry.theme.name}" (${entry.theme.id})`);
    } else {
      invalidThemes.push({ entry, errors });
      log('error', `Invalid: "${entry.theme.name || entry.dirName}" (${entry.theme.id || 'no-id'})`);
      for (const err of errors) {
        log('error', `       - ${err}`);
      }
    }
  }

  // --- Exit if any invalid ---
  if (invalidThemes.length > 0) {
    log('error', `${invalidThemes.length} theme(s) failed validation.`);
    log('error', 'Fix errors before generating marketplace data.');
    process.exit(1);
  }

  log('info', `All ${validThemes.length} theme(s) passed validation.`);

  // --- Generate catalog ---
  const catalog = validThemes.map(toCatalogEntry);

  // --- Generate stats ---
  const stats = computeStats(validThemes);

  // --- Write output files ---
  if (dryRun) {
    log('info', '[DRY RUN] Would write:');
    log('info', `  - ${path.join(outputDir, 'themes.json')} (${catalog.length} themes)`);
    log('info', `  - ${path.join(outputDir, 'stats.json')} (${Object.keys(stats.tagCounts).length} unique tags)`);
  } else {
    const themesOutPath = path.join(outputDir, 'themes.json');
    const statsOutPath = path.join(outputDir, 'stats.json');

    writeJson(themesOutPath, catalog);
    log('ok', `Written: ${themesOutPath} (${catalog.length} themes)`);

    writeJson(statsOutPath, stats);
    log('ok', `Written: ${statsOutPath}`);

    // Print summary
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('─'.repeat(50));
    // eslint-disable-next-line no-console
    console.log('Marketplace Summary');
    // eslint-disable-next-line no-console
    console.log('─'.repeat(50));
    // eslint-disable-next-line no-console
    console.log(`Total themes:    ${formatNumber(stats.totalThemes)}`);
    // eslint-disable-next-line no-console
    console.log(`Unique tags:     ${formatNumber(Object.keys(stats.tagCounts).length)}`);
    // eslint-disable-next-line no-console
    console.log(`With typography: ${formatNumber(stats.featureBreakdown.withTypography)}`);
    // eslint-disable-next-line no-console
    console.log(`With logo:       ${formatNumber(stats.featureBreakdown.withLogo)}`);
    // eslint-disable-next-line no-console
    console.log(`With terminal:   ${formatNumber(stats.featureBreakdown.withTerminal)}`);
    // eslint-disable-next-line no-console
    console.log(`Dark themes:     ${formatNumber(stats.themeTypeCounts.dark)}`);
    // eslint-disable-next-line no-console
    console.log(`Light themes:    ${formatNumber(stats.themeTypeCounts.light)}`);
    // eslint-disable-next-line no-console
    console.log(`Avg color tokens: ${stats.averageColorTokens}`);
    // eslint-disable-next-line no-console
    console.log('─'.repeat(50));
  }

  log('ok', 'Done.');
  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = { discoverThemes, validateTheme, computeStats, toCatalogEntry };
