# Design: Automatic Warp Terminal Theming

**Date:** 2026-05-29
**Status:** Revised after adversarial review (harness-dev / senior-eng / QA). Pending re-review.
**Component:** `.claude/skills/whitelabel-theme/` (`build-theme.js` + new `warp-channel.js`)

## Problem

Applying a whitelabel theme changes only a handful of Claude Code CLI text colors;
the user observed the **terminal background and most text don't change**. Root cause
(prior debug investigation):

1. **No global-background token.** Claude Code's verified 55-token set has only four
   *block-scoped* background tokens. The whole-window background is painted by the
   terminal emulator, never by a CC theme.
2. **`deriveAll` off by default** → only ~14 of 55 tokens emitted.

The emulator here is **Warp**, which paints its background from its own theme YAML
(`~/.warp/themes/*.yaml`) and selects the active theme in `~/.warp/settings.toml`.

## Goal

Make the build pipeline automatically produce and activate a matching Warp theme for
every theme — on `apply`, with symmetric `reset` cleanup, and for newly `init`-ed
themes — so the terminal background and ANSI palette actually change and **blend with
the CC block backgrounds**.

## Agreed decisions (incl. post-review)

- **Activation:** write the Warp YAML *and* activate it by editing `settings.toml`.
- **Trigger:** always generate the Warp YAML.
- **Reset:** symmetric cleanup (remove YAML, restore prior `settings.toml` value).
- **settings.toml edit:** line-preserving structural edit — locate
  `[appearance.themes].theme`, brace-match its (multi-line inline-table) value, rewrite
  only those lines, byte-preserve everything else.
- **Concurrency (review):** **abort-if-changed.** Hash `settings.toml` at read; re-stat
  immediately before write; if it changed, **abort activation** (YAML still written),
  warn, and tell the user to close Warp and re-run.
- **`deriveAll` (review):** **per-theme**, not blanket. Flip on for branded, dark,
  high-contrast, light, warm-neutral (each verified during implementation); **keep
  `minimalist` OFF** to preserve its monochrome intent; nature/cyberpunk already on.
  **Regenerate golden files** for every changed theme — the golden diff is the review
  artifact.
- **Module boundary (review):** the pure Warp logic + TOML line-editor live in a new
  **`warp-channel.js`** (no I/O), mirroring the existing `cli-derive.js` split;
  `build-theme.js` keeps only the thin I/O wiring.

## Non-goals

- A general TOML parser/serializer. We locate and replace exactly one value.
- Theming emulators other than Warp.
- Changing fonts (a Warp setting, out of scope for every channel).
- Process-sniffing whether Warp is running (dropped as YAGNI per review). We always
  print "reload/restart Warp to see changes."

## Module layout

**`warp-channel.js`** (pure, unit-tested in isolation like `cli-derive.js`):
- `buildWarpTheme(theme, ccTheme) -> string` — YAML emitter.
- `locateThemeValue(text) -> { start, end, valueText } | { kind: 'missing' } | { kind: 'malformed' }`
  — the structural locator (see TOML rules below).
- `replaceThemeValue(text, newValueLine) -> text` and
  `insertThemeKey(text, line) -> text` — line-preserving rewrites.
- `warpActivationLine(theme, yamlPath) -> string` — builds the `theme = { … }` line.

**`build-theme.js`** (I/O + orchestration):
- `writeTextAtomic(path, text)` — temp + `rename`, **mode-preserving** (stat source,
  chmod temp to match). Distinct from the JSON-only `writeJsonAtomic`.
- `writeWarpTheme`, `activateWarpTheme`, `deactivateWarpTheme`.
- Wiring in `cmdApply` / `cmdReset` / `cmdInit`.

## Color mapping (`buildWarpTheme`) — corrected

