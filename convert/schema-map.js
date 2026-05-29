"use strict";

// =============================================================================
// convert/schema-map.js — deterministic, ZERO-DEPENDENCY theme-schema mapper.
//
// Given our theme's resolved colors (keyed by semantic role) and a TARGET client
// key-set from registry.json, map our keys -> the client's keys via deterministic
// string/structural similarity (normalized token overlap + char-trigram cosine over
// the PRE-VECTORIZED keys) and emit the target client's theme file, with a per-mapping
// confidence score.
//
// NO LLM. NO network. NO runtime dependency. The vectorizer here is the SAME code
// build-vectors.js runs offline to produce reference-vectors.json — keeping the math
// in one place is what makes the pre-generated vectors reproducible.
//
// This module is a SCAFFOLD: it is intentionally NOT in package.json's `files`
// allowlist and never required by the published CLI core. The model-augmented path
// (typed unknown client -> comb the web for its schema -> live-vectorize -> compare)
// is documented in convert/README.md and layered ON TOP of this deterministic core.
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Tokenization (deterministic)
// ---------------------------------------------------------------------------

/**
 * Split a schema key into lowercase word tokens. Handles camelCase, snake_case,
 * kebab-case, dotted paths ("primary.background"), spaces ("Ansi 0 Color") and
 * digits ("color10" -> ["color","10"]). Pure; identical input => identical output.
 */
function tokenize(key) {
  return (
    String(key)
      // camelCase / PascalCase boundaries
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // letter<->digit boundaries (color10 -> color 10)
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([A-Za-z])/g, "$1 $2")
      // structural separators
      .split(/[\s._\-/]+/)
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean)
  );
}

/**
 * Character trigrams of the joined, lowercased token string. Padded with a
 * sentinel so short keys still produce a couple of grams. Deterministic.
 */
function charNgrams(tokens, n = 3) {
  const s = "^" + tokens.join("") + "$";
  if (s.length < n) return [s];
  const grams = [];
  for (let i = 0; i + n <= s.length; i++) grams.push(s.slice(i, i + n));
  return grams;
}

/**
 * Build the sparse term-frequency vector for one schema entry. The "document" is
 * the key's own tokens PLUS its curated aliases (registry-supplied) PLUS its role,
 * which is what bridges naming gaps (CC `claude` ~ client `accent`). Char trigrams
 * are namespaced ("#abc") so they never collide with word tokens.
 *
 * @param {string} key      the schema key (e.g. "normal.red", "color1")
 * @param {object} [entry]  { role, aliases } from the registry (both optional)
 * @returns {Record<string, number>} term -> count
 */
function vectorize(key, entry = {}) {
  const words = tokenize(key);
  const aliasWords = []
    .concat(entry.role ? [entry.role] : [])
    .concat(Array.isArray(entry.aliases) ? entry.aliases : [])
    .flatMap((a) => tokenize(a));
  const allWords = words.concat(aliasWords);

  const vec = Object.create(null);
  for (const w of allWords) vec[w] = (vec[w] || 0) + 1;
  // char trigrams from the KEY tokens only (structural shape of the key itself)
  for (const g of charNgrams(words)) {
    const t = "#" + g;
    vec[t] = (vec[t] || 0) + 1;
  }
  return vec;
}

// ---------------------------------------------------------------------------
// 2. Cosine similarity over sparse vectors (tiny, hand-rolled)
// ---------------------------------------------------------------------------

function dot(a, b) {
  let sum = 0;
  // iterate the smaller vector for speed
  const [small, large] =
    Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  for (const k of Object.keys(small)) {
    if (k in large) sum += small[k] * large[k];
  }
  return sum;
}

function norm(a) {
  let s = 0;
  for (const k of Object.keys(a)) s += a[k] * a[k];
  return Math.sqrt(s);
}

