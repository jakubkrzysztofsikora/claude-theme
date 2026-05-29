#!/usr/bin/env node

/**
 * build-theme.js — White-Label Theme Compiler
 *
 * The core engine of the Claude theming system. A zero-dependency Node.js
 * CLI that compiles theme JSON files into Chrome extensions, manages CLI
 * terminal colors, validates themes, and provides a local preview server.
 *
 * Usage:
 *   node build-theme.js apply <theme-file>     # Apply theme (compile + settings update)
 *   node build-theme.js compile <theme-file>   # Compile theme to extension/
 *   node build-theme.js list                   # List all available themes
 *   node build-theme.js validate <theme-file>  # Validate a theme JSON file
 *   node build-theme.js preview <theme-file>   # Start preview server (default port 8765)
 *   node build-theme.js init <theme-name>      # Create a new theme template
 *
 * Zero external dependencies — only native Node.js modules:
 *   fs, path, crypto, http, readline, url
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const { deriveTokens } = require("./cli-derive.js");
const warp = require("./warp-channel.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CWD = process.cwd();
const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const SCHEMA_PATH = path.resolve(__dirname, "../../../themes/schema.json");
// THEMES_DIR (bundled built-in themes) stays package-relative so `list` still works when
// the CLI is installed via npm. Output dirs, however, are CWD-relative: installed via
// npm/npx the package-relative path lands inside node_modules (read-only / not findable),
// so `compile`/`apply` must write the extension into the user's working directory. When
// run from the repo root (dev + tests) CWD == repo, so this resolves to the same path.
const THEMES_DIR = path.resolve(__dirname, "../../../themes");
const EXTENSION_DIR = path.resolve(CWD, "extension");
const SETTINGS_DIR = path.join(HOME, ".claude");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");
// Claude Code custom themes live here, distinct from THEMES_DIR (the repo source dir).
const CLAUDE_THEMES_DIR = path.join(SETTINGS_DIR, "themes");

// Warp terminal channel. Uses the same HOME constant the CC paths use, so the
// integration tests (which set HOME to a temp dir) hit a sandboxed ~/.warp.
const WARP_DIR = path.join(HOME, ".warp");
const WARP_THEMES_DIR = path.join(WARP_DIR, "themes");
const WARP_SETTINGS = path.join(WARP_DIR, "settings.toml");
const WARP_STATE = path.join(WARP_THEMES_DIR, ".whitelabel-state.json");
const WARP_BAK = path.join(WARP_DIR, "settings.toml.whitelabel.bak");

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
// Hex in colorValue form: 3- or 6-digit. (tokens.color stays 6-digit only.)
const HEX_ANY_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
// Theme slug shape (matches theme.id); guards filesystem ops against traversal.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Object keys that must never be accepted from theme JSON (prototype pollution).
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Resource caps for untrusted (marketplace) theme files.
const MAX_THEME_BYTES = 512 * 1024;
const MAX_COLOR_KEYS = 200;
const MAX_OVERRIDE_KEYS = 200;

// Valid Claude Code custom-theme override tokens, verified against the claude 2.1.154
// binary via `scripts/extract-cc-tokens.js` (quoted-string occurrence > 0). Tokens from
// the docs that do NOT exist in the build are excluded: `messageActionsBackground`,
// `selectionBg`, and the non-`claude` shimmer variants (`promptBorderShimmer`,
// `permissionShimmer`, `warningShimmer`, `fastModeShimmer`, `inactiveShimmer`).
// Re-run the extract script when targeting a newer Claude Code.
const CC_TOKENS = new Set([
  // Brand
  "claude",
  "claudeShimmer",
  // Text
  "text",
  "inverseText",
  "inactive",
  "subtle",
  "suggestion",
  "remember",
  // Status
  "success",
  "error",
  "warning",
  "merged",
  // Input / mode
  "promptBorder",
  "permission",
  "planMode",
  "autoAccept",
  "bashBorder",
  "ide",
  "fastMode",
  // Diffs
  "diffAdded",
  "diffRemoved",
  "diffAddedDimmed",
  "diffRemovedDimmed",
  "diffAddedWord",
  "diffRemovedWord",
  // Message backgrounds
  "userMessageBackground",
  "userMessageBackgroundHover",
  "bashMessageBackgroundColor",
  "memoryBackgroundColor",
  // Usage meter
  "rate_limit_fill",
  "rate_limit_empty",
  // Speaker labels
  "briefLabelYou",
  "briefLabelClaude",
  // Subagents
  "red_FOR_SUBAGENTS_ONLY",
  "blue_FOR_SUBAGENTS_ONLY",
  "green_FOR_SUBAGENTS_ONLY",
  "yellow_FOR_SUBAGENTS_ONLY",
  "purple_FOR_SUBAGENTS_ONLY",
  "orange_FOR_SUBAGENTS_ONLY",
  "pink_FOR_SUBAGENTS_ONLY",
  "cyan_FOR_SUBAGENTS_ONLY",
  // Rainbow gradient
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
]);

// ANSI color names accepted in `ansi:<name>` color values. Used by colorValue
// validation; an allowlist (not a character class) to prevent smuggling.
const ANSI_NAMES = new Set([
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
]);
// Built-in bases a custom theme may extend, longest/most-specific first.
const VALID_BASES = [
  "dark-ansi",
  "light-ansi",
  "dark-daltonized",
  "light-daltonized",
  "light",
  "dark",
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Pretty-print a message to stderr with a colored prefix.
 */
function log(level, message) {
  const prefixes = {
    info: "\x1b[36m[INFO]\x1b[0m",
    ok: "\x1b[32m[OK]\x1b[0m",
    warn: "\x1b[33m[WARN]\x1b[0m",
    error: "\x1b[31m[ERROR]\x1b[0m",
    step: "\x1b[35m[STEP]\x1b[0m",
  };
  const prefix = prefixes[level] || prefixes.info;
  // eslint-disable-next-line no-console
  console.error(`${prefix} ${message}`);
}

/**
 * Read and parse a JSON file, or return null on any error.
 */
function readJson(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_THEME_BYTES) {
      log(
        "error",
        `File too large (${stat.size} bytes > ${MAX_THEME_BYTES} cap): ${filePath}`,
      );
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    log("error", `Failed to read or parse JSON at ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Validate a colorValue: hex (#rgb/#rrggbb), rgb(r,g,b) with 0-255 channels,
 * ansi256(n) with 0-255, or ansi:<name> from the ANSI_NAMES allowlist. Each
 * form is fully anchored, so a value carrying `;`, `}`, `url(...)`, newlines,
 * etc. matches no form and is rejected — no CSS/JSON smuggling downstream.
 */
function isColorValue(val) {
  if (typeof val !== "string") return false;
  if (HEX_ANY_RE.test(val)) return true;
  const compact = val.replace(/\s+/g, "");
  const rgb = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(compact);
  if (rgb) return rgb.slice(1).every((n) => Number(n) <= 255);
  const a256 = /^ansi256\((\d{1,3})\)$/.exec(compact);
  if (a256) return Number(a256[1]) <= 255;
  const aname = /^ansi:([a-zA-Z]+)$/.exec(val);
  if (aname) return ANSI_NAMES.has(aname[1]);
  return false;
}

/**
 * Escape a string for safe interpolation into generated HTML (text or attribute
 * context). Applied at every HTML sink so untrusted theme fields can never
 * inject markup, independent of input validation (defence in depth).
 */
function htmlEscape(s) {
  return String(s).replace(
    /[&<>"'`]/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "`": "&#96;",
      })[ch],
  );
}

/**
 * Write a JSON file with consistent formatting.
 */
function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Write a JSON file atomically (temp + rename) so a crash mid-write cannot
 * truncate the target. rename(2) is atomic within a filesystem.
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Atomically write text to a file, preserving its mode. Temp lives in the SAME
 * directory so the rename stays intra-filesystem. Distinct from writeJsonAtomic
 * (which JSON-stringifies and does not preserve mode). Used for ~/.warp/settings.toml,
 * a file we do not own — so we must not widen its permissions.
 */
function writeTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  let mode;
  try {
    mode = fs.statSync(filePath).mode;
  } catch {
    /* new file */
  }
  try {
    fs.writeFileSync(tmp, text, "utf8");
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    // Test-only fault seam (inert in production): simulate a failure after the temp is
    // written but before the rename of settings.toml, to prove no partial/torn file.
    if (
      process.env.WL_WARP_FAULT === "crash-before-rename" &&
      filePath === WARP_SETTINGS
    ) {
      throw new Error("WL_WARP_FAULT: crash-before-rename");
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // On any failure before the rename completes, remove the temp so we never leave a
    // stray <file>.<pid>.tmp behind. The target file is untouched (rename is atomic).
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone / never created */
    }
    throw err;
  }
}

/**
 * Lighten a #RRGGBB color toward white by `amt` (0..1). Schema guarantees the
 * 6-digit hex form, so no short-form handling is needed.
 */