**All colors are resolved to canonical `#RRGGBB` before any math.** Reuse
`cli-derive.js` `parseHex`/`toHex` (already handle `#rgb`). A helper
`resolveHex(value, fallbackHex)`:
- `#rgb`/`#rrggbb` → normalized 6-digit hex.
- `rgb(r,g,b)` → hex.
- `ansi:<name>` or `ansi256(n)` → **no RGB equivalent** → return `fallbackHex` (always a
  hex from `tokens.color`, which is hex-only). This eliminates the `lighten("ansi:…") =
  #NaN` bug (review B2): `lighten` only ever sees real hex.

**Cross-channel blend is guaranteed by construction (review):** `buildWarpTheme`
receives the already-built `ccTheme` and sets Warp `background =
ccTheme.overrides.userMessageBackground` (falling back to resolved
`tokens.color.background` if absent). So the Warp window bg always equals the CC block
bg — the entire point of the feature — and a test asserts equality for every theme.

**Polarity-aware ANSI anchors (review B3 — light-theme legibility):** ANSI `black`/
`white` are absolute anchors, independent of theme polarity:
- `normal.black` = the **darker** of {`textPrimary`, `surface`, `background`} by
  luminance; `normal.white` = the **lighter** of {`textPrimary`, `surface`}.
- This keeps "black" dark and "white" light on light *and* dark themes (fixes
  `normal.black = surface` rendering near-white on the 4 light themes).

| Warp field | Source (resolved to hex; first defined wins) |
|---|---|
| `name` | `theme.name` (quoted scalar — see escaping) |
| `background` | `ccTheme.overrides.userMessageBackground` → `tokens.color.background` |
| `foreground` | `terminal.assistantColor` → `tokens.color.textPrimary` |
| `accent` | `terminal.promptColor` → `tokens.color.brandPrimary` |
| `details` | by **contrast headroom** vs background via `contrastFloor` (`cli-derive.js:107`), **not** a luminance<0.5 split |
| `normal.black` | darker of {textPrimary, surface, background} |
| `normal.red` | `terminal.errorColor` → `tokens.color.error` |
| `normal.green` | `terminal.successColor` → `tokens.color.success` |
| `normal.yellow` | `tokens.color.warning` |
| `normal.blue` | `terminal.systemColor` → `tokens.color.brandAccent` |
| `normal.magenta` | `tokens.color.textSecondary` → `brandPrimary` |
| `normal.cyan` | `terminal.userColor` → `tokens.color.brandPrimary` |
| `normal.white` | lighter of {textPrimary, surface} |
| `bright.*` | `lighten(normal.*)` (now always valid hex); `bright.white` = `lighten(normal.white)` **clamped**, never a hardcoded `#FFFFFF` |

Every emitted color is asserted to match `/^#[0-9a-f]{6}$/` (test), and
`normal.white`/`bright.white` must clear a minimum contrast vs `background` (test, catches
light-theme inversion).

## `name` escaping (review R1/M4)

`validateTheme` (build-theme.js:487) already bans `<>"'`${};\\*/` in `name`, so quote/
brace/semicolon injection cannot reach the sinks — the escaping is **defense-in-depth,
documented as such**. But `:` and `#` are **not** banned and break a bare YAML scalar
(`name: Solarized: Dark` is invalid YAML). Therefore:
- **YAML sink:** emit `name` as a **double-quoted YAML scalar** with YAML escaping
  (handles `:`, `#`, unicode/emoji which pass validation).
- **TOML sink:** emit as a TOML **basic string** (double-quoted).
- Test with `"Solarized: Dark"` (passes validation) → valid YAML + valid TOML; test a
  unicode/emoji name; test that a validation-forbidden name never reaches
  `buildWarpTheme` (apply exits non-zero first).

## TOML line-editor (`locateThemeValue`) — precise rules (review M4–M7, R5, R6, R14, R15)

- **Section header** match: `/^\[appearance\.themes\]\s*$/` exactly (not `[appearance]`,
  not `[appearance.themes.x]`); body runs to the next `/^\[/` header or EOF.
- **Key** match within body: trimmed line matches `/^theme\s*=/` (so `system_theme`,
  `theme_mode`, dotted `theme.x` do **not** match).
