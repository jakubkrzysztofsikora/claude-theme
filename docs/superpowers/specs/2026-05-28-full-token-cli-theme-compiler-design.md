# Design: Full-Token CLI Theme Compiler

- **Date:** 2026-05-28
- **Branch:** research/styling-beyond-builtin
- **Related research:** `thoughts/shared/research/2026-05-28-additional-styling-beyond-builtin-claude.md`
- **Status:** awaiting review

## Problem

The white-label theme system compiles a theme JSON into two channels: a Claude Code CLI custom theme (`~/.claude/themes/<id>.json`) and a Chrome extension. The CLI channel (`buildClaudeCodeTheme()` in `.claude/skills/whitelabel-theme/build-theme.js:164-208`) emits only **14** override tokens. Claude Code v2.1.118+ officially documents **~35** overridable tokens. As a result, applying a vivid theme (e.g. "Neon District") changes only a handful of terminal elements — diffs, selection, status/mode chrome all stay default — which reads as "the theme didn't apply."

## Goal

Make a compiled CLI theme emit the **full documented Claude Code token set** with **hybrid sourcing** (auto-derive from the palette + optional explicit override), plus **explicit `base` selection** and **ANSI color-value support**.

## Non-Goals

- Browser-side equivalents for the newly added terminal tokens.
- Fixing upstream `dark-ansi` readability bugs (we only enable the option).
- Customizing syntax-token colors (not supported by Claude Code anywhere).
- Changing terminal background/fonts (owned by the terminal emulator).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| How many tokens to emit? | Full documented set (~35) |
| Where do new token colors come from? | Hybrid: derive from palette + optional explicit override |
| Base selection & ANSI values? | Add explicit `base` field AND support `ansi:`/`ansi256()` color values |

## Design

### 1. Schema changes — `themes/schema.json`

- **`terminal.base`** (optional): `enum` of `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`.
- **`terminal.overrides`** (optional): object map of `CC-token-name → colorValue`. Power-user escape hatch covering all ~35 tokens (including subagent/rainbow) without 21 named schema fields. `additionalProperties` constrained to the `colorValue` format; **keys validated in code** against the known token set (JSON Schema cannot easily enum object keys here).
- **`colorValue`** definition (new): matches `#rrggbb` | `#rgb` | `rgb(r,g,b)` | `ansi256(n)` (n = 0–255) | `ansi:<name>` (name from the documented ANSI name set). Used for `terminal.*` fields and `terminal.overrides` values.
- **`terminal.systemColor`** (add): build-theme.js already reads it (line 186) but the schema's `additionalProperties:false` currently rejects it — latent bug. Add the field.
- `tokens.color` **stays hex-only** — the browser CSS channel needs real colors; `ansi:` is meaningless in a browser.

### 2. Compiler changes — `.claude/skills/whitelabel-theme/build-theme.js`