function lighten(hex, amt = 0.06) {
  const n = hex.slice(1);
  const channel = (i) => {
    const v = parseInt(n.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * amt);
  };
  return (
    "#" +
    [0, 2, 4].map((i) => channel(i).toString(16).padStart(2, "0")).join("")
  );
}

/**
 * Choose the built-in base preset a custom theme extends, derived from the
 * theme's declared tags (never luminance — that would silently downgrade
 * ansi/daltonized users). Defaults to "dark".
 */
function pickBase(theme) {
  const tags = (theme.tags || []).map((t) => String(t).toLowerCase());
  return VALID_BASES.find((b) => tags.includes(b)) || "dark";
}

/**
 * Resolve the hex palette deriveTokens() needs from tokens.color. Inputs are
 * hex-only (validateTheme guarantees the required fields are #RRGGBB when
 * deriveAll is set), so ansi/rgb forms never reach the colour math.
 */
function buildPalette(theme) {
  const c = (theme.tokens && theme.tokens.color) || {};
  return {
    bg: c.background,
    text: c.textPrimary,
    brand: c.brandPrimary,
    accent: c.brandAccent, // optional → deriveTokens defaults to brand
    success: c.success,
    error: c.error,
    warning: c.warning,
    userText: c.userMessageText,
  };
}

/**
 * Build a Claude Code custom-theme object ({ name, base, overrides }) from a
 * whitelabel theme, in three layers (lowest → highest priority):
 *   1. opt-in full derivation from the palette (only when terminal.deriveAll)
 *   2. the friendly terminal.* / tokens.color mappings (default behaviour)
 *   3. the raw terminal.overrides map
 * Every emitted key is asserted to be a real Claude Code token.
 *
 * Validation (validateTheme) must run first: it enforces colorValue formats,
 * the override-key allowlist, prototype-pollution rejection, and the palette
 * presence/hex preconditions deriveTokens relies on.
 */
function buildClaudeCodeTheme(theme) {
  const t = theme.terminal || {};
  const c = (theme.tokens && theme.tokens.color) || {};
  // null-proto so a stray "__proto__"/"constructor" assignment cannot pollute.
  const overrides = Object.create(null);
  const put = (key, val) => {
    if (val) overrides[key] = val; // "#000000" is truthy → safe
  };

  const base =
    t.base && VALID_BASES.includes(t.base) ? t.base : pickBase(theme);

  // Layer 1 — opt-in derivation of the full token set from the hex palette.
  if (t.deriveAll === true) {
    const derived = deriveTokens(buildPalette(theme), { base });
    for (const [key, val] of Object.entries(derived)) put(key, val);
  }

  // Layer 2 — friendly mappings (the default, back-compatible behaviour).
  // Under deriveAll, only EXPLICIT terminal.* fields override the derived set;
  // the tokens.color fallbacks are suppressed so derivation's (contrast-floored,
  // shimmer-aware) values are not clobbered by the simpler mapping. When not
  // deriving, fb() === (terminalVal || colorVal), identical to the old behaviour.
  const deriving = t.deriveAll === true;
  const fb = (terminalVal, colorVal) =>
    terminalVal || (deriving ? undefined : colorVal);

  const brand = fb(t.promptColor, c.brandPrimary);
  put("claude", brand);
  put("promptBorder", brand);

  put("briefLabelYou", fb(t.userColor, c.userMessageText));

  const assistant = fb(t.assistantColor, c.textPrimary);
  put("briefLabelClaude", assistant);
  put("text", assistant);

  put("error", fb(t.errorColor, c.error));
  put("success", fb(t.successColor, c.success));
  put("warning", deriving ? undefined : c.warning);

  const accent = fb(t.systemColor, c.brandAccent);
  put("planMode", accent);
  put("ide", accent);

  const bg = fb(t.backgroundColor, c.background);
  if (bg) {
    put("userMessageBackground", bg);
    put("bashMessageBackgroundColor", bg);
    put("memoryBackgroundColor", bg);
    put("userMessageBackgroundHover", lighten(bg));
  }

  // Layer 3 — raw overrides win. Keys are re-checked here (defence in depth):
  // forbidden keys skipped, unknown tokens skipped (validateTheme already errors).
  if (t.overrides && typeof t.overrides === "object") {
    for (const key of Object.keys(t.overrides)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (CC_TOKENS.has(key)) overrides[key] = t.overrides[key];
    }
  }

  // Warn (not error) if ansi values are used without an *-ansi base — they
  // won't follow the terminal palette and may render oddly.
  if (!base.endsWith("-ansi")) {
    for (const val of Object.values(overrides)) {
      if (typeof val === "string" && val.startsWith("ansi")) {
        log(
          "warn",
          `Theme uses ansi color values but base "${base}" is not an *-ansi base; ` +
            `colors may not follow the terminal palette.`,
        );
        break;
      }
    }
  }

  for (const key of Object.keys(overrides)) {
    if (!CC_TOKENS.has(key)) {
      throw new Error(
        `Internal error: unknown Claude Code theme token "${key}"`,
      );
    }
  }

  // Spread into a plain object: null-proto would fail deepStrictEqual in tests
  // and JSON output should be an ordinary object.
  return { name: theme.name, base, overrides: { ...overrides } };
}

/**
 * Convert a display name to kebab-case ID.
 */
function kebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Simple table formatter for CLI output.
 */
function formatTable(rows, headers) {
  if (!rows.length) return "No data.";
  const colCount = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] || "").length)),
  );
  const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const headerRow =
    "| " + headers.map((h, i) => h.padEnd(widths[i])).join(" | ") + " |";
  const dataRows = rows.map(
    (r) =>
      "| " +
      r.map((cell, i) => String(cell).padEnd(widths[i])).join(" | ") +
      " |",
  );
  return [sep, headerRow, sep, ...dataRows, sep].join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a theme object against the embedded rules from schema.json.
 * Returns an array of error strings (empty if valid).
 */
