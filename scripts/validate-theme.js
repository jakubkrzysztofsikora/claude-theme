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
  const errors = [];
  const addError = (msg) => errors.push(msg);

  // Basic type check
  if (typeof theme !== 'object' || theme === null) {
    return ['Theme must be a JSON object'];
  }

  // --- Required top-level fields ---
  for (const field of SCHEMA_REQUIRED) {
    if (!(field in theme)) {
      addError(`Missing required field: "${field}"`);
    }
  }

  // --- id validation ---
  if ('id' in theme) {
    if (typeof theme.id !== 'string' || theme.id.length === 0) {
      addError(`Invalid "id": must be a non-empty string, got ${fmt(theme.id)}`);
    } else if (!KEBAB_RE.test(theme.id)) {
      addError(`Invalid "id": must be kebab-case (lowercase letters, numbers, hyphens), got ${fmt(theme.id)}`);
    } else if (theme.id.length > 64) {
      addError(`Invalid "id": must be 64 characters or less, got ${theme.id.length}`);
    }
  }

  // --- name validation ---
  if ('name' in theme) {
    if (typeof theme.name !== 'string' || theme.name.length === 0) {
      addError(`Invalid "name": must be a non-empty string`);
    } else if (theme.name.length > 64) {
      addError(`Invalid "name": must be 64 characters or less, got ${theme.name.length}`);
    }
  }

  // --- version validation ---
  if ('version' in theme) {
    if (typeof theme.version !== 'string') {
      addError(`Invalid "version": must be a string, got ${typeof theme.version}`);
    } else if (!SEMVER_RE.test(theme.version)) {
      addError(`Invalid "version": must follow SemVer (MAJOR.MINOR.PATCH), got ${fmt(theme.version)}`);
    }
  }

  // --- author validation ---
  if ('author' in theme) {
    if (typeof theme.author !== 'string' || theme.author.length === 0) {
      addError(`Invalid "author": must be a non-empty string`);
    }
  }

  // --- description validation ---
  if ('description' in theme) {
    if (typeof theme.description !== 'string' || theme.description.length === 0) {
      addError(`Invalid "description": must be a non-empty string`);
    } else if (theme.description.length > 512) {
      addError(`Invalid "description": must be 512 characters or less, got ${theme.description.length}`);
    }
  }

  // --- license validation ---
  if ('license' in theme) {
    if (typeof theme.license !== 'string' || theme.license.length === 0) {
      addError(`Invalid "license": must be a non-empty string`);
    }
  }

  // --- tags validation ---
  if ('tags' in theme) {
    if (!Array.isArray(theme.tags)) {
      addError(`Invalid "tags": must be an array of strings`);
    } else {
      const seen = new Set();
      for (let i = 0; i < theme.tags.length; i++) {
        const tag = theme.tags[i];
        if (typeof tag !== 'string' || tag.length === 0) {
          addError(`Invalid "tags[${i}]": must be a non-empty string`);
        } else if (tag.length > 32) {
          addError(`Invalid "tags[${i}]": must be 32 characters or less, got "${tag}" (${tag.length} chars)`);
        }
        if (seen.has(tag)) {
          addError(`Duplicate tag: "${tag}"`);
        }
        seen.add(tag);
      }
    }
  }

  // --- preview validation ---
  if ('preview' in theme) {
    if (typeof theme.preview !== 'object' || theme.preview === null) {
      addError(`Invalid "preview": must be an object`);
    } else {
      const previewKeys = Object.keys(theme.preview);
      const usesLegacyPreview = PREVIEW_LEGACY_REQUIRED.every((k) => k in theme.preview);
      const expectedPreviewKeys = usesLegacyPreview ? PREVIEW_LEGACY_REQUIRED : PREVIEW_REQUIRED;
      for (const field of expectedPreviewKeys) {
        if (!(field in theme.preview)) {
          addError(`Missing "preview.${field}"`);
        } else if (!HEX_COLOR_RE.test(theme.preview[field])) {
          addError(`Invalid "preview.${field}": must be #RRGGBB hex color, got ${fmt(theme.preview[field])}`);
        }
      }
      for (const key of previewKeys) {
        if (!expectedPreviewKeys.includes(key)) {
          addError(`Unexpected "preview.${key}": expected ${expectedPreviewKeys.join(', ')}`);
        }
      }
    }
  }

  // --- tokens validation ---
  if ('tokens' in theme) {
    if (typeof theme.tokens !== 'object' || theme.tokens === null) {
      addError(`Invalid "tokens": must be an object`);
    } else {
      // tokens.color (required)
      if (!('color' in theme.tokens)) {
        addError(`Missing "tokens.color"`);
      } else {
        const color = theme.tokens.color;
        if (typeof color !== 'object' || color === null) {
          addError(`Invalid "tokens.color": must be an object`);
        } else {
          for (const field of COLOR_REQUIRED) {
            if (!(field in color)) {
              addError(`Missing "tokens.color.${field}"`);
            } else if (!HEX_COLOR_RE.test(color[field])) {
              addError(`Invalid "tokens.color.${field}": must be #RRGGBB hex color, got ${fmt(color[field])}`);
            }
          }
          // Validate all other color values are valid hex
          for (const [key, val] of Object.entries(color)) {
            if (!HEX_COLOR_RE.test(val)) {
              addError(`Invalid "tokens.color.${key}": must be #RRGGBB hex color, got ${fmt(val)}`);
            }
          }
        }
      }

      // tokens.typography (optional)
      if ('typography' in theme.tokens) {
        const typo = theme.tokens.typography;
        if (typeof typo !== 'object' || typo === null) {
          addError(`Invalid "tokens.typography": must be an object`);
        } else {
          if ('fontFamily' in typo) {
            if (typeof typo.fontFamily !== 'string' || typo.fontFamily.length === 0) {
              addError(`Invalid "tokens.typography.fontFamily": must be a non-empty string`);
            }
          }
          if ('fontUrl' in typo) {
            if (typeof typo.fontUrl !== 'string' || !FONT_URL_RE.test(typo.fontUrl)) {
              addError(`Invalid "tokens.typography.fontUrl": must be an HTTP(S) URL, got ${fmt(typo.fontUrl)}`);
            }
          }
          if ('fontSizeBase' in typo) {
            if (typeof typo.fontSizeBase !== 'string' || !FONT_SIZE_RE.test(typo.fontSizeBase)) {
              addError(`Invalid "tokens.typography.fontSizeBase": must be like "16px" or "1rem", got ${fmt(typo.fontSizeBase)}`);
            }
          }
          if ('lineHeight' in typo) {
            if (typeof typo.lineHeight !== 'number' || typo.lineHeight < 1 || typo.lineHeight > 3) {
              addError(`Invalid "tokens.typography.lineHeight": must be a number between 1 and 3, got ${fmt(typo.lineHeight)}`);
            }
          }
          // Disallow extra typography properties
          const allowedTypo = ['fontFamily', 'fontUrl', 'fontSizeBase', 'lineHeight'];
          for (const key of Object.keys(typo)) {
            if (!allowedTypo.includes(key)) {
              addError(`Unexpected "tokens.typography.${key}": allowed keys are ${allowedTypo.join(', ')}`);
            }
          }
        }
      }

      // tokens.logo (optional)
      if ('logo' in theme.tokens) {
        const logo = theme.tokens.logo;
        if (typeof logo !== 'object' || logo === null) {
          addError(`Invalid "tokens.logo": must be an object`);
        } else {
          if (!('type' in logo)) {
            addError(`Missing "tokens.logo.type"`);
          } else if (!VALID_LOGO_TYPES.includes(logo.type)) {
            addError(`Invalid "tokens.logo.type": must be one of ${VALID_LOGO_TYPES.join(', ')}, got ${fmt(logo.type)}`);
          }
          if (!('content' in logo)) {
            addError(`Missing "tokens.logo.content"`);
          } else if (typeof logo.content !== 'string' || logo.content.length === 0) {
            addError(`Invalid "tokens.logo.content": must be a non-empty string`);
          }
          if (logo.type === 'svg' && 'viewBox' in logo && !VIEWBOX_RE.test(logo.viewBox)) {
            addError(`Invalid "tokens.logo.viewBox": must be "x y w h", got ${fmt(logo.viewBox)}`);
          }
          // Disallow extra logo properties
          const allowedLogo = ['type', 'content', 'viewBox'];
          for (const key of Object.keys(logo)) {
            if (!allowedLogo.includes(key)) {
              addError(`Unexpected "tokens.logo.${key}": allowed keys are ${allowedLogo.join(', ')}`);
            }
          }
        }
      }

      // tokens.favicon (optional)
      if ('favicon' in theme.tokens) {
        const favicon = theme.tokens.favicon;
        if (typeof favicon === 'string') {
          if (favicon.length === 0) addError(`Invalid "tokens.favicon": must be a non-empty string`);
        } else if (typeof favicon === 'object' && favicon !== null) {
          if (typeof favicon.type !== 'string' || favicon.type.length === 0) addError(`Invalid "tokens.favicon.type": must be a non-empty string`);
          if (typeof favicon.value !== 'string' || favicon.value.length === 0) addError(`Invalid "tokens.favicon.value": must be a non-empty string`);
        } else {
          addError(`Invalid "tokens.favicon": must be a string or object`);
        }
      }
    }
  }

  // --- terminal validation (optional) ---
  if ('terminal' in theme) {
    if (typeof theme.terminal !== 'object' || theme.terminal === null) {
      addError(`Invalid "terminal": must be an object`);
    } else {
      for (const [key, val] of Object.entries(theme.terminal)) {
        if (key === 'bannerAscii') {
          if (typeof val !== 'string' || val.length === 0) {
            addError(`Invalid "terminal.bannerAscii": must be a non-empty string`);
          }
          continue;
        }
        if (!HEX_COLOR_RE.test(val)) {
          addError(`Invalid "terminal.${key}": must be #RRGGBB hex color, got ${fmt(val)}`);
        }
      }
    }
  }

  // --- Disallow extra top-level properties ---
  const allowedTopLevel = [
    'name', 'id', 'version', 'author', 'description', 'license',
    '$schema', 'tags', 'preview', 'tokens', 'terminal',
  ];
  for (const key of Object.keys(theme)) {
    if (!allowedTopLevel.includes(key)) {
      addError(`Unexpected top-level property: "${key}"`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    // eslint-disable-next-line no-console
    console.log(`
Theme Validation Script — Zero-Dependency CLI

Usage:
  node scripts/validate-theme.js <theme-file> [<theme-file> ...]
  node scripts/validate-theme.js themes/*/theme.json

Validates theme JSON files against the Claude theme schema v1.
Checks:
  - Required field presence
  - Color hex format (#RRGGBB)
  - Preview color validity
  - Typography configuration
  - Cross-theme ID uniqueness
  - Logo and favicon configuration
  - Terminal color overrides

Exit codes:
  0 — All themes valid
  1 — One or more errors found
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const allErrors = [];
  const seenIds = new Map(); // id -> filePath
  let totalFiles = 0;
  let validFiles = 0;
  let invalidFiles = 0;

  for (const arg of args) {
    // Handle glob-like patterns by expanding directories
    let filePaths;
    try {
      const resolved = path.resolve(arg);
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const themeJsonPath = path.join(resolved, 'theme.json');
        if (fs.existsSync(themeJsonPath)) {
          filePaths = [themeJsonPath];
        } else {
          filePaths = [];
        }
      } else {
        filePaths = [resolved];
      }
    } catch {
      // If the path doesn't exist as a file, try interpreting as a glob pattern
      // by finding theme.json files in matching directories
      const dir = path.dirname(arg);
      const base = path.basename(arg);
      if (base === 'theme.json') {
        // This is already a path to theme.json
        filePaths = [arg];
      } else {
        // Try as a directory containing theme.json
        const themeJsonPath = path.join(arg, 'theme.json');
        if (fs.existsSync(themeJsonPath)) {
          filePaths = [themeJsonPath];
        } else {
          filePaths = [arg];
        }
      }
    }

    for (const filePath of filePaths) {
      totalFiles++;
      const absPath = path.resolve(filePath);

      // Check file exists
      if (!fs.existsSync(absPath)) {
        allErrors.push({ file: absPath, errors: [`File not found: ${absPath}`] });
        invalidFiles++;
        continue;
      }

      // Read and parse
      const theme = readJson(absPath);
      if (theme.__error) {
        allErrors.push({ file: absPath, errors: [`JSON parse error: ${theme.__error}`] });
        invalidFiles++;
        continue;
      }

      // Validate against schema
      const errors = validateTheme(theme, absPath);

      // Cross-theme ID uniqueness check
      if (theme.id !== undefined) {
        if (seenIds.has(theme.id)) {
          const otherFile = seenIds.get(theme.id);
          errors.push(`Duplicate theme ID "${theme.id}" — already defined in ${otherFile}`);
        } else {
          seenIds.set(theme.id, absPath);
        }
      }

      if (errors.length === 0) {
        validFiles++;
        // eslint-disable-next-line no-console
        console.log(`\x1b[32m[OK]\x1b[0m ${absPath}`);
        // eslint-disable-next-line no-console
        console.log(`     Theme: "${theme.name}" (${theme.id}) by ${theme.author}`);
      } else {
        invalidFiles++;
        allErrors.push({ file: absPath, errors });
      }
    }
  }

  // Print summary
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(60));

  if (allErrors.length > 0) {
    for (const { file, errors } of allErrors) {
      // eslint-disable-next-line no-console
      console.log(`\n\x1b[31m[FAIL]\x1b[0m ${file}`);
      for (const err of errors) {
        // eslint-disable-next-line no-console
        console.log(`       \x1b[31m*\x1b[0m ${err}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(60));
  // eslint-disable-next-line no-console
  console.log(`Total:  ${totalFiles} file(s) checked`);
  // eslint-disable-next-line no-console
  console.log(`Valid:  ${validFiles} file(s)`);
  // eslint-disable-next-line no-console
  console.log(`Invalid: ${invalidFiles} file(s)`);

  if (allErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('\x1b[31mValidation FAILED.\x1b[0m');
    process.exit(1);
  } else {
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('\x1b[32mAll themes valid.\x1b[0m');
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = { validateTheme };
