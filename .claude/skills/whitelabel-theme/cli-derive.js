"use strict";

/**
 * Pure colour math + token derivation for the Claude Code CLI theme channel.
 *
 * `deriveTokens(palette, { base })` produces a hex value for every token in the
 * full verified set, derived from a small input palette. It is opt-in: the
 * compiler only calls it when a theme sets `terminal.deriveAll: true`. All
 * functions are pure and deterministic (idempotent) so they can be unit-tested
 * with hand-computed oracles and so derivation never depends on call order.
 *
 * Design notes:
 * - Blending is linear in sRGB (matching the existing `lighten` in build-theme.js).
 * - Rainbow/subagent hues are FIXED full-spectrum anchors, not rotated from the
 *   brand colour — anchoring on a pink brand would collapse the rainbow to pink.
 *   Only saturation/lightness are tuned for the base.
 * - Shimmer is luminance-aware: lighten on dark bases, darken on light bases.
 * - Derived foreground tokens pass a contrast floor against the background so a
 *   low-contrast palette can't produce invisible diffs/text.
 */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp8(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Parse #rgb or #rrggbb into {r,g,b} (0-255). Throws on malformed input. */
function parseHex(hex) {
  if (typeof hex !== "string" || !HEX_RE.test(hex)) {
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  }
  let h = hex.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** {r,g,b} -> #rrggbb (clamped + rounded). */
function toHex({ r, g, b }) {
  return (
    "#" + [r, g, b].map((v) => clamp8(v).toString(16).padStart(2, "0")).join("")
  );
}

/** Linear sRGB blend: t=0 -> a, t=1 -> b. */
function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const f = Math.max(0, Math.min(1, t));
  return toHex({
    r: ca.r + (cb.r - ca.r) * f,
    g: ca.g + (cb.g - ca.g) * f,
    b: ca.b + (cb.b - ca.b) * f,
  });
}

/** Blend toward white by amt (0..1). */
function lighten(hex, amt) {
  return mix(hex, "#ffffff", amt);
}

/** Blend toward black by amt (0..1). */
function darken(hex, amt) {
  return mix(hex, "#000000", amt);
}

/** WCAG relative luminance (0..1) for a hex colour. */
function relLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  const chan = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio (1..21) between two hex colours. */
function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ensure `color` is distinguishable from `bg`. If contrast is below `min`,
 * push it toward whichever extreme (white or black) yields the most contrast
 * against `bg`, until it clears the floor.
 *
 * The push direction is chosen by which extreme actually has more contrast
 * headroom against `bg` — NOT by a luminance < 0.5 split, which picks the wrong
 * way for mid-tone backgrounds (e.g. #aaaaaa has more headroom toward black).
 *
 * Best-effort: for a mid-grey `bg` with a high `min` (e.g. 3), neither extreme
 * may reach the floor; the closest-achievable colour is returned.
 */
function contrastFloor(color, bg, min = 1.6) {
  if (contrastRatio(color, bg) >= min) return color;
  const target =
    contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg)
      ? "#ffffff"
      : "#000000";
  let out = color;
  for (let step = 1; step <= 10; step++) {
    out = mix(color, target, step / 10);
    if (contrastRatio(out, bg) >= min) return out;
  }
  return out;
}

/** HSL (h in [0,360), s,l in [0,1]) -> #rrggbb. */
function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Saturation of a hex colour (HSL S, 0..1). 0 for achromatic (grey). */
function saturationOf(hex) {
  const { r, g, b } = parseHex(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0; // achromatic — explicit S=0 handling
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function isLightBase(base) {
  return typeof base === "string" && base.startsWith("light");
}

/** Luminance-aware shimmer: brighten on dark bases, darken on light bases. */
function shimmer(hex, base) {
  return isLightBase(base) ? darken(hex, 0.14) : lighten(hex, 0.14);
}

// Fixed full-spectrum hues for the rainbow gradient (degrees).
const RAINBOW_HUES = {
  rainbow_red: 0,
  rainbow_orange: 30,
  rainbow_yellow: 52,
  rainbow_green: 130,
  rainbow_blue: 215,
  rainbow_indigo: 260,
  rainbow_violet: 290,
};

// Fixed distinct hues for the 8 subagent colours (degrees).
const SUBAGENT_HUES = {
  red_FOR_SUBAGENTS_ONLY: 2,
  orange_FOR_SUBAGENTS_ONLY: 30,
  yellow_FOR_SUBAGENTS_ONLY: 50,
  green_FOR_SUBAGENTS_ONLY: 135,
  cyan_FOR_SUBAGENTS_ONLY: 188,
  blue_FOR_SUBAGENTS_ONLY: 215,
  purple_FOR_SUBAGENTS_ONLY: 270,
  pink_FOR_SUBAGENTS_ONLY: 320,
};

/**
 * Derive a hex value for every token in the verified set from a small palette.
 *
 * @param {object} palette - resolved colours (all hex):
 *   { bg, text, brand, accent, success, error, warning, userText }
 * @param {object} [opts]
 * @param {string} [opts.base] - the resolved Claude Code base (affects shimmer/lightness)
 * @returns {Object<string,string>} token -> hex
 */
function deriveTokens(palette, opts = {}) {
  const base = opts.base || "dark";
  const light = isLightBase(base);
  // Canonicalise every palette colour to #rrggbb so passthrough tokens and
  // derived tokens share one uniform form (also validates each via parseHex).
  const norm = (h) => toHex(parseHex(h));
  const bg = norm(palette.bg);
  const text = norm(palette.text);
  const brand = norm(palette.brand);
  const accent = norm(
    palette.accent !== undefined ? palette.accent : palette.brand,
  );
  const success = norm(palette.success);
  const error = norm(palette.error);
  const warning = norm(palette.warning);
  const userText = norm(
    palette.userText !== undefined ? palette.userText : palette.brand,
  );

  // Lightness/saturation targets for generated hues, tuned per base.
  const genL = light ? 0.42 : 0.62;
  const genS = 0.78; // vivid but not neon
  // Nudge generated saturation a touch toward the brand's own saturation.
  const brandS = saturationOf(brand);
  const sat = Math.max(0.5, Math.min(0.92, (genS + brandS) / 2 + 0.15));

  const out = {};

  // Brand
  out.claude = brand;
  out.claudeShimmer = shimmer(brand, base);

  // Text
  out.text = contrastFloor(text, bg, 3);
  // inverseText is drawn on an inverted/brand fill — must read against brand.
  out.inverseText = contrastFloor(bg, brand, 3);
  out.inactive = contrastFloor(mix(text, bg, 0.55), bg, 1.5);
  out.subtle = contrastFloor(mix(text, bg, 0.4), bg, 1.6);
  out.suggestion = contrastFloor(mix(text, bg, 0.48), bg, 1.6);
  out.remember = accent;

  // Status
  out.success = success;
  out.error = error;
  out.warning = warning;
  out.merged = mix(brand, accent, 0.5);

  // Input / mode
  out.promptBorder = brand;
  out.permission = warning;
  out.planMode = accent;
  out.autoAccept = success;
  out.bashBorder = contrastFloor(mix(accent, bg, 0.5), bg, 1.5);
  out.ide = accent;
  out.fastMode = accent;

  // Diffs — added from success, removed from error, all floored against bg.
  out.diffAdded = contrastFloor(mix(success, bg, 0.72), bg);
  out.diffRemoved = contrastFloor(mix(error, bg, 0.72), bg);
  out.diffAddedDimmed = contrastFloor(mix(success, bg, 0.85), bg, 1.25);
  out.diffRemovedDimmed = contrastFloor(mix(error, bg, 0.85), bg, 1.25);
  out.diffAddedWord = contrastFloor(mix(success, bg, 0.5), bg);
  out.diffRemovedWord = contrastFloor(mix(error, bg, 0.5), bg);

  // Message backgrounds
  out.userMessageBackground = bg;
  out.userMessageBackgroundHover = shimmer(bg, base);
  out.bashMessageBackgroundColor = bg;
  out.memoryBackgroundColor = bg;

  // Usage meter
  out.rate_limit_fill = brand;
  out.rate_limit_empty = mix(text, bg, 0.25);

  // Speaker labels
  out.briefLabelYou = userText;
  out.briefLabelClaude = contrastFloor(text, bg, 3);

  // Subagents — fixed distinct hues.
  for (const [token, hue] of Object.entries(SUBAGENT_HUES)) {
    out[token] = hslToHex(hue, sat, genL);
  }

  // Rainbow — fixed full spectrum + luminance-aware shimmer.
  for (const [token, hue] of Object.entries(RAINBOW_HUES)) {
    const c = hslToHex(hue, sat, genL);
    out[token] = c;
    out[`${token}_shimmer`] = shimmer(c, base);
  }

  return out;
}

module.exports = {
  parseHex,
  toHex,
  mix,
  lighten,
  darken,
  relLuminance,
  contrastRatio,
  contrastFloor,
  hslToHex,
  saturationOf,
  shimmer,
  deriveTokens,
  RAINBOW_HUES,
  SUBAGENT_HUES,
};