function validateTheme(theme, themeFilePath = "unknown") {
  const errors = [];

  // Required top-level fields
  const required = [
    "name",
    "id",
    "version",
    "author",
    "description",
    "license",
    "preview",
    "tokens",
  ];
  for (const field of required) {
    if (theme[field] === undefined) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // id must be a kebab-case string (also guards filesystem ops against traversal)
  if (theme.id !== undefined) {
    if (typeof theme.id !== "string" || !SLUG_RE.test(theme.id)) {
      errors.push(`Invalid "id": must be kebab-case, got "${theme.id}"`);
    }
  }

  // name is interpolated into generated extension JS/HTML/CSS. Reject characters
  // that could break out of a string/markup context (defence at the boundary so
  // no downstream generator can be injected), plus a length cap.
  if (theme.name !== undefined) {
    if (typeof theme.name !== "string") {
      errors.push(`"name" must be a string`);
    } else if (theme.name.length < 1 || theme.name.length > 100) {
      errors.push(`"name" must be 1-100 characters`);
    } else if (/[<>"'`${};\\*/]/.test(theme.name)) {
      errors.push(
        `Invalid "name": must not contain < > " ' \` $ { } ; \\ or other breakout characters`,
      );
    }
  }

  // description is interpolated unescaped into the preview HTML (text context).
  // Block the angle brackets that would allow a tag/script; prose punctuation is fine.
  if (theme.description !== undefined) {
    if (typeof theme.description !== "string") {
      errors.push(`"description" must be a string`);
    } else if (theme.description.length < 1 || theme.description.length > 512) {
      errors.push(`"description" must be 1-512 characters`);
    } else if (/[<>]/.test(theme.description)) {
      errors.push(`Invalid "description": must not contain < or >`);
    }
  }

  // author is interpolated into generated HTML; htmlEscape covers it, but keep a
  // type/length bound for sane output.
  if (theme.author !== undefined) {
    if (typeof theme.author !== "string") {
      errors.push(`"author" must be a string`);
    } else if (theme.author.length < 1 || theme.author.length > 100) {
      errors.push(`"author" must be 1-100 characters`);
    }
  }

  // version must be SemVer (anchored end — an unanchored prefix match let
  // trailing markup like `1.0.0"><img>` through to the HTML sinks).
  if (
    theme.version !== undefined &&
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      theme.version,
    )
  ) {
    errors.push(`Invalid "version": must be SemVer, got "${theme.version}"`);
  }

  // tags must be an array of unique strings
  if (theme.tags !== undefined) {
    if (!Array.isArray(theme.tags)) {
      errors.push(`"tags" must be an array`);
    } else if (new Set(theme.tags).size !== theme.tags.length) {
      errors.push(`"tags" contains duplicate values`);
    }
  }

  // preview required sub-fields and hex validation
  if (theme.preview) {
    const hasLegacyPreview =
      theme.preview.primary && theme.preview.secondary && theme.preview.text;
    const previewFields = hasLegacyPreview
      ? ["background", "surface", "text", "primary", "secondary"]
      : [
          "background",
          "surface",
          "textPrimary",
          "brandPrimary",
          "userMessageText",
        ];
    for (const field of previewFields) {
      const val = theme.preview[field];
      if (val === undefined) {
        errors.push(`Missing "preview.${field}"`);
      } else if (!HEX_COLOR_RE.test(val)) {
        errors.push(
          `Invalid "preview.${field}": must be #RRGGBB, got "${val}"`,
        );
      }
    }
  }

  // tokens.color required sub-fields and hex validation
  if (theme.tokens) {
    if (typeof theme.tokens !== "object" || theme.tokens === null) {
      errors.push(`"tokens" must be an object`);
    } else {
      const color = theme.tokens.color;
      if (!color) {
        errors.push(`Missing "tokens.color"`);
      } else {
        const colorFields = [
          "brandPrimary",
          "background",
          "surface",
          "textPrimary",
          "userMessageText",
        ];
        for (const field of colorFields) {
          const val = color[field];
          if (val === undefined) {
            errors.push(`Missing "tokens.color.${field}"`);
          } else if (!HEX_COLOR_RE.test(val)) {
            errors.push(
              `Invalid "tokens.color.${field}": must be #RRGGBB, got "${val}"`,
            );
          }
        }
        // Cap key count (untrusted themes get re-serialized into the extension).
        const colorKeys = Object.keys(color);
        if (colorKeys.length > MAX_COLOR_KEYS) {
          errors.push(
            `"tokens.color" has too many keys (${colorKeys.length} > ${MAX_COLOR_KEYS})`,
          );
        }
        // Validate all remaining color values are valid hex
        for (const [key, val] of Object.entries(color)) {
          if (!HEX_COLOR_RE.test(val)) {
            errors.push(
              `Invalid "tokens.color.${key}": must be #RRGGBB, got "${val}"`,
            );
          }
        }
      }

      // Optional typography validation
      const typography = theme.tokens.typography;
      if (typography) {
        if (typography.fontUrl && !/^https?:\/\/.+/.test(typography.fontUrl)) {
          errors.push(
            `Invalid "tokens.typography.fontUrl": must be HTTP(S) URL`,
          );
        }
        // fontFamily is interpolated into generated CSS (a CSS custom property
        // value). Allow only font-name characters so a value like
        // "Inter; } body{...}" cannot break out of the declaration.
        if (
          typography.fontFamily !== undefined &&
          (typeof typography.fontFamily !== "string" ||
            typography.fontFamily.length > 200 ||
            !/^[A-Za-z0-9 ,'"-]+$/.test(typography.fontFamily))
        ) {
          errors.push(
            `Invalid "tokens.typography.fontFamily": only letters, digits, spaces, comma, quotes, hyphen allowed`,
          );
        }
        if (
          typography.fontSizeBase &&
          !/^\d+(\.\d+)?(px|rem|em)$/.test(typography.fontSizeBase)
        ) {
          errors.push(
            `Invalid "tokens.typography.fontSizeBase": "${typography.fontSizeBase}"`,
          );
        }
        if (
          typography.lineHeight !== undefined &&
          (typeof typography.lineHeight !== "number" ||
            typography.lineHeight < 1 ||
            typography.lineHeight > 3)
        ) {
          errors.push(`Invalid "tokens.typography.lineHeight": must be 1-3`);
        }
      }

      // Optional logo validation
      const logo = theme.tokens.logo;
      if (logo) {
        if (!["svg", "text", "emoji"].includes(logo.type)) {
          errors.push(
            `Invalid "tokens.logo.type": must be "svg", "text", or "emoji"`,
          );
        }
        if (logo.type === "svg" && !logo.content) {
          errors.push(`"tokens.logo.content" is required when type is "svg"`);
        }
      }
    }
  }

  // Optional terminal validation — shape-aware. The JSON Schema is documentation
  // only (never loaded at runtime), so every constraint is enforced here.
  if (theme.terminal !== undefined) {
    const term = theme.terminal;
    if (typeof term !== "object" || term === null || Array.isArray(term)) {
      errors.push(`"terminal" must be an object`);
    } else {
      const COLOR_FIELDS = new Set([
        "userColor",
        "assistantColor",
        "backgroundColor",
        "promptColor",
        "errorColor",
        "successColor",
        "systemColor",
      ]);
      const ALLOWED = new Set([
        ...COLOR_FIELDS,
        "base",
        "deriveAll",
        "overrides",
      ]);

      for (const key of Object.keys(term)) {
        if (!ALLOWED.has(key)) {
          errors.push(`Unknown "terminal.${key}"`);
        }
      }
      for (const field of COLOR_FIELDS) {
        if (term[field] !== undefined && !isColorValue(term[field])) {
          errors.push(
            `Invalid "terminal.${field}": not a valid color value, got "${term[field]}"`,
          );
        }
      }
      if (term.base !== undefined && !VALID_BASES.includes(term.base)) {
        errors.push(
          `Invalid "terminal.base": must be one of ${VALID_BASES.join(", ")}`,
        );
      }
      if (term.deriveAll !== undefined && typeof term.deriveAll !== "boolean") {
        errors.push(`"terminal.deriveAll" must be a boolean`);
      }
      if (term.overrides !== undefined) {
        const ov = term.overrides;
        if (typeof ov !== "object" || ov === null || Array.isArray(ov)) {
          errors.push(`"terminal.overrides" must be an object`);
        } else {
          const ovKeys = Object.keys(ov);
          if (ovKeys.length > MAX_OVERRIDE_KEYS) {
            errors.push(
              `"terminal.overrides" has too many keys (${ovKeys.length} > ${MAX_OVERRIDE_KEYS})`,
            );
          }
          for (const key of ovKeys) {
            if (FORBIDDEN_KEYS.has(key)) {
              errors.push(`Illegal "terminal.overrides" key: "${key}"`);
              continue; // never read the value of a pollution key
            }
            if (!CC_TOKENS.has(key)) {
              errors.push(`Unknown override token "terminal.overrides.${key}"`);
              continue;
            }
            if (!isColorValue(ov[key])) {
              errors.push(
                `Invalid "terminal.overrides.${key}": not a valid color value, got "${ov[key]}"`,
              );
            }
          }
        }
      }
      // deriveAll needs a complete hex palette — the colour math throws on a
      // missing/non-hex source. Required base palette fields are checked above;
      // success/error/warning are not otherwise required, so enforce them here.
      if (term.deriveAll === true) {
        const color = (theme.tokens && theme.tokens.color) || {};
        for (const field of ["success", "error", "warning"]) {
          if (!HEX_COLOR_RE.test(color[field] || "")) {
            errors.push(
              `"terminal.deriveAll" requires hex "tokens.color.${field}"`,
            );
          }
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Extension File Generators
// ---------------------------------------------------------------------------

/**
 * Generate the manifest.json (Manifest V3) for the Chrome extension.
 */
function generateManifest(theme) {
  return {
    manifest_version: 3,
    name: `Claude Theme: ${theme.name}`,
    version: theme.version,
    description: theme.description,
    permissions: ["activeTab", "scripting", "storage"],
    host_permissions: ["https://claude.ai/*", "https://*.claude.ai/*"],
    content_scripts: [
      {
        matches: ["https://claude.ai/*", "https://*.claude.ai/*"],
        js: ["inject.js"],
        css: ["styles.css"],
        run_at: "document_start",
      },
    ],
    background: {
      service_worker: "background.js",
    },
    action: {
      default_popup: "popup.html",
      default_title: `Claude Theme: ${theme.name}`,
    },
    // No `icons` block: the build does not emit icon PNGs, so referencing them produced
    // broken-icon errors on "load unpacked" and a hard Chrome Web Store rejection. MV3 is
    // valid without icons (Chrome shows a default). Add real PNGs here before any CWS submit.
  };
}

/**
 * Generate the inject.js content script. This is the runtime heart of the
 * theme system — it creates CSS custom properties, loads fonts, replaces the
 * logo, and listens for messages from the CLI / popup.
 */
function generateInjectJs(theme) {
  const themeData = JSON.stringify(theme, null, 2);

  return `/**
 * inject.js — Claude Theme Injection Script
 *
 * Generated at compile time by build-theme.js.
 * This script is injected into claude.ai pages and:
 *   1. Creates CSS custom properties from theme tokens
 *   2. Loads custom fonts via FontFace API
 *   3. Replaces the Claude logo with a custom one
 *   4. Listens for theme update/reset commands from the extension
 *   5. Handles SPA navigation (React re-renders) gracefully
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Theme data (baked in at compile time)
  // -------------------------------------------------------------------------

  const THEME_DATA = ${themeData};
  const THEME_ID = THEME_DATA.id;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  let styleSheet = null;
  let observer = null;
  let isActive = true;

  // -------------------------------------------------------------------------
  // CSS Custom Property Injection
  // -------------------------------------------------------------------------

  /**
   * Build a CSS string of custom properties from theme tokens.
   */
  function buildCustomProperties(theme) {
    const lines = [];
    const t = theme.tokens || {};
    const c = t.color || {};

    // Core color tokens
    for (const [key, value] of Object.entries(c)) {
      const cssKey = '--ct-' + kebabCase(key);
      lines.push(\`  \${cssKey}: \${value};\`);
    }

    // Typography tokens
    const typo = t.typography || {};
    if (typo.fontFamily)  lines.push(\`  --ct-font-family: \${typo.fontFamily};\`);
    if (typo.fontSizeBase) lines.push(\`  --ct-font-size-base: \${typo.fontSizeBase};\`);
    if (typo.lineHeight)  lines.push(\`  --ct-line-height: \${typo.lineHeight};\`);

    return lines.join('\\n');
  }

  /**
   * Convert camelCase to kebab-case for CSS variable names.
   */
  function kebabCase(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Create and attach a CSSStyleSheet with theme custom properties.
   */
  function injectStyles(theme) {
    // Remove previous stylesheet if it exists
    if (styleSheet && styleSheet.parentNode) {
      styleSheet.parentNode.removeChild(styleSheet);
    }

    const cssText = \`
/* Claude Theme: \${theme.name} */
:root {
\${buildCustomProperties(theme)}
}

/* Global overrides */
body {
  \${theme.tokens?.typography?.fontFamily ? 'font-family: var(--ct-font-family) !important;' : ''}
  \${theme.tokens?.color?.background ? 'background-color: var(--ct-background) !important;' : ''}
  \${theme.tokens?.color?.textPrimary ? 'color: var(--ct-text-primary) !important;' : ''}
}
\`;

    try {
      // Use CSSStyleSheet API for dynamic injection
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

      // Also inject as a style element for broader compatibility
      const styleEl = document.createElement('style');
      styleEl.id = 'claude-theme-injected';
      styleEl.textContent = cssText;
      const target = document.head || document.documentElement;
      if (target) {
        // Remove existing style element if present
        const existing = document.getElementById('claude-theme-injected');
        if (existing) existing.remove();
        target.appendChild(styleEl);
      }
      styleSheet = styleEl;
    } catch (e) {
      console.warn('[ClaudeTheme] CSSStyleSheet injection failed, falling back to style element:', e);
      const styleEl = document.createElement('style');
      styleEl.id = 'claude-theme-injected';
      styleEl.textContent = cssText;
      const existing = document.getElementById('claude-theme-injected');
      if (existing) existing.remove();
      const target = document.head || document.documentElement;
      if (target) target.appendChild(styleEl);
      styleSheet = styleEl;
    }
  }

  // -------------------------------------------------------------------------
  // Font Loading
  // -------------------------------------------------------------------------

  /**
   * Load a custom font via the FontFace API if a fontUrl is specified.
   */
  async function loadCustomFont(theme) {
    const typo = theme.tokens?.typography;
    if (!typo || !typo.fontUrl) return;

    const fontFamily = typo.fontFamily;
    if (!fontFamily) return;

    // Extract font family name (strip fallbacks)
    const familyName = fontFamily.split(',')[0].trim().replace(/['"]/g, '');

    try {
      // Load the font stylesheet
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = typo.fontUrl;
      document.head.appendChild(link);

      // Wait for fonts to load
      if (document.fonts) {
        await document.fonts.ready;
        console.log('[ClaudeTheme] Font loaded:', familyName);
      }
    } catch (e) {
      console.warn('[ClaudeTheme] Font loading failed:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Logo Replacement
  // -------------------------------------------------------------------------

  /**
   * Create a replacement logo element based on the theme logo config.
   */
  function createLogoElement(logo) {
    if (!logo) return null;

    if (logo.type === 'svg') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(logo.content || '', 'image/svg+xml');
      const parsedSvg = doc.documentElement;
      if (!parsedSvg || parsedSvg.nodeName.toLowerCase() !== 'svg') {
        console.warn('[ClaudeTheme] Invalid SVG logo content; expected <svg> root element');
        return null;
      }
      const hasParseError = doc.getElementsByTagName('parsererror').length > 0;
      if (hasParseError) {
        console.warn('[ClaudeTheme] Invalid SVG logo content; parsererror returned');
        return null;
      }
      for (const el of parsedSvg.querySelectorAll('script, foreignObject')) {
        el.remove();
      }
      for (const el of parsedSvg.querySelectorAll('*')) {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim().toLowerCase();
          if (name.startsWith('on') || value.startsWith('javascript:')) {
            el.removeAttribute(attr.name);
          }
        }
      }
      if (!parsedSvg.getAttribute('viewBox')) {
        parsedSvg.setAttribute('viewBox', logo.viewBox || '0 0 32 32');
      }
      parsedSvg.setAttribute('style', 'width:32px;height:32px;fill:currentColor;');
      return document.importNode(parsedSvg, true);
    }

    if (logo.type === 'text') {
      const span = document.createElement('span');
      span.textContent = logo.content;
      span.style.cssText = 'font-weight:700;font-size:18px;letter-spacing:-0.5px;white-space:nowrap;';
      return span;
    }

    if (logo.type === 'emoji') {
      const span = document.createElement('span');
      span.textContent = logo.content;
      span.style.cssText = 'font-size:24px;line-height:1;';
      return span;
    }

    return null;
  }

  /**
   * Find and replace the Claude logo in the sidebar.
   */
  function replaceLogo(theme) {
    const logo = theme.tokens?.logo;
    if (!logo) return;

    // Common selectors for the Claude logo container
    const selectors = [
      '[data-testid="claude-logo"]',
      'header a[href="/"] svg',
      'header a svg',
      'nav a[href="/"] svg',
      'nav a svg',
      '.claude-logo',
      '[class*="logo"]',
      'a[href="/new"] svg',
    ];

    let target = null;
    for (const sel of selectors) {
      target = document.querySelector(sel);
      if (target) break;
    }

    if (!target) return;

    const replacement = createLogoElement(logo);
    if (replacement) {
      target.replaceWith(replacement);
      console.log('[ClaudeTheme] Logo replaced');
    }
  }

  /**
   * Set up a MutationObserver to watch for logo elements appearing
   * (handles SPA navigation and lazy rendering).
   */
  function setupLogoObserver(theme) {
    if (observer) observer.disconnect();

    // Try immediate replacement first
    replaceLogo(theme);

    observer = new MutationObserver((mutations) => {
      if (!isActive) return;

      let shouldReplace = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = /** @type {Element} */ (node);
              if (
                el.querySelector?.('svg') ||
                el.tagName?.toLowerCase() === 'svg' ||
                el.matches?.('[class*="logo"]') ||
                el.matches?.('a[href="/"]')
              ) {
                shouldReplace = true;
                break;
              }
            }
          }
        }
        if (shouldReplace) break;
      }

      if (shouldReplace) {
        // Debounce: wait for DOM to settle
        clearTimeout(window.__CT_LOGO_TIMER);
        window.__CT_LOGO_TIMER = setTimeout(() => replaceLogo(theme), 150);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // -------------------------------------------------------------------------
  // Theme Activation / Deactivation
  // -------------------------------------------------------------------------

  /**
   * Activate the theme: inject styles, load font, set up logo observer.
   */
  function activate(theme) {
    isActive = true;
    injectStyles(theme);
    loadCustomFont(theme);
    setupLogoObserver(theme);
    console.log('[ClaudeTheme] Activated:', theme.id);
  }

  /**
   * Deactivate: remove styles, disconnect observer, restore defaults.
   */
  function deactivate() {
    isActive = false;

    if (styleSheet && styleSheet.parentNode) {
      styleSheet.parentNode.removeChild(styleSheet);
      styleSheet = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const injected = document.getElementById('claude-theme-injected');
    if (injected) injected.remove();

    console.log('[ClaudeTheme] Deactivated');
  }

  // -------------------------------------------------------------------------
  // Message Handling (from popup / CLI)
  // -------------------------------------------------------------------------

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'PING') {
        sendResponse({ active: isActive, themeId: THEME_ID });
        return true;
      }

      if (request.action === 'UPDATE_THEME') {
        if (request.theme) {
          Object.assign(THEME_DATA, request.theme);
          activate(THEME_DATA);
        }
        sendResponse({ ok: true });
        return true;
      }

      if (request.action === 'RESET_THEME') {
        deactivate();
        sendResponse({ ok: true });
        return true;
      }

      if (request.action === 'GET_STATE') {
        sendResponse({ active: isActive, themeId: THEME_ID, theme: THEME_DATA });
        return true;
      }

      return false;
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  window.__CLAUDE_THEME__ = {
    version: '1.0.0',
    themeId: THEME_ID,
    theme: THEME_DATA,
    activate: () => activate(THEME_DATA),
    deactivate,
    get isActive() { return isActive; },
  };

  // -------------------------------------------------------------------------
  // Auto-activate on page load
  // -------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => activate(THEME_DATA));
  } else {
    activate(THEME_DATA);
  }
})();
`;
}

/**
 * Generate the styles.css file with CSS variables from theme tokens.
 */
function generateStylesCss(theme) {
  const c = theme.tokens?.color || {};
  const lines = [
    "/* Claude Theme: " + theme.name + " */",
    "/* This file provides fallback CSS variables for the content script */",
    "",
    ":root {",
  ];

  for (const [key, value] of Object.entries(c)) {
    const cssKey =
      "--ct-" + key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    lines.push(`  ${cssKey}: ${value};`);
  }

  // Add userMessageBg as alias if available
  if (c.userMessageBackground) {
    lines.push(`  --ct-user-message-bg: ${c.userMessageBackground};`);
  }
  if (c.assistantMessageBackground) {
    lines.push(`  --ct-assistant-message-bg: ${c.assistantMessageBackground};`);
  }

  lines.push("}", "");

  // Basic element targeting for Claude's UI
  lines.push(`
/* Claude UI element targeting */
[data-testid="user-message"] {
  color: var(--ct-user-message-text, inherit) !important;
}

[data-testid="assistant-message"] {
  color: var(--ct-assistant-message-text, inherit) !important;
}
`);

  return lines.join("\n");
}

/**
 * Generate the background.js service worker for message relay.
 */
function generateBackgroundJs(theme) {
  return `/**
 * background.js — Theme Extension Service Worker
 *
 * Relays messages between the popup, CLI, and content scripts.
 * Theme: ${theme.name} (${theme.id})
 */

const THEME_ID = '${theme.id}';

// Keep track of which tabs have the theme active
const activeTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ activeTheme: THEME_ID, themeName: ${JSON.stringify(theme.name)} });
});

// Listen for messages from popup and internal extension components only
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

function handleMessage(request, sender, sendResponse) {
  if (request.action === 'GET_THEME') {
    sendResponse({ themeId: THEME_ID, themeName: ${JSON.stringify(theme.name)} });
    return;
  }

  if (request.action === 'RESET_THEME') {
    chrome.storage.local.remove(['activeTheme', 'themeName']);
    // Broadcast reset to all tabs
    chrome.tabs.query({ url: ['https://claude.ai/*', 'https://*.claude.ai/*'] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'RESET_THEME' }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return;
  }

  if (request.action === 'UPDATE_THEME') {
    chrome.tabs.query({ url: ['https://claude.ai/*', 'https://*.claude.ai/*'] }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { action: 'UPDATE_THEME', theme: request.theme }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return;
  }

  sendResponse({ error: 'Unknown action' });
}

// Track tab connections for popup state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('claude.ai')) {
    activeTabs.add(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});
`;
}

/**
 * Generate the popup.html for the extension action button.
 */
function generatePopupHtml(theme) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Claude Theme: ${htmlEscape(theme.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 280px;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme.tokens?.color?.background || "#0f0f23"};
      color: ${theme.tokens?.color?.textPrimary || "#e0e0ff"};
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid ${theme.tokens?.color?.border || "#333355"};
    }
    .swatch {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: ${theme.tokens?.color?.brandPrimary || "#6366f1"};
      flex-shrink: 0;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
    }
    .subtitle {
      font-size: 12px;
      opacity: 0.7;
    }
    .colors {
      display: flex;
      gap: 6px;
      margin-bottom: 16px;
    }
    .color-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid ${theme.tokens?.color?.surface || "#1a1a2e"};
    }
    .actions { display: flex; flex-direction: column; gap: 8px; }
    button {
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
    .btn-primary {
      background: ${theme.tokens?.color?.brandPrimary || "#6366f1"};
      color: ${theme.tokens?.color?.userMessageText || "#ffffff"};
    }
    .btn-danger {
      background: #dc2626;
      color: #ffffff;
    }
    .status {
      margin-top: 12px;
      font-size: 11px;
      text-align: center;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="swatch"></div>
    <div>
      <div class="title">${htmlEscape(theme.name)}</div>
      <div class="subtitle">by ${htmlEscape(theme.author)} &middot; v${htmlEscape(theme.version)}</div>
    </div>
  </div>
  <div class="colors">
    <div class="color-dot" style="background:${theme.preview?.brandPrimary || "#6366f1"}"></div>
    <div class="color-dot" style="background:${theme.preview?.background || "#0f0f23"}"></div>
    <div class="color-dot" style="background:${theme.preview?.surface || "#1a1a2e"}"></div>
    <div class="color-dot" style="background:${theme.preview?.textPrimary || "#e0e0ff"}"></div>
    <div class="color-dot" style="background:${theme.preview?.userMessageText || "#ffffff"}"></div>
  </div>
  <div class="actions">
    <button class="btn-primary" id="refresh">Refresh Theme</button>
    <button class="btn-danger" id="reset">Reset to Default</button>
  </div>
  <div class="status" id="status">Theme active</div>

  <script>
    const themeId = '${theme.id}';

    document.getElementById('refresh').addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'UPDATE_THEME' }, (res) => {
          const el = document.getElementById('status');
          el.textContent = res && res.ok ? 'Theme refreshed' : 'Error refreshing';
        });
      });
    });

    document.getElementById('reset').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'RESET_THEME' }, (res) => {
        const el = document.getElementById('status');
        el.textContent = res && res.ok ? 'Reset to default' : 'Error resetting';
      });
    });
  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI Commands
