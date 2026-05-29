# Implementation Plan: Full-Token CLI Theme Compiler

- **Date:** 2026-05-29
- **Branch:** feat/full-token-cli-theme (created from research/styling-beyond-builtin)
- **Design:** `docs/superpowers/specs/2026-05-28-full-token-cli-theme-compiler-design.md` (v2)
- **Target binary:** claude 2.1.154

## Decisions locked
- Full **binary-verified** token set, derivation gated behind opt-in `terminal.deriveAll`.
- Raw `terminal.overrides` map is the primary escape hatch (internal names accepted by user choice).
- Schema file is documentation only — **all validation is code-side** in `validateTheme()`.
- Security mitigations are mandatory regardless of API shape.
- `tokens.color` stays hex-only; new `colorValue` formats never reach the browser CSS channel.

## Authoritative token set (verified by quoted-string count in 2.1.154)
Included (count > 0, unambiguous):
`claude, claudeShimmer, text, inverseText, inactive, subtle, suggestion, remember, promptBorder, permission, planMode, autoAccept, bashBorder, ide, fastMode, success, error, warning, merged, diffAdded, diffRemoved, diffAddedDimmed, diffRemovedDimmed, diffAddedWord, diffRemovedWord, userMessageBackground, userMessageBackgroundHover, bashMessageBackgroundColor, memoryBackgroundColor, rate_limit_fill, rate_limit_empty, briefLabelYou, briefLabelClaude, red_FOR_SUBAGENTS_ONLY, blue_FOR_SUBAGENTS_ONLY, green_FOR_SUBAGENTS_ONLY, yellow_FOR_SUBAGENTS_ONLY, purple_FOR_SUBAGENTS_ONLY, orange_FOR_SUBAGENTS_ONLY, pink_FOR_SUBAGENTS_ONLY, cyan_FOR_SUBAGENTS_ONLY, rainbow_red, rainbow_orange, rainbow_yellow, rainbow_green, rainbow_blue, rainbow_indigo, rainbow_violet, rainbow_red_shimmer, rainbow_orange_shimmer, rainbow_yellow_shimmer, rainbow_green_shimmer, rainbow_blue_shimmer, rainbow_indigo_shimmer, rainbow_violet_shimmer`

**EXCLUDED — verified non-existent (0 quoted occurrences):** `messageActionsBackground`, `selectionBg`, `promptBorderShimmer`, `permissionShimmer`, `warningShimmer`, `fastModeShimmer`, `inactiveShimmer`, `background` (ambiguous common word — excluded).

The 14 currently-emitted tokens remain a subset; default output must not change.

---

## Phase 1 — Foundation: verified token set + shared constants

**Files:** `.claude/skills/whitelabel-theme/build-theme.js`, new `scripts/extract-cc-tokens.js`

1. Add `scripts/extract-cc-tokens.js`: a dev tool that takes a path to a claude binary, runs `strings`, and reports quoted-occurrence counts for a candidate token list, flagging 0-count tokens. Reproducible re-verification on version bumps. No prod dependency.
2. Expand `CC_TOKENS` (build-theme.js:49) to the authoritative set above. Update the comment to cite **2.1.154** and the extract script.
3. Export `ANSI_NAMES` (Set of the documented ANSI color names: `black, red, green, yellow, blue, magenta, cyan, white` and their `*Bright` variants — verify names against docs) and ensure `VALID_BASES` is exported.
4. Consolidate the duplicated id regex: keep `SLUG_RE` (line 44) as the single source; replace the inline regex at the `id` validation site (~line 270) with `SLUG_RE`.

**Automated verification:** `npm test` still green (no behavior change yet; goldens unchanged); `node scripts/extract-cc-tokens.js <binary>` runs and reports counts.
**Success criteria:** `CC_TOKENS` contains exactly the authoritative set; no excluded token present; existing goldens untouched.

---

## Phase 2 — Derivation module

**Files:** new `.claude/skills/whitelabel-theme/cli-derive.js`, new `__tests__/cli-derive.test.js`

1. `cli-derive.js` (pure, no fs): color helpers `parseHex`, `toHex`, `mix(a,b,t)`, `darken(hex,amt)`, `relLuminance(hex)`, `rgbToHsl`/`hslToRgb`. All use `Math.round`+clamp 0–255; achromatic (S=0) handled explicitly.
2. `deriveTokens(palette, { base })` → returns a `{ token: hexValue }` map covering the full set, derived from the 5 required palette colors + optional extras:
   - `diffAdded = contrastFloor(mix(success, bg, 0.72), bg)`, `diffRemoved` from error; `*Dimmed` weaker; `*Word` stronger.
   - rainbow_* = **fixed full-spectrum canonical hues** (red→violet), saturation/lightness nudged toward palette; never collapse hue range.
   - 8 subagent colors = 8 fixed distinct hues.
   - `*Shimmer` (claudeShimmer, rainbow_*_shimmer) = lighten on dark base, **darken on light base** (luminance-aware).
   - `subtle/inactive/suggestion = mix(text,bg,…)` with contrast floor; `merged`, `remember`, `inverseText`, mode colors derived sensibly.
   - `contrastFloor(c, bg)` guarantees derived ≠ near-bg (min WCAG-ish contrast).
