#!/usr/bin/env node

/**
 * warp-channel.js — Warp terminal channel for the white-label theme compiler.
 *
 * PURE module (no fs/os/process): string in, string out. Two responsibilities:
 *   1. buildWarpTheme()  — emit a Warp theme YAML from a whitelabel theme + its
 *      already-built Claude Code theme (so the Warp window background matches the
 *      CC block background by construction).
 *   2. A line-preserving TOML editor (locate/replace/insert/remove) for the single
 *      `theme = …` value inside `[appearance.themes]` of ~/.warp/settings.toml.
 *
 * Implements docs/superpowers/specs/2026-05-29-warp-theming-design.md. All colour
 * maths is delegated to cli-derive.js; this file adds no new colour primitives.
 */

"use strict";

const {
  parseHex,
  toHex,
  mix,
  lighten,
  relLuminance,
} = require("./cli-derive.js");

const MIN_ANSI = 3.0; // documented anchor floor (unused as a hard bound — see anchors)

// ---------------------------------------------------------------------------
// Colour resolution
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^rgb\(\s*(-?\d{1,3})\s*,\s*(-?\d{1,3})\s*,\s*(-?\d{1,3})\s*\)$/;

/**
 * Normalise any accepted colour form to lowercase #rrggbb. cli-derive.parseHex is
 * hex-only (throws on rgb()/ansi:), so the rgb() conversion lives here and ansi
 * forms (no RGB equivalent) fall back. Returns `fallbackHex` (which MAY be
 * undefined, so the caller omits the slot) when `value` is absent/unresolvable.
 */
function resolveHex(value, fallbackHex) {
  if (typeof value === "string") {
    const v = value.trim();
    if (HEX_RE.test(v)) return toHex(parseHex(v)); // normalises #rgb -> #rrggbb, lowercases
    const m = v.match(RGB_RE);
    if (m) return toHex({ r: +m[1], g: +m[2], b: +m[3] }); // clamp8 inside toHex
    // ansi:<name> / ansi256(n) have no RGB -> fall through to fallback
  }
  return fallbackHex;
}

// ---------------------------------------------------------------------------
// YAML emission
// ---------------------------------------------------------------------------

/** Escape a string for a double-quoted YAML scalar (defence-in-depth atop the
 *  theme-name allowlist, which already bans quotes/braces/semicolons but not `:`/`#`). */
function yamlString(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Build a Warp theme YAML string from a whitelabel theme and its built CC theme.
 * Deterministic; no I/O. Throws only on the can't-happen unresolved-background
 * path (background is a required, validated hex token).
 */
function buildWarpTheme(theme, ccTheme) {
  const c = (theme.tokens && theme.tokens.color) || {};
  const t = theme.terminal || {};
  const ccOverrides = (ccTheme && ccTheme.overrides) || {};

  const bg = resolveHex(
    ccOverrides.userMessageBackground,
    resolveHex(c.background),
  );
  if (!bg) throw new Error("buildWarpTheme: unresolved background"); // tripwire; can't happen for a valid theme
  const fg = resolveHex(t.assistantColor, resolveHex(c.textPrimary));

  // slot() — first defined colour wins; undefined => caller omits the key.
  const slot = (...chain) =>
    chain.reduce(
      (acc, v) => (acc !== undefined ? acc : resolveHex(v)),
      undefined,
    );

  const accent = slot(t.promptColor, c.brandPrimary);
  const details = relLuminance(bg) < 0.5 ? "darker" : "lighter"; // keyword, not a colour

  // Absolute ANSI anchors by POLARITY (not contrastFloor, which would invert them on
  // a dark bg). The 0.15/0.85 nudges are best-effort; the only hard contract is the
  // polarity the test asserts. No contrast-vs-bg floor (a near-black "black" can't
  // clear 3:1 vs a near-black bg — it reads against light text, not bg).
  const byLum = (...hx) =>
    hx.filter(Boolean).sort((a, b) => relLuminance(a) - relLuminance(b));
  const cands = byLum(resolveHex(c.textPrimary), resolveHex(c.surface), bg);
  let black = cands[0];
  if (relLuminance(black) > 0.15) black = mix(black, "#000000", 0.6);
  let white = cands[cands.length - 1];
  if (relLuminance(white) < 0.85) white = mix(white, "#ffffff", 0.6);

  const normal = {
    black,
    red: slot(t.errorColor, c.error),
    green: slot(t.successColor, c.success),
    yellow: slot(c.warning),
    blue: slot(t.systemColor, c.brandAccent),
    magenta: slot(c.textSecondary, c.brandPrimary),
    cyan: slot(t.userColor, c.brandPrimary),
    white,
  };
  const bright = {};
  for (const [k, h] of Object.entries(normal))
    if (h) bright[k] = lighten(h, 0.25);

  const ansiOrder = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
  ];
  const emitGroup = (group) =>
    ansiOrder
      .filter((k) => group[k])
      .map((k) => `    ${k}: '${group[k]}'`)
      .join("\n");

  // Block-style YAML matching the hand-written reference shape. All hex lowercase.
  // accent/foreground emitted only when resolved (never 'undefined'); validation
  // guarantees their source tokens, so for a valid theme they are always present.
  return (
    `name: ${yamlString(theme.name)}\n` +
    (accent ? `accent: '${accent}'\n` : "") +
    `background: '${bg}'\n` +
    (fg ? `foreground: '${fg}'\n` : "") +
    `details: ${details}\n` +
    `terminal_colors:\n` +
    `  normal:\n${emitGroup(normal)}\n` +
    `  bright:\n${emitGroup(bright)}\n`
  );
}