// ---------------------------------------------------------------------------

/**
 * Command: compile — Generate extension files from a theme JSON file.
 * With { emitGolden:true } it instead (re)writes the test goldens for this theme:
 * __tests__/golden/<id>.json (CC) and __tests__/golden/warp/<id>.yaml (Warp).
 */
function cmdCompile(themeFilePath, { emitGolden = false, outDir } = {}) {
  log("step", `Compiling theme: ${themeFilePath}`);
  // Where the extension is written: explicit --out wins, else EXTENSION_DIR (CWD/extension).
  const extDir = outDir ? path.resolve(CWD, outDir) : EXTENSION_DIR;

  const theme = readJson(themeFilePath);
  if (!theme) {
    log("error", `Cannot read or parse theme file: ${themeFilePath}`);
    process.exit(1);
  }

  const errors = validateTheme(theme, themeFilePath);
  if (errors.length > 0) {
    log("error", "Validation failed:");
    for (const err of errors) log("error", `  - ${err}`);
    process.exit(1);
  }

  log("ok", "Theme validation passed");

  if (emitGolden) {
    const ccTheme = buildClaudeCodeTheme(theme);
    const goldenDir = path.join(__dirname, "__tests__", "golden");
    const warpDir = path.join(goldenDir, "warp");
    fs.mkdirSync(warpDir, { recursive: true });
    writeJsonAtomic(path.join(goldenDir, `${theme.id}.json`), ccTheme);
    writeTextAtomic(
      path.join(warpDir, `${theme.id}.yaml`),
      warp.buildWarpTheme(theme, ccTheme),
    );
    log("ok", `Emitted goldens for "${theme.id}" (CC + Warp)`);
    return;
  }

  // Ensure extension directory exists
  if (!fs.existsSync(extDir)) {
    fs.mkdirSync(extDir, { recursive: true });
  }

  // Generate all extension files
  const files = {
    "manifest.json": JSON.stringify(generateManifest(theme), null, 2) + "\n",
    "inject.js": generateInjectJs(theme),
    "styles.css": generateStylesCss(theme),
    "background.js": generateBackgroundJs(theme),
    "popup.html": generatePopupHtml(theme),
  };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(extDir, filename);
    fs.writeFileSync(filePath, content, "utf8");
    log("ok", `  Generated: ${filePath}`);
  }

  log("info", `Extension compiled to: ${extDir}`);
  return files;
}