3. Determinism: `deriveTokens` is pure and idempotent.

**Automated verification:** `node --test __tests__/cli-derive.test.js` green.
**Success criteria:** hand-oracle unit tests for `mix`/`darken`/luminance; light-theme diff has contrast floor; achromatic brand yields a real spectrum; `deriveTokens(x)` twice equal.

---

## Phase 3 — Validation, security hardening, compiler rewrite

**Files:** `themes/schema.json`, `.claude/skills/whitelabel-theme/build-theme.js`

### 3a. Schema (documentation; mirror in code)
- Add `colorValue` definition: `#rrggbb | #rgb | rgb(r,g,b) | ansi256(n) | ansi:<name>`.
- `terminal`: add `base` (enum = VALID_BASES), `systemColor` (colorValue), `deriveAll` (boolean), `overrides` (object; `additionalProperties: { $ref: colorValue }`).
- Keep `tokens.color` hex-only.

### 3b. `validateTheme` — code is the runtime gate
- Make the `theme.terminal` branch **shape-aware**: allowlist direct keys (`userColor, assistantColor, backgroundColor, promptColor, errorColor, successColor, systemColor, base, deriveAll, overrides`); reject unknown direct keys.
- `colorValue` validation: fully **anchored** regex per form; `rgb()`/`ansi256(n)` parsed and **range-checked 0–255**; `ansi:<name>` checked against `ANSI_NAMES`; reject any value containing `; { } ( )` outside allowed forms, newlines, `url`, `expression`, `/*`. Type-assert string before `.test()`.
- `terminal.base`: must be in `VALID_BASES`.
- `terminal.overrides`: assert plain object; **reject keys `__proto__`, `constructor`, `prototype`**; allowlist remaining keys against `CC_TOKENS`; each value a valid `colorValue`.
- **Size caps:** `tokens.color` keys ≤ 200; `terminal.overrides` keys ≤ 200; cap raw file size in `readJson` (e.g. ≤ 512 KB) before `JSON.parse`.
- `theme.id`: assert `typeof === "string"` and `SLUG_RE`.

### 3c. `buildClaudeCodeTheme` rewrite (3 layers)
- Build `overrides` with `Object.create(null)`.
- Layer 1 (only if `terminal.deriveAll === true`): merge `deriveTokens(palette,{base})`.
- Layer 2: existing friendly `terminal.*`/`tokens.color` → specific tokens (current 14-token behavior preserved exactly when `deriveAll` is absent).
- Layer 3: merge `terminal.overrides` (guarded keys) last — highest priority.
- `base = terminal.base ∈ VALID_BASES ? terminal.base : pickBase(theme)`.
- Keep the runtime assertion that every emitted key ∈ `CC_TOKENS`.

### 3d. Write-path defense-in-depth
- In `cmdApply`, immediately before `path.join(CLAUDE_THEMES_DIR, ...)`: re-assert `typeof theme.id === "string" && SLUG_RE.test(theme.id)`, else throw.

**Automated verification:** `npm test` green; default-path goldens for all 8 themes **byte-identical**.
**Success criteria:** all security rejects fire (see Phase 4 tests); deriveAll opt-in changes output only when set.

---

## Phase 4 — Tests + docs

**Files:** `__tests__/cli-theming.test.js`, `.claude/skills/whitelabel-theme/SKILL.md`

1. Tests:
   - All 8 existing goldens unchanged (regression guard).
   - `deriveAll:true` fixture emits full set; representative derived tokens valid hex.
   - `terminal.overrides` value beats derived + beats friendly field (layer order).
   - `terminal.base` respected; absent → `pickBase` fallback.
   - Security rejects: `__proto__`/`constructor` override key; unknown override key; `ansi256(256)`, `ansi256(-1)`, `rgb(300,0,0)`, `ansi:bogus`, value with `};url()`; non-string id, `../` id, absolute id; oversized overrides map; oversized file.
   - `systemColor` accepted (latent-bug regression).
   - `ansi:` value without `*-ansi` base → WARN (assert warning emitted, not error).
   - Idempotency of derivation via the compiler.
2. Docs: update `SKILL.md` token reference; document `terminal.base`, `terminal.deriveAll`, `terminal.overrides`, accepted `colorValue` formats, and that the browser channel ignores `terminal`.

**Automated verification:** `npm test` fully green.
**Success criteria:** new cases pass; goldens unchanged; coverage of every security mitigation.

---

## Per-phase validation protocol (user-requested)
After each phase, dispatch the **same three adversarial subagents** against that phase's diff + this plan:
1. Reddit Claude Code power-user (UX/real-world papercuts)
2. Open-source engineer (API/maintainability/back-compat/tests)
3. cyberlegion security reviewer (injection, proto-pollution, traversal, DoS)

Iterate on findings until all three green-light the phase. **Only return to the human after all phases are implemented, validated, and green-lit.**

## Runtime verification (end)
`node build-theme.js apply themes/cyberpunk/theme.json` (+ a deriveAll fixture) → inspect emitted `~/.claude/themes/<id>.json`; exercise security reject paths via the validate command. Restore prior `~/.claude` theme state afterward.