// ---------------------------------------------------------------------------
// TOML line-editor (the `theme` value inside [appearance.themes])
// ---------------------------------------------------------------------------

/** Detect the dominant line terminator. */
function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Split into line records with absolute offsets; preserves per-line terminator. */
function splitLines(text) {
  const lines = [];
  const re = /\r\n|\n/g;
  let m;
  let last = 0;
  while ((m = re.exec(text))) {
    lines.push({
      text: text.slice(last, m.index),
      start: last,
      contentEnd: m.index,
      end: re.lastIndex,
    });
    last = re.lastIndex;
  }
  lines.push({
    text: text.slice(last),
    start: last,
    contentEnd: text.length,
    end: text.length,
  });
  return lines;
}

const HEADER_RE = /^\s*\[([^\]]*)\]\s*$/;
const THEME_KEY_RE = /^theme\s*=/;

/**
 * Locate the `theme` value inside [appearance.themes].
 * Returns one of:
 *   { kind:'found', start, end, value, indent, lineEnd }
 *   { kind:'missing', sectionExists, insertOffset }
 *   { kind:'duplicate' }   — a `theme` key exists under a different table
 *   { kind:'malformed' }   — brace/string scan could not bail safely
 */
function locateThemeValue(text) {
  const lines = splitLines(text);
  let section = null;
  let sectionExists = false;
  let headerLineEnd = null; // end offset (after eol) of the [appearance.themes] header
  let themeOther = false; // a theme key seen in some other section

  let target = null; // line record of theme inside [appearance.themes]
  for (const line of lines) {
    const h = line.text.match(HEADER_RE);
    if (h) {
      section = h[1].trim();
      if (section === "appearance.themes") {
        sectionExists = true;
        headerLineEnd = line.end;
      }
      continue;
    }
    const trimmed = line.text.replace(/^\s+/, "");
    if (trimmed.startsWith("#")) continue; // comment line
    if (THEME_KEY_RE.test(trimmed)) {
      if (section === "appearance.themes") {
        if (!target) target = line;
      } else {
        themeOther = true;
      }
    }
  }

  if (!target) {
    if (themeOther) return { kind: "duplicate" };
    return {
      kind: "missing",
      sectionExists,
      insertOffset: sectionExists ? headerLineEnd : text.length,
    };
  }

  // Value scan from the first '=' on the target line. Skip ONLY spaces/tabs — the value
  // must begin on the key's line (TOML requires it). Crossing a newline would let an
  // empty value (`theme =\n`) swallow the next sibling line, so bail malformed instead.
  const eqRel = target.text.indexOf("=");
  let p = target.start + eqRel + 1;
  while (p < text.length && (text[p] === " " || text[p] === "\t")) p++;
  if (p >= text.length || text[p] === "\n" || text[p] === "\r")
    return { kind: "malformed" };
  const valueStart = p;
  const first = text[p];

  let end;
  if (first === "{") {
    let depth = 0;
    let i = p;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        if (text.startsWith(ch.repeat(3), i)) return { kind: "malformed" }; // multi-line string
        const q = ch;
        i++;
        let closed = false;
        while (i < text.length) {
          if (q === '"' && text[i] === "\\") {
            i += 2;
            continue;
          }
          if (text[i] === "\n") return { kind: "malformed" }; // unterminated single-line string
          if (text[i] === q) {
            i++;
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) return { kind: "malformed" };
        continue;
      }
      if (ch === "#") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    if (depth !== 0) return { kind: "malformed" }; // EOF with open braces
    end = i;
  } else if (first === '"' || first === "'") {
    const q = first;
    let i = p + 1;
    let closed = false;
    while (i < text.length) {
      if (q === '"' && text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === "\n") return { kind: "malformed" };
      if (text[i] === q) {
        i++;
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) return { kind: "malformed" };
    end = i;
  } else {
    // bare value: to end of line
    let i = p;
    while (i < text.length && text[i] !== "\n") i++;
    end = i;
    // trim trailing \r and whitespace
    while (end > valueStart && /[ \t\r]/.test(text[end - 1])) end--;
  }

  const indent = target.text.match(/^\s*/)[0];
  // lineEnd = end of the line that contains `end` (incl. its eol) — used by removeThemeValue.
  const tail = splitLines(text).find((l) => end > l.start && end <= l.end) || {
    end,
  };
  return {
    kind: "found",
    start: target.start,
    end,
    value: text.slice(valueStart, end),
    indent,
    lineEnd: tail.end,
  };
}

/** Replace the located `theme` statement [start,end) with a new statement string. */
function replaceThemeValue(text, loc, newStatement) {
  return text.slice(0, loc.start) + newStatement + text.slice(loc.end);
}

/**
 * Insert a `theme` statement when none exists. If the [appearance.themes] section
 * exists, insert right after its header; else append a new section at EOF.
 * Returns { text, sectionInserted }.
 */
function insertThemeKey(text, loc, statement, eol) {
  if (loc.sectionExists) {
    const at = loc.insertOffset;
    return {
      text: text.slice(0, at) + statement + eol + text.slice(at),
      sectionInserted: false,
    };
  }
  const sep = text.length === 0 || text.endsWith("\n") ? "" : eol;
  const block = `${sep}[appearance.themes]${eol}${statement}${eol}`;
  return { text: text + block, sectionInserted: true };
}

/**
 * Remove the located `theme` statement line(s). If `removeEmptySection` and we own
 * the header, also drop the `[appearance.themes]` header — but ONLY when the section
 * body is otherwise empty (protects a pre-existing `system_theme` sibling).
 */
function removeThemeValue(text, loc, { removeEmptySection } = {}) {
  // Remove the whole statement line(s): from the line start through the value's line end (incl eol).
  let out = text.slice(0, loc.start) + text.slice(loc.lineEnd);

  if (removeEmptySection) {
    const lines = splitLines(out);
    // Find the [appearance.themes] header and check whether its body has any non-blank,
    // non-comment content before the next header / EOF.
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].text.match(HEADER_RE);
      if (h && h[1].trim() === "appearance.themes") {
        let bodyEmpty = true;
        let removeUntil = lines[i].end;
        for (let j = i + 1; j < lines.length; j++) {
          if (HEADER_RE.test(lines[j].text)) break;
          const tr = lines[j].text.trim();
          if (tr !== "" && !tr.startsWith("#")) {
            bodyEmpty = false;
            break;
          }
        }
        if (bodyEmpty)
          out = out.slice(0, lines[i].start) + out.slice(removeUntil);
        break;
      }
    }
  }
  return out;
}

/** Build the Warp activation TOML line (matches Warp's native inline-table form). */
function warpActivationLine(theme, yamlPath) {
  const slug = "custom_" + String(theme.id).replace(/-/g, "_");
  const name =
    '"' + String(theme.name).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const p =
    '"' + String(yamlPath).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return `theme = { ${slug} = { name = ${name}, path = ${p} } }`;
}

module.exports = {
  MIN_ANSI,
  resolveHex,
  buildWarpTheme,
  locateThemeValue,
  replaceThemeValue,
  insertThemeKey,
  removeThemeValue,
  warpActivationLine,
  detectEol,
};