- **Value extent:** start at first non-whitespace after `=`, scanning across newlines.
  - `{` → **character-level** brace-depth scan (brace at any column). Recognize TOML
    strings while scanning: basic `"…"` (with `\"` escape) and literal `'…'` (no
    escapes); a `#` outside a string starts a comment to EOL (its braces ignored).
    **Bail** (`kind:'malformed'`) on `"""`/`'''` multi-line strings or EOF reached with
    depth > 0.
  - quote → to the matching closing quote on the same logical line.
  - bare → to EOL.
- **Rewrite** preserves: the original `theme` line's indentation, the file's line
  terminator (LF/CRLF detected from the file), and the presence/absence of a trailing
  newline. Byte-identical everywhere outside the replaced extent.
- **Missing section/key:** additive, non-lossy insert — append a new
  `[appearance.themes]` + `theme` line at EOF, or insert the `theme` line right after an
  existing header. If a `theme` key already exists under a *different* table
  (`[appearance]`), **bail** rather than create a duplicate key.

## Activation / reset state model (review B1/R2/R3/m1 — the top bug)

Single source of truth for "the user's true original":
`~/.warp/themes/.whitelabel-state.json` = `{ activeId, yamlPath, originalValueText }`,
plus a one-time `~/.warp/settings.toml.whitelabel.bak`.

**`activateWarpTheme(theme, yamlPath, ccTheme)`:**
1. If `settings.toml` absent → create minimal file (`[appearance.themes]` + theme line),
   write state with `originalValueText = null`. Done.
2. Read text; compute hash. Locate current `theme` value.
3. **Idempotency / baseline guard:** capture `originalValueText` **only if state file is
   absent** (first apply). On any subsequent apply (state exists), **carry forward** the
   existing `originalValueText` unchanged — never overwrite it with theme A's value.
   Also: if the current value already equals what we'd write, skip the edit entirely.
4. Write `settings.toml.whitelabel.bak` only if absent (the true pre-automation file).
5. **Concurrency abort:** re-stat/hash `settings.toml`; if changed since step 2 → abort
   activation, leave YAML written, print the half-applied notice (below).
6. `writeTextAtomic` the rewritten file; persist/refresh state (`activeId`, `yamlPath`
   updated; `originalValueText` preserved).

**`deactivateWarpTheme()`** (reset):
1. `SLUG_RE`-assert `activeId` from state (or, if no state, derive id from the CC
   `custom:<id>` slug so an orphaned YAML from a half-applied run is still cleaned).
2. Re-locate the `theme` value **by content** (don't trust stored line indices —
   review R12). **Restore only if** the current value is one we wrote (matches
   `custom_<activeId>` → our `yamlPath`); otherwise the user changed themes in Warp
   since apply (review R3/B3) → leave `settings.toml` untouched, just clean our files.
3. Restore `originalValueText` (or remove the line if the original had no `theme` key).
4. Delete `~/.warp/themes/<activeId>.yaml` (only within `~/.warp/themes/`; `unlink` may
   no-op if already gone). Delete the state file. Leave `.bak` as insurance.

## Wiring

- `cmdApply`: build `ccTheme` (already done) → `writeWarpTheme(theme, ccTheme)` →
  `activateWarpTheme`. Extend success output with a Warp section. **When activation is
  skipped/aborted**, the summary states explicitly *"Warp theme written but NOT
  activated"* and prints the exact `theme = …` line to paste into `settings.toml`
  (review M2 — no false "success").
- `cmdReset`: call `deactivateWarpTheme` alongside the existing CC cleanup.
- `cmdInit`: template gains `"deriveAll": true` + the `terminal` friendly fields.

## Error handling

- Unsafe `theme.id` (`SLUG_RE`) → abort before any path is formed (apply and reset).
- `settings.toml` unreadable → skip activation, warn, leave YAML written, print paste-line.
- Section/key missing → additive insert; duplicate-`theme`-in-other-table → bail.
- Brace scan hits `"""`/`'''` or EOF with depth>0 → bail, leave file untouched.
- Concurrency change detected → abort activation (see state model step 5).
- All TOML writes via `writeTextAtomic` (temp+rename, mode-preserving); `.bak` precedes
  the first edit so recovery is possible and is **tested**.