// ---------------------------------------------------------------------------
// Warp terminal channel (I/O). Pure logic lives in warp-channel.js; this layer
// does filesystem work and the line-preserving activation of ~/.warp/settings.toml.
// ---------------------------------------------------------------------------

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** Write ~/.warp/themes/<id>.yaml from the theme + its built CC theme. Returns the path. */
function writeWarpTheme(theme, ccTheme) {
  if (typeof theme.id !== "string" || !SLUG_RE.test(theme.id)) {
    throw new Error(`Unsafe theme id for Warp path: "${theme.id}"`);
  }
  fs.mkdirSync(WARP_THEMES_DIR, { recursive: true });
  const yamlPath = path.join(WARP_THEMES_DIR, `${theme.id}.yaml`);
  writeTextAtomic(yamlPath, warp.buildWarpTheme(theme, ccTheme));
  return yamlPath;
}

/**
 * Activate the Warp theme by editing ~/.warp/settings.toml in place (line-preserving).
 * Returns { activated, reason?, line } — never throws on the expected branches.
 * State model: capture the user's true original ONCE (first apply), carry it forward
 * after; abort if settings.toml changed under us (Warp owns the file at runtime).
 */
function activateWarpTheme(theme, yamlPath) {
  const statement = warp.warpActivationLine(theme, yamlPath);
  // The value portion (e.g. `"Circit"`) — stored in state so reset can recognise our
  // own value format-agnostically, and used for the no-op check.
  const activationValue = statement.slice(statement.indexOf("=") + 1).trim();
  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(WARP_STATE, "utf8"));
    } catch {
      return null;
    }
  };

  // Branch 1: no settings.toml -> create a minimal one (we own the section).
  if (!fs.existsSync(WARP_SETTINGS)) {
    const eol = "\n";
    fs.mkdirSync(WARP_THEMES_DIR, { recursive: true });
    writeTextAtomic(
      WARP_SETTINGS,
      `[appearance.themes]${eol}${statement}${eol}`,
    );
    writeJsonAtomic(WARP_STATE, {
      activeId: theme.id,
      yamlPath,
      activationValue,
      originalValueText: null,
      sectionInserted: true,
    });
    return { activated: true, line: statement };
  }

  let text;
  try {
    text = fs.readFileSync(WARP_SETTINGS, "utf8");
  } catch {
    return { activated: false, reason: "unreadable", line: statement };
  }
  const hash0 = sha256(text);
  const eol = warp.detectEol(text);
  const loc = warp.locateThemeValue(text);

  if (loc.kind === "malformed" || loc.kind === "duplicate") {
    return { activated: false, reason: loc.kind, line: statement };
  }

  // Idempotency / baseline guard: capture original only on first apply; carry forward.
  const prev = readState();
  const originalValueText = prev
    ? prev.originalValueText
    : loc.kind === "found"
      ? loc.value
      : null;

  // No-op: current value already equals what we'd write.
  if (loc.kind === "found" && loc.value.trim() === activationValue) {
    return { activated: true, line: statement };
  }

  // Pre-automation backup (once).
  if (!fs.existsSync(WARP_BAK)) writeTextAtomic(WARP_BAK, text);

  // Test-only seam: simulate Warp writing concurrently between our read and write.
  if (process.env.WL_WARP_FAULT === "mutate-settings") {
    fs.appendFileSync(WARP_SETTINGS, `${eol}# concurrent edit`);
  }

  // Concurrency abort: re-read; if it changed since hash0, leave it (and our YAML) alone.
  if (sha256(fs.readFileSync(WARP_SETTINGS, "utf8")) !== hash0) {
    return { activated: false, reason: "changed", line: statement };
  }

  let newText;
  let sectionInserted = false;
  if (loc.kind === "found") {
    newText = warp.replaceThemeValue(text, loc, loc.indent + statement);
  } else {
    const ins = warp.insertThemeKey(text, loc, statement, eol);
    newText = ins.text;
    sectionInserted = ins.sectionInserted;
  }
  writeTextAtomic(WARP_SETTINGS, newText);
  writeJsonAtomic(WARP_STATE, {
    activeId: theme.id,
    yamlPath,
    activationValue,
    originalValueText,
    sectionInserted: prev ? prev.sectionInserted : sectionInserted,
  });
  return { activated: true, line: statement };
}

