#!/usr/bin/env node

/**
 * validate-theme.js — Standalone Theme Validation Script
 *
 * Validates one or more theme JSON files against the schema defined in
 * themes/schema.json. Performs comprehensive checks including:
 *   - Required field presence
 *   - Color hex format validation (#RRGGBB)
 *   - Preview color validation
 *   - Typography configuration validation
 *   - Cross-theme ID uniqueness
 *   - Logo configuration validation
 *   - Terminal color validation
 *
 * Usage:
 *   node scripts/validate-theme.js themes/glob/theme.json
 *   node scripts/validate-theme.js themes/my-theme/theme.json
 *
 * Exit codes:
 *   0 — All themes valid
 *   1 — One or more validation errors found
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FONT_SIZE_RE = /^\d+(?:\.\d+)?(px|rem|em)$/;
const FONT_URL_RE = /^https?:\/\/.+/;
const VIEWBOX_RE = /^\d+( \d+){3}$/;

// Schema definition (embedded copy to avoid circular dependency)
const SCHEMA_REQUIRED = ['name', 'id', 'version', 'author', 'description', 'license', 'preview', 'tokens'];
const PREVIEW_REQUIRED = ['background', 'surface', 'textPrimary', 'brandPrimary', 'userMessageText'];
const PREVIEW_LEGACY_REQUIRED = ['background', 'surface', 'text', 'primary', 'secondary'];
const COLOR_REQUIRED = ['brandPrimary', 'background', 'surface', 'textPrimary', 'userMessageText'];
const VALID_LOGO_TYPES = ['svg', 'text', 'emoji'];

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
  } catch (err) {
    return { __error: err.message };
  }
}

/**
 * Format a value for error display.
 */
function fmt(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'string') return `"${val}"`;
  return String(val);
}

// ---------------------------------------------------------------------------
// Validation Engine
// ---------------------------------------------------------------------------

/**
 * Validate a single theme object. Returns an array of error message strings.
 */
function validateTheme(theme, filePath) {
  const buildThemePath = path.resolve(__dirname, '../.claude/skills/whitelabel-theme/build-theme.js');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { validateTheme: coreValidateTheme } = require(buildThemePath);
  return coreValidateTheme(theme, filePath);
}