## Security

- `theme.id` re-asserted against `SLUG_RE` at every path sink (YAML path, reset unlink).
- `theme.name` quoted+escaped for both YAML and TOML sinks; documented as
  defense-in-depth atop the existing name allowlist.
- No new external input, no network, no eval.

## Testing (`node --test`, `__tests__/`) — expanded per review

Use the **real worst-case `settings.toml` shape** as the editor fixture: nested
multi-line inline table with a trailing comma, a sibling `system_theme = false`, and a
`[privacy]`-style single-quoted regex string containing `{ } , "`.

**Lifecycle / state:**
1. `apply A → apply B → reset` restores the **pre-automation original**, not A. *(top bug)*
2. `apply A → apply A` leaves the restorable original unchanged (idempotent).
3. `apply → reset → reset` (double reset) is a clean no-op the second time.
4. `reset` with no prior apply / no state file → exit 0, touches nothing.
5. `apply`, delete the YAML, `reset` → no throw, `settings.toml` still restored.
6. `apply`, delete state file, `reset` → defined behavior (clean orphaned YAML via CC slug).
7. `apply`, insert lines above the section, `reset` restores correct lines (re-locate by content).
8. Fresh machine: no `~/.warp/` → apply exits 0, creates dir + minimal `settings.toml`.
9. `~/.warp/` exists, no `settings.toml` → minimal file created.

**TOML editor (pure):**
10. Replace nested multi-line inline table + trailing comma, byte-preserving all else (incl. `system_theme`).
11. `[privacy]` single-quoted braces before the section are ignored.
12. `system_theme`/`theme_mode` siblings not matched.
13. `theme` under `[appearance]` (not `.themes`) → bail, no duplicate key.
14. CRLF round-trips as CRLF; no-trailing-newline preserved.
15. `theme=`, `theme  =`, tab-indented all located; indentation preserved.
16. Comment containing `}` ignored by the matcher.
17. Malformed/never-closing brace → bail, file byte-identical.
18. Round-trip: original → activate → deactivate → **byte-identical** to original.
19. Crash-injection between temp-write and rename → original intact, no partial.

**`buildWarpTheme` (pure):**
20. `details` correct for a dark and a light fixture (via contrast headroom).
21. `bright.* === lighten(normal.*)`, all valid hex; `bright.white` valid + visible on light bg.
22. **For every bundled theme:** `warp.background === ccTheme.overrides.userMessageBackground`.
23. For every bundled theme: all 16 ANSI colors valid hex; `normal.white`/`bright.white`
    clear a min contrast vs background (catch light-theme inversion).
24. A `terminal.*` color in `ansi:`/`rgb()`/`#rgb` form never yields `#NaN` (resolves or falls back).
25. Name `"Solarized: Dark"` → valid YAML + TOML; unicode/emoji name UTF-8-valid.
26. A validation-forbidden name causes apply to exit non-zero before `buildWarpTheme`.

**deriveAll rollout:**
27. Every bundled theme still passes `validateTheme` after its `deriveAll` setting.
28. Golden files regenerated for the 5 flipped themes and asserted; `minimalist`'s
    golden unchanged (stays 14 keys).

## Documentation

Add a "Warp terminal channel" subsection to SKILL.md: automatic YAML generation,
line-preserving activation, abort-if-changed concurrency, reset cleanup, the
`.whitelabel-state.json` / `.bak` artifacts, and the per-theme `deriveAll` rollout note.

## Open / verify-during-implementation

- Confirm Warp honors `theme = { custom_<slug> = { name, path } }` on live reload; if
  not, switch the writer to bare-string `theme = "<name>"` (the locator/restorer already
  handle the string-value extent). Gated by manual verification on the first apply.
- Verify `high-contrast` retains adequate contrast under `deriveAll` (deriveTokens has
  contrast floors); if it degrades, keep its `deriveAll` off like `minimalist`.