/**
 * Reset the Warp channel: restore the pre-automation theme value (only if the current
 * value is still ours), delete our YAML, and clear state. `slugHint` is the CC
 * `custom:<id>` slug captured by cmdReset before it clears the CC theme — used to clean
 * an orphaned YAML when no state file exists.
 */
function deactivateWarpTheme(slugHint) {
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(WARP_STATE, "utf8"));
  } catch {
    /* no state */
  }
  const activeId =
    state && SLUG_RE.test(state.activeId)
      ? state.activeId
      : SLUG_RE.test(slugHint || "")
        ? slugHint
        : null;
  if (!activeId) return;

  const yamlPath = path.join(WARP_THEMES_DIR, `${activeId}.yaml`);

  // Restore settings.toml only if the live value is still the one we wrote.
  if (state && fs.existsSync(WARP_SETTINGS)) {
    const text = fs.readFileSync(WARP_SETTINGS, "utf8");
    const loc = warp.locateThemeValue(text);
    if (loc.kind === "found") {
      // We own the current value iff it byte-matches what we wrote (stored in state).
      // Falls back to the legacy inline-table marker for state written before
      // activationValue existed.
      const ours = state.activationValue
        ? loc.value.trim() === state.activationValue
        : loc.value.includes(`custom_${activeId.replace(/-/g, "_")}`);
      if (ours) {
        let out;
        if (state.originalValueText != null) {
          out = warp.replaceThemeValue(
            text,
            loc,
            loc.indent + `theme = ${state.originalValueText}`,
          );
        } else {
          out = warp.removeThemeValue(text, loc, {
            removeEmptySection: state.sectionInserted,
          });
        }
        writeTextAtomic(WARP_SETTINGS, out);
      }
    }
  }

  // Delete our YAML (only within WARP_THEMES_DIR) and the state file.
  if (path.dirname(yamlPath) === WARP_THEMES_DIR) {
    try {
      fs.unlinkSync(yamlPath);
    } catch {
      /* already gone */
    }
  }
  try {
    fs.unlinkSync(WARP_STATE);
  } catch {
    /* already gone */
  }
}

/**
 * Command: apply — Compile theme + update CLI settings + print instructions.
 */
function cmdApply(themeFilePath) {
  log("step", `Applying theme: ${themeFilePath}`);

  const theme = readJson(themeFilePath);
  if (!theme) {
    log("error", `Cannot read or parse theme file: ${themeFilePath}`);
    process.exit(1);
  }

  // Validate
  const errors = validateTheme(theme, themeFilePath);
  if (errors.length > 0) {
    log("error", "Validation failed:");
    for (const err of errors) log("error", `  - ${err}`);
    process.exit(1);
  }

  // Build the Claude Code custom theme first: this validates token names and
  // throws before any file is written, so a bad mapping never leaves partial state.
  const ccTheme = buildClaudeCodeTheme(theme);

  // Ensure settings + themes directories exist
  if (!fs.existsSync(CLAUDE_THEMES_DIR)) {
    fs.mkdirSync(CLAUDE_THEMES_DIR, { recursive: true });
  }

  // Read existing settings. Abort rather than clobber a config we cannot parse —
  // overwriting it would destroy the user's permissions/env/hooks/etc.
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    const parsed = readJson(SETTINGS_PATH);
    if (parsed === null) {
      log(
        "error",
        `Refusing to overwrite unparseable settings file: ${SETTINGS_PATH}`,
      );
      process.exit(1);
    }
    settings = parsed;
  }

  // Prune a previously-applied whitelabel theme file so ~/.claude/themes/ does
  // not accumulate orphans. Only touch a slug we own and that differs from the new one.
  const prev = settings.theme;
  if (typeof prev === "string" && prev.startsWith("custom:")) {
    const prevSlug = prev.slice("custom:".length);
    if (SLUG_RE.test(prevSlug) && prevSlug !== theme.id) {
      const prevFile = path.join(CLAUDE_THEMES_DIR, `${prevSlug}.json`);
      if (fs.existsSync(prevFile)) {
        fs.unlinkSync(prevFile);
        log("info", `Pruned previous theme file: ${prevFile}`);
      }
    }
  }

  // Reference the custom theme by string (NOT an object) per Claude Code's contract.
  settings.theme = `custom:${theme.id}`;

  // Defence in depth: re-assert the slug immediately before it forms a path,
  // independent of validateTheme, so no future edit there can open a traversal.
  if (typeof theme.id !== "string" || !SLUG_RE.test(theme.id)) {
    log("error", `Unsafe theme id for file path: "${theme.id}"`);
    process.exit(1);
  }
  const themeFile = path.join(CLAUDE_THEMES_DIR, `${theme.id}.json`);
  writeJsonAtomic(SETTINGS_PATH, settings);
  writeJsonAtomic(themeFile, ccTheme);
  log("ok", `Wrote custom theme: ${themeFile}`);
  log("ok", `Set theme "custom:${theme.id}" in ${SETTINGS_PATH}`);

  // Compile the extension (browser half)
  cmdCompile(themeFilePath);

  // Warp terminal channel: write the YAML (always) + activate it.
  const warpYamlPath = writeWarpTheme(theme, ccTheme);
  const warpRes = activateWarpTheme(theme, warpYamlPath);

  // Print success message
  // eslint-disable-next-line no-console
  console.log("");
  log("ok", `Theme "${theme.name}" (${theme.id}) applied successfully!`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("  Terminal (Claude Code CLI):");
  // eslint-disable-next-line no-console
  console.log(
    "    • Restart Claude Code (or re-pick via /theme) to load the new colors.",
  );
  // eslint-disable-next-line no-console
  console.log(
    `    • /theme will list it as "${theme.name}"; selecting another theme there overwrites this.`,
  );
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("  Browser (claude.ai):");
  // eslint-disable-next-line no-console
  console.log("    1. Open Chrome and navigate to chrome://extensions/");
  // eslint-disable-next-line no-console
  console.log('    2. Enable "Developer mode" (toggle in top-right)');
  // eslint-disable-next-line no-console
  console.log('    3. Click "Load unpacked" and select:');
  // eslint-disable-next-line no-console
  console.log(`       ${EXTENSION_DIR}`);
  // eslint-disable-next-line no-console
  console.log("    4. Visit https://claude.ai to see your theme");
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("  Warp terminal:");
  if (warpRes.activated) {
    // eslint-disable-next-line no-console
    console.log(
      `    • Theme written to ${warpYamlPath} and activated in settings.toml.`,
    );
    // eslint-disable-next-line no-console
    console.log(
      "    • Reload/restart Warp to see the new background + palette.",
    );
  } else {
    log(
      "warn",
      `  Warp theme written to ${warpYamlPath} but NOT activated (${warpRes.reason}).`,
    );
    // eslint-disable-next-line no-console
    console.log(
      "    Close Warp and re-run, or paste this into ~/.warp/settings.toml under [appearance.themes]:",
    );
    // eslint-disable-next-line no-console
    console.log(`      ${warpRes.line}`);
  }
  // eslint-disable-next-line no-console
  console.log("");
}