/** Cosine similarity in [0,1]. 0 when either vector is empty. */
function cosine(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// ---------------------------------------------------------------------------
// 3. Reference vectors (lazy-built; reproducible from the registry)
// ---------------------------------------------------------------------------

/**
 * Build the vector table for every key of a registry source/client entry.
 * @param {{keys: Record<string, {role?:string,aliases?:string[]}>}} entry
 * @returns {Record<string, Record<string, number>>} key -> vector
 */
function vectorizeKeySet(entry) {
  const out = Object.create(null);
  const keys = (entry && entry.keys) || {};
  for (const key of Object.keys(keys)) out[key] = vectorize(key, keys[key]);
  return out;
}

// ---------------------------------------------------------------------------
// 4. Mapping: our resolved colors -> a target client's keys
// ---------------------------------------------------------------------------

/**
 * Map a set of SOURCE color entries to a TARGET client's keys.
 *
 * For each target key we pick the best-matching source entry by cosine similarity
 * of their vectors (registry-curated role+aliases make this a semantic match, not a
 * fragile literal string match). A target key with no source above `minConfidence`
 * is left unmapped (caller decides whether to fall back / omit).
 *
 * @param {Record<string,{value:string, vector?:object, entry?:object}>} source
 *        sourceKey -> { value: "#rrggbb", entry?: registry entry }
 * @param {{keys: object}} clientEntry  the target client registry entry
 * @param {object} [opts]
 * @param {number} [opts.minConfidence=0.15]
 * @returns {Array<{clientKey:string, role:string, sourceKey:string|null,
 *                  value:string|null, confidence:number}>}
 */
function mapKeys(source, clientEntry, opts = {}) {
  const minConfidence = opts.minConfidence ?? 0.15;
  const srcKeys = Object.keys(source);
  // Pre-vectorize source entries once.
  const srcVecs = srcKeys.map((k) => ({
    key: k,
    value: source[k].value,
    vec: source[k].vector || vectorize(k, source[k].entry || {}),
  }));

  const clientKeys = (clientEntry && clientEntry.keys) || {};
  const result = [];
  for (const clientKey of Object.keys(clientKeys)) {
    const cEntry = clientKeys[clientKey];
    const cVec = vectorize(clientKey, cEntry);
    let best = { key: null, value: null, conf: 0 };
    for (const s of srcVecs) {
      const conf = cosine(cVec, s.vec);
      if (conf > best.conf) best = { key: s.key, value: s.value, conf };
    }
    const matched = best.conf >= minConfidence;
    result.push({
      clientKey,
      role: (cEntry && cEntry.role) || null,
      sourceKey: matched ? best.key : null,
      value: matched ? best.value : null,
      confidence: Number(best.conf.toFixed(4)),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 5. Emitters — render the mapping as the target client's theme file
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize a #rgb/#rrggbb to lowercase #rrggbb. Returns null if not a hex. */
function normHex(v) {
  if (typeof v !== "string" || !HEX_RE.test(v.trim())) return null;
  let h = v.trim().toLowerCase().slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return "#" + h;
}

function hexToRgb01(hex) {
  const h = normHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** Group a flat dotted-key mapping into a nested {section:{leaf:value}} object. */
function nestByDot(mappings) {
  const tree = Object.create(null);
  for (const m of mappings) {
    if (!m.value) continue;
    const parts = m.clientKey.split(".");
    if (parts.length === 2) {
      (tree[parts[0]] || (tree[parts[0]] = Object.create(null)))[parts[1]] =
        m.value;
    } else {
      tree[m.clientKey] = m.value;
    }
  }
  return tree;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render the mapping for a known client into that client's theme-file text.
 * @param {string} format    registry client.format
 * @param {Array} mappings   output of mapKeys()
 * @param {string} themeName
 * @returns {string}
 */
function emit(format, mappings, themeName) {
  switch (format) {
    case "toml": {
      const tree = nestByDot(mappings);
      const lines = [`# ${themeName} — generated by claude-theme convert`];
      for (const section of Object.keys(tree)) {
        const leaves = tree[section];
        if (leaves && typeof leaves === "object") {
          // nested section, e.g. [colors.primary] with leaf keys
          lines.push(`[colors.${section}]`);
          for (const leaf of Object.keys(leaves)) {
            const hx = normHex(leaves[leaf]);
            if (hx) lines.push(`${leaf} = "${hx}"`);
          }
        } else {
          // flat top-level scalar key (no dot in the client key)
          const hx = normHex(leaves);
          if (hx) lines.push(`${section} = "${hx}"`);
        }
      }
      return lines.join("\n") + "\n";
    }
    case "kitty-conf": {
      const lines = [`# ${themeName} — generated by claude-theme convert`];
      for (const m of mappings) {
        const hx = normHex(m.value);
        if (hx) lines.push(`${m.clientKey} ${hx}`);
      }
      return lines.join("\n") + "\n";
    }
    case "json": {
      const obj = { name: themeName };
      for (const m of mappings) {
        const hx = normHex(m.value);
        if (hx) obj[m.clientKey] = hx;
      }
      return JSON.stringify(obj, null, 2) + "\n";
    }
    case "iterm-plist": {
      const out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        `\t<!-- ${xmlEscape(themeName)} — generated by claude-theme convert -->`,
      ];
      for (const m of mappings) {
        const hx = normHex(m.value);
        if (!hx) continue;
        const { r, g, b } = hexToRgb01(hx);
        out.push(`\t<key>${xmlEscape(m.clientKey)}</key>`);
        out.push("\t<dict>");
        out.push("\t\t<key>Color Space</key>");
        out.push("\t\t<string>sRGB</string>");
        out.push(`\t\t<key>Red Component</key>`);
        out.push(`\t\t<real>${r.toFixed(6)}</real>`);
        out.push(`\t\t<key>Green Component</key>`);
        out.push(`\t\t<real>${g.toFixed(6)}</real>`);
        out.push(`\t\t<key>Blue Component</key>`);
        out.push(`\t\t<real>${b.toFixed(6)}</real>`);
        out.push("\t</dict>");
      }
      out.push("</dict>", "</plist>", "");
      return out.join("\n");
    }
    default:
      throw new Error(`schema-map: unknown client format "${format}"`);
  }
}

// ---------------------------------------------------------------------------
// 6. Convenience: build source entries from a Claude Code theme + palette
// ---------------------------------------------------------------------------

/**
 * Build the `source` map mapKeys() expects from a registry SOURCE entry (e.g.
 * "claude-code" or "warp") and a flat { key -> hex } color object. Keys present in
 * the registry source carry their role+aliases; extra colors are passed verbatim.
 *
 * @param {{keys: object}} sourceEntry  registry.sources[...]
 * @param {Record<string,string>} colors  key -> hex
 */
function buildSource(sourceEntry, colors) {
  const keys = (sourceEntry && sourceEntry.keys) || {};
  const source = Object.create(null);
  for (const k of Object.keys(colors)) {
    const hx = normHex(colors[k]);
    if (!hx) continue;
    source[k] = { value: hx, entry: keys[k] || {} };
  }
  return source;
}

/**
 * Top-level deterministic conversion: source colors -> client theme text + report.
 *
 * @param {object} args
 * @param {{keys:object}} args.sourceEntry  registry source (claude-code / warp)
 * @param {Record<string,string>} args.colors  source key -> hex
 * @param {{format:string, keys:object}} args.clientEntry  registry client
 * @param {string} args.themeName
 * @param {number} [args.minConfidence]
 * @returns {{text:string, mappings:Array, format:string}}
 */
function convert({
  sourceEntry,
  colors,
  clientEntry,
  themeName,
  minConfidence,
}) {
  const source = buildSource(sourceEntry, colors);
  const mappings = mapKeys(source, clientEntry, { minConfidence });
  const text = emit(clientEntry.format, mappings, themeName);
  return { text, mappings, format: clientEntry.format };
}

module.exports = {
  tokenize,
  charNgrams,
  vectorize,
  vectorizeKeySet,
  cosine,
  mapKeys,
  buildSource,
  emit,
  convert,
  normHex,
};