- **Expand `CC_TOKENS`** (line 49) to the full documented set:
  - Brand: `claude`, `claudeShimmer`
  - Text: `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `remember`
  - Status: `success`, `error`, `warning`, `warningShimmer`, `merged`
  - Input/mode: `promptBorder`, `promptBorderShimmer`, `permission`, `permissionShimmer`, `planMode`, `autoAccept`, `bashBorder`, `ide`, `fastMode`, `fastModeShimmer`
  - Diffs: `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`, `diffAddedWord`, `diffRemovedWord`
  - Fullscreen: `userMessageBackground`, `userMessageBackgroundHover`, `messageActionsBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg`
  - Usage meter: `rate_limit_fill`, `rate_limit_empty`
  - Speaker labels: `briefLabelYou`, `briefLabelClaude`
  - Subagents (8): `red_FOR_SUBAGENTS_ONLY` … `cyan_FOR_SUBAGENTS_ONLY`
  - Rainbow: `rainbow_red/orange/yellow/green/blue/indigo/violet` (+ `_shimmer`)
- **Color-math helpers** (beside `lighten()` at line 137): `darken(hex, amt)`, `mix(a, b, t)`, and an HSL hue-wheel generator for `rainbow_*` + the 8 subagent colors. Helpers only operate on hex inputs; if a derivation source is an ANSI value (only possible via override, which bypasses derivation) it is passed through untouched.
- **Rewrite `buildClaudeCodeTheme()`** as three ordered layers:
  1. **Derive** every token from the palette. Indicative mapping:
     - `diffAdded = mix(success, bg, 0.75)`, `diffRemoved = mix(error, bg, 0.75)`
     - `diffAddedDimmed`/`diffRemovedDimmed` = weaker mix; `*Word` = stronger mix
     - `selectionBg = mix(brandPrimary, bg, 0.7)` (never equal to bg)
     - `subtle = mix(textPrimary, bg, 0.5)`, `inactive`/`suggestion` = muted text
     - `merged` = a purple-ish derived accent; `remember` from brandAccent/brandPrimary
     - `*Shimmer` = `lighten(base token)`
     - `rainbow_*` = 7-stop hue wheel anchored on `brandPrimary` hue; subagents = 8 distinct hues
     - `rate_limit_fill = brandPrimary`, `rate_limit_empty = mix(textPrimary, bg, 0.3)`
  2. **Apply friendly `terminal.*` fields** to their specific tokens (existing behavior preserved: `promptColor→claude/promptBorder`, etc.).
  3. **Merge `terminal.overrides`** last (highest priority).
  - `base = theme.terminal?.base ?? pickBase(theme)`.
  - Keep the runtime assertion (lines 199-205) that every emitted key ∈ `CC_TOKENS`.
- **Validation** (`validateTheme`, ~line 393): accept `colorValue` formats where allowed; reject any `terminal.overrides` key not in `CC_TOKENS` with a clear error; reject malformed color values.

### 3. Browser channel — unchanged

`tokens.color` stays hex, so `generateStylesCss` (844-882) and `generateInjectJs` (448-839) are untouched. New `terminal.*` fields are ignored by the browser channel exactly as `terminal` already is.

### 4. Tests — `.claude/skills/whitelabel-theme/__tests__/cli-theming.test.js`

- Palette-only theme derives the full token set (assert representative derived tokens present and valid hex).
- `terminal.overrides` value beats the derived value for the same token.
- `terminal.base` is respected; absent → falls back to `pickBase()`.
- ANSI / `rgb()` values accepted in `terminal.overrides`; malformed values rejected.
- Unknown `terminal.overrides` key rejected by `validateTheme`.
- Existing 14-token expectations updated to the expanded set.

### 5. Docs — `SKILL.md`

Update the token reference and document `terminal.base`, `terminal.overrides`, and accepted color-value formats.

## Data Flow

```
theme.json
  → validateTheme()        (schema + colorValue formats + override-key check)
  → buildClaudeCodeTheme()  (derive all → apply terminal.* → merge overrides → pick base)
  → writeJsonAtomic(~/.claude/themes/<id>.json)  +  settings.theme = "custom:<id>"
```

## Risks / Trade-offs

- **Derived rainbow/subagent colors are aesthetic guesses** anchored on `brandPrimary`. Acceptable because they are overridable, but they are not hand-designed.
- **`dark-ansi` has known upstream readability bugs** (claude-code #40905, #40071). We enable the option but do not work around them.
- **Undocumented tokens** beyond the ~35 (the ~69-token reverse-engineered set) are intentionally excluded — they can change without notice. `terminal.overrides` key validation will reject them; if a user truly wants one, expanding `CC_TOKENS` is the deliberate path.
- **ANSI values only make sense with an `*-ansi` base**; we do not enforce that pairing (a hex theme with an accidental `ansi:` override still validates). Documented, not blocked.

## Open Questions

- None blocking. Derivation constants (mix ratios) will be tuned during implementation against the existing themes.