/**
 * Command: reset — Remove the active whitelabel custom theme from the Claude
 * Code CLI config (deletes ~/.claude/themes/<slug>.json and clears the theme
 * string). Only touches themes we own (a "custom:" reference); built-in themes
 * like "dark" are left untouched.
 */
function cmdReset() {
  // Warp cleanup runs FIRST and unconditionally — capture the CC slug while it still
  // exists, so a user who already cleared the CC theme via /theme can still clean up
  // the orphaned Warp YAML + restore settings.toml. readJson is called once here and
  // reused below (it returns null for BOTH absent and unparseable, so split them).
  const settingsExists = fs.existsSync(SETTINGS_PATH);
  const settings = settingsExists ? readJson(SETTINGS_PATH) : null;
  let slugHint;
  if (
    settings &&
    typeof settings.theme === "string" &&
    settings.theme.startsWith("custom:")
  ) {
    slugHint = settings.theme.slice("custom:".length);
  }
  deactivateWarpTheme(slugHint);

  // CC reset (behaviour unchanged): absent settings.json -> exit 0; unparseable -> exit 1.
  if (!settingsExists) {
    log("info", "No settings.json found; nothing to reset.");
    return;
  }
  if (settings === null) {
    log(
      "error",
      `Refusing to modify unparseable settings file: ${SETTINGS_PATH}`,
    );
    process.exit(1);
  }

  const cur = settings.theme;
  if (typeof cur !== "string" || !cur.startsWith("custom:")) {
    log("info", "No whitelabel custom theme active; leaving theme unchanged.");
    return;
  }

  const slug = cur.slice("custom:".length);
  if (!SLUG_RE.test(slug)) {
    log("error", `Refusing to act on unsafe theme slug: "${slug}"`);
    process.exit(1);
  }

  const themeFile = path.join(CLAUDE_THEMES_DIR, `${slug}.json`);
  if (fs.existsSync(themeFile)) {
    fs.unlinkSync(themeFile);
    log("ok", `Removed theme file: ${themeFile}`);
  } else {
    log("warn", `Theme file already absent: ${themeFile}`);
  }

  delete settings.theme;
  writeJsonAtomic(SETTINGS_PATH, settings);
  log("ok", "Cleared theme; Claude Code reverts to its default.");
}

/**
 * Command: list — Scan themes directory and print a formatted table.
 */
function cmdList() {
  log("step", `Scanning themes directory: ${THEMES_DIR}`);

  if (!fs.existsSync(THEMES_DIR)) {
    log("warn", `Themes directory does not exist: ${THEMES_DIR}`);
    // eslint-disable-next-line no-console
    console.log("No themes found.");
    return;
  }

  const rows = [];
  const entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const themeJsonPath = path.join(THEMES_DIR, entry.name, "theme.json");
    const theme = readJson(themeJsonPath);
    if (!theme) continue;

    rows.push([
      theme.id || entry.name,
      theme.name || "(unnamed)",
      theme.author || "(unknown)",
      (theme.tags || []).join(", ") || "-",
    ]);
  }

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log("No themes found.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(formatTable(rows, ["ID", "Name", "Author", "Tags"]));
  // eslint-disable-next-line no-console
  console.log(`\n${rows.length} theme(s) found.`);
}

/**
 * Command: validate — Validate a theme JSON file against the schema.
 */
function cmdValidate(themeFilePath) {
  log("step", `Validating: ${themeFilePath}`);

  const theme = readJson(themeFilePath);
  if (!theme) {
    log("error", `Cannot read or parse JSON file: ${themeFilePath}`);
    process.exit(1);
  }

  const errors = validateTheme(theme, themeFilePath);

  if (errors.length === 0) {
    log("ok", `Valid: "${theme.name}" (${theme.id})`);
    log("info", `  Author: ${theme.author}`);
    log("info", `  Version: ${theme.version}`);
    log("info", `  Tags: ${(theme.tags || []).join(", ") || "(none)"}`);
  } else {
    log("error", `Validation failed for: ${themeFilePath}`);
    for (const err of errors) log("error", `  - ${err}`);
    process.exit(1);
  }
}

/**
 * Command: preview — Start a local HTTP server with a themed mock UI.
 */
function cmdPreview(themeFilePath, port = 8765) {
  log("step", `Starting preview server for: ${themeFilePath}`);

  const theme = readJson(themeFilePath);
  if (!theme) {
    log("error", `Cannot read or parse theme file: ${themeFilePath}`);
    process.exit(1);
  }

  const errors = validateTheme(theme, themeFilePath);
  if (errors.length > 0) {
    log("error", "Validation failed:");
    for (const err of errors) log("error", `  - ${err}`);
    process.exit(1);
  }

  const c = theme.tokens?.color || {};
  const typo = theme.tokens?.typography || {};

  // Build CSS custom properties
  const cssVars = Object.entries(c)
    .map(
      ([k, v]) =>
        `    --ct-${k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}: ${v};`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview: ${htmlEscape(theme.name)}</title>
  <style>
    :root {
${cssVars}
      --ct-font-family: ${typo.fontFamily || "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"};
      --ct-font-size-base: ${typo.fontSizeBase || "16px"};
      --ct-line-height: ${typo.lineHeight || 1.5};
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--ct-font-family);
      font-size: var(--ct-font-size-base);
      line-height: var(--ct-line-height);
      background: var(--ct-background);
      color: var(--ct-text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Sidebar */
    .app {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .sidebar {
      width: 260px;
      background: var(--ct-surface);
      border-right: 1px solid var(--ct-border, #333355);
      display: flex;
      flex-direction: column;
      padding: 16px;
    }

    .logo {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-icon {
      width: 28px;
      height: 28px;
      background: var(--ct-brand-primary);
      border-radius: 6px;
    }

    .nav-item {
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 14px;
      color: var(--ct-text-secondary, var(--ct-text-primary));
    }

    .nav-item:hover {
      background: var(--ct-surface-hover, rgba(255,255,255,0.05));
    }

    /* Main chat area */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      padding: 12px 24px;
      border-bottom: 1px solid var(--ct-border, #333355);
      font-weight: 600;
      background: var(--ct-surface);
    }

    .chat {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      max-width: 80%;
      padding: 14px 18px;
      border-radius: 12px;
      font-size: 15px;
      line-height: 1.6;
    }

    .message.user {
      align-self: flex-end;
      background: var(--ct-user-message-background, var(--ct-brand-primary));
      color: var(--ct-user-message-text);
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--ct-assistant-message-background, var(--ct-surface));
      color: var(--ct-assistant-message-text, var(--ct-text-primary));
      border: 1px solid var(--ct-border, #333355);
    }

    .input-bar {
      padding: 16px 24px;
      border-top: 1px solid var(--ct-border, #333355);
      display: flex;
      gap: 12px;
      background: var(--ct-surface);
    }

    .input-field {
      flex: 1;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid var(--ct-border, #333355);
      background: var(--ct-background);
      color: var(--ct-text-primary);
      font-size: 15px;
      outline: none;
    }

    .input-field:focus {
      border-color: var(--ct-brand-primary);
      box-shadow: 0 0 0 2px var(--ct-border-focus, rgba(99, 102, 241, 0.2));
    }

    .send-btn {
      padding: 12px 20px;
      border-radius: 8px;
      border: none;
      background: var(--ct-brand-primary);
      color: var(--ct-user-message-text, #fff);
      font-weight: 600;
      cursor: pointer;
    }

    .preview-badge {
      position: fixed;
      top: 12px;
      right: 12px;
      padding: 6px 14px;
      border-radius: 20px;
      background: var(--ct-brand-primary);
      color: var(--ct-user-message-text, #fff);
      font-size: 12px;
      font-weight: 600;
      z-index: 100;
    }

    .color-strip {
      display: flex;
      height: 4px;
    }

    .color-strip > div { flex: 1; }

    code {
      background: var(--ct-code-background, rgba(255,255,255,0.1));
      color: var(--ct-code-text, var(--ct-text-primary));
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 0.9em;
    }
  </style>
  ${typo.fontUrl ? `<link rel="stylesheet" href="${typo.fontUrl}">` : ""}
</head>
<body>
  <div class="color-strip">
    <div style="background:var(--ct-brand-primary)"></div>
    <div style="background:var(--ct-background)"></div>
    <div style="background:var(--ct-surface)"></div>
    <div style="background:var(--ct-text-primary)"></div>
    <div style="background:var(--ct-user-message-text)"></div>
  </div>
  <div class="preview-badge">Preview: ${htmlEscape(theme.name)} v${htmlEscape(theme.version)}</div>
  <div class="app">
    <aside class="sidebar">
      <div class="logo"><div class="logo-icon"></div>Claude</div>
      <div class="nav-item">+ New chat</div>
      <div class="nav-item">Recent conversations</div>
      <div class="nav-item">Settings</div>
    </aside>
    <main class="main">
      <div class="header">${htmlEscape(theme.name)} — Preview</div>
      <div class="chat">
        <div class="message user">Hello! This is a preview of the <strong>${htmlEscape(theme.name)}</strong> theme. How does it look?</div>
        <div class="message assistant">
          This is how assistant messages appear. The theme uses <code>${c.brandPrimary || "#6366f1"}</code> as the primary brand color.
          ${theme.description ? `<br><br><em>${htmlEscape(theme.description)}</em>` : ""}
        </div>
        <div class="message user">Can I use custom fonts too?</div>
        <div class="message assistant">Yes! This theme ${typo.fontFamily ? `uses <code>${htmlEscape(typo.fontFamily)}</code> for typography.` : "uses the default system font stack."} You can also add a custom logo and favicon.</div>
      </div>
      <div class="input-bar">
        <input class="input-field" placeholder="Type a message..." value="Preview message" readonly>
        <button class="send-btn">Send</button>
      </div>
    </main>
  </div>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(port, () => {
    log("ok", `Preview server running at http://localhost:${port}`);
    log("info", "Press Ctrl+C to stop");
  });
}

/**
 * Command: init — Create a new theme folder with a template JSON.
 */
function cmdInit(themeName) {
  const themeId = kebabCase(themeName);
  // Write new themes under the user's CWD (not THEMES_DIR / the package dir, which is
  // read-only when installed via npm). In the repo, CWD == repo root → repo/themes.
  const themeDir = path.join(CWD, "themes", themeId);
  const themeJsonPath = path.join(themeDir, "theme.json");

  if (fs.existsSync(themeDir)) {
    log("error", `Theme directory already exists: ${themeDir}`);
    process.exit(1);
  }

  fs.mkdirSync(themeDir, { recursive: true });

  const template = {
    name: themeName,
    id: themeId,
    version: "1.0.0",
    author: "Your Name",
    description: `A custom Claude theme called ${themeName}`,
    license: "MIT",
    tags: ["custom"],
    preview: {
      background: "#0f0f23",
      surface: "#1a1a2e",
      textPrimary: "#e0e0ff",
      brandPrimary: "#6366f1",
      userMessageText: "#ffffff",
    },
    tokens: {
      color: {
        brandPrimary: "#6366f1",
        brandSecondary: "#818cf8",
        brandAccent: "#818cf8",
        background: "#0f0f23",
        surface: "#1a1a2e",
        surfaceHover: "#252545",
        textPrimary: "#e0e0ff",
        textSecondary: "#a0a0cc",
        textMuted: "#606088",
        border: "#333355",
        borderFocus: "#6366f1",
        userMessageText: "#ffffff",
        userMessageBackground: "#6366f1",
        assistantMessageText: "#e0e0ff",
        assistantMessageBackground: "#1a1a2e",
        codeBackground: "#252545",
        codeText: "#c8c8ff",
        error: "#ef4444",
        success: "#22c55e",
        warning: "#f59e0b",
      },
      typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontUrl:
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700",
        fontSizeBase: "16px",
        lineHeight: 1.6,
      },
    },
    terminal: {
      deriveAll: true,
      base: "dark",
      userColor: "#6366f1",
      assistantColor: "#e0e0ff",
      systemColor: "#818cf8",
      errorColor: "#ef4444",
      successColor: "#22c55e",
      backgroundColor: "#0f0f23",
      promptColor: "#818cf8",
    },
  };

  writeJson(themeJsonPath, template);
  log("ok", `Created theme template: ${themeJsonPath}`);
  // eslint-disable-next-line no-console
  console.log("");
  log("info", "Next steps to customize your theme:");
  log("info", `  1. Edit ${themeJsonPath}`);
  log("info", "  2. Customize the color values (all #RRGGBB format)");
  log(
    "info",
    "  3. Optionally modify typography, logo, favicon, or terminal colors",
  );
  log(
    "info",
    `  4. Validate: node .claude/skills/whitelabel-theme/build-theme.js validate ${themeJsonPath}`,
  );
  log(
    "info",
    `  5. Preview:  node .claude/skills/whitelabel-theme/build-theme.js preview ${themeJsonPath}`,
  );
  log(
    "info",
    `  6. Apply:    node .claude/skills/whitelabel-theme/build-theme.js apply ${themeJsonPath}`,
  );
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Resolve a theme argument to a theme.json path. Accepts (in order): an existing file
 * path (relative to CWD), a bundled theme directory NAME (themes/<arg>/theme.json), or a
 * bundled theme by its `id`. Falls back to the CWD-resolved path so the normal
 * "cannot read" error fires for a genuinely missing theme. This lets `apply cyberpunk`
 * / `apply neon-district` work (incl. for npx users with no local theme files), not just
 * `apply ./path/to/theme.json`.
 */
function resolveThemeArg(arg) {
  const asPath = path.resolve(CWD, arg);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) return asPath;
  if (SLUG_RE.test(arg)) {
    const byDir = path.join(THEMES_DIR, arg, "theme.json");
    if (fs.existsSync(byDir)) return byDir;
  }
  try {
    for (const e of fs.readdirSync(THEMES_DIR, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const tj = path.join(THEMES_DIR, e.name, "theme.json");
      if (!fs.existsSync(tj)) continue;
      try {
        const t = JSON.parse(fs.readFileSync(tj, "utf8"));
        if (t && t.id === arg) return tj;
      } catch {
        /* skip unparseable bundled theme */
      }
    }
  } catch {
    /* THEMES_DIR missing */
  }
  return asPath;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    // eslint-disable-next-line no-console
    console.log(`
Claude White-Label Theme Compiler — Zero-Dependency CLI

Usage:
  node build-theme.js apply <theme-file>      Apply theme (compile + settings)
  node build-theme.js reset                    Remove active CLI theme + restore default
  node build-theme.js compile <theme-file>    Compile theme to extension/
  node build-theme.js list                    List all available themes
  node build-theme.js validate <theme-file>   Validate a theme JSON file
  node build-theme.js preview <theme-file>    Start preview server (port 8765)
  node build-theme.js init <theme-name>       Create a new theme template

Commands:
  apply    — Write ~/.claude/themes/<id>.json + set theme:"custom:<id>" + compile extension
  reset    — Delete the active custom theme file and clear the theme from settings.json
  compile  — Generate Chrome extension files in extension/
  list     — Scan themes/ directory and display theme table
  validate — Validate theme JSON against schema rules
  preview  — Start HTTP server with themed mock Claude UI
  init     — Create a new theme folder with template JSON

Options:
  preview command accepts optional port: node build-theme.js preview theme.json 8080
`);
    process.exit(0);
  }

  switch (command) {
    case "apply": {
      if (!args[1]) {
        log("error", "Usage: node build-theme.js apply <theme-file>");
        process.exit(1);
      }
      cmdApply(resolveThemeArg(args[1]));
      break;
    }

    case "reset": {
      cmdReset();
      break;
    }

    case "compile": {
      if (!args[1]) {
        log(
          "error",
          "Usage: node build-theme.js compile <theme-file> [--out <dir>] [--emit-golden]",
        );
        process.exit(1);
      }
      const outIdx = args.indexOf("--out");
      cmdCompile(resolveThemeArg(args[1]), {
        emitGolden: args.includes("--emit-golden"),
        outDir: outIdx !== -1 ? args[outIdx + 1] : undefined,
      });
      break;
    }

    case "list": {
      cmdList();
      break;
    }

    case "validate": {
      if (!args[1]) {
        log("error", "Usage: node build-theme.js validate <theme-file>");
        process.exit(1);
      }
      cmdValidate(resolveThemeArg(args[1]));
      break;
    }

    case "preview": {
      if (!args[1]) {
        log("error", "Usage: node build-theme.js preview <theme-file> [port]");
        process.exit(1);
      }
      const port = args[2] ? parseInt(args[2], 10) : 8765;
      if (isNaN(port) || port < 1 || port > 65535) {
        log("error", `Invalid port: ${args[2]}`);
        process.exit(1);
      }
      cmdPreview(resolveThemeArg(args[1]), port);
      break;
    }

    case "init": {
      if (!args[1]) {
        log("error", "Usage: node build-theme.js init <theme-name>");
        process.exit(1);
      }
      cmdInit(args[1]);
      break;
    }

    default: {
      log("error", `Unknown command: "${command}"`);
      log("info", "Run with --help for usage information");
      process.exit(1);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export functions for testing / programmatic use
module.exports = {
  main,
  validateTheme,
  generateManifest,
  generateInjectJs,
  generateStylesCss,
  generateBackgroundJs,
  generatePopupHtml,
  kebabCase,
  formatTable,
  buildClaudeCodeTheme,
  lighten,
  pickBase,
  buildPalette,
  isColorValue,
  CC_TOKENS,
  ANSI_NAMES,
  VALID_BASES,
  SLUG_RE,
  CLAUDE_THEMES_DIR,
  THEMES_DIR,
};
