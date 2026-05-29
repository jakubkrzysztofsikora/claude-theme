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
  chmod temp to match). The temp file is created **in the same directory** as the target
  (like `writeJsonAtomic`) so `rename` stays intra-filesystem. Distinct from the
  JSON-only `writeJsonAtomic` (which `JSON.stringify`s and does not preserve mode).
- `writeWarpTheme`, `activateWarpTheme`, `deactivateWarpTheme`.
- Wiring in `cmdApply` / `cmdReset` / `cmdInit`.

## Color mapping (`buildWarpTheme`) — corrected

**All colors are resolved to canonical `#RRGGBB` before any math.** `cli-derive.js`
`parseHex` is **hex-only** (it *throws* on `rgb()`/`ansi:` — verified against its tests),
so `resolveHex(value, fallbackHex)` does the conversion itself and only delegates
`#rgb`/`#rrggbb` normalization to `parseHex`/`toHex`:
- `#rgb`/`#rrggbb` → normalized 6-digit hex (via `parseHex`/`toHex`).
- `rgb(r,g,b)` → hex (resolveHex converts; **not** passed to `parseHex`).
- `ansi:<name>` / `ansi256(n)` → **no RGB equivalent** → return `fallbackHex`.
- value absent → `fallbackHex` (may itself be `undefined` — see "unresolved slots").

This eliminates the `lighten("ansi:…") = #NaN` bug (review B2): `lighten` only ever
sees real hex. **Fallbacks must also be resolved** — `tokens.color` is hex-only, but
`ccTheme.overrides.userMessageBackground` can be a `terminal.backgroundColor` in
`rgb()`/`ansi:` form, so `background` runs through `resolveHex` too.

**Cross-channel blend is guaranteed by construction (review):** `buildWarpTheme`
receives the already-built `ccTheme` and sets Warp `background =
resolveHex(ccTheme.overrides.userMessageBackground, resolveHex(tokens.color.background))`.
`cmdApply` already builds `ccTheme` (build-theme.js:1492) *before* any I/O, so threading
it in is pure and ordering-safe. A test asserts `warp.background ===
ccTheme.overrides.userMessageBackground` (after resolution) for every bundled theme.

**`details` is a Warp keyword, not a color** (review N2): it is `darker` or `lighter`,
selected by background polarity — `darker` if `luminance(background) < 0.5`, else
`lighter`. Luminance = sRGB relative luminance `0.2126·R + 0.7152·G + 0.0722·B` on
0–1-normalized linearized channels; the exact formula is pinned so the deterministic
test has a single oracle. (`contrastFloor` is **not** used here — it adjusts a color, it
does not pick a keyword.)

**Polarity-pole ANSI anchors (review B3 / plan round-3 C1):** ANSI `black`/`white` are
absolute anchors that must stay dark/light on *every* theme. **`contrastFloor` is the
WRONG primitive here** — it pushes toward whichever extreme has more headroom vs `bg`, so
on a dark bg it drags "black" toward white (traced: cyberpunk `#0A0612 → #6c6a71`).
Instead use luminance poles:
- `black` = darkest of {textPrimary, surface, background}; if `relLuminance(black) > 0.15`,
  `mix(black, "#000000", 0.6)` to force it genuinely dark.
- `white` = lightest of {textPrimary, surface, background}; if `relLuminance(white) < 0.85`,
  `mix(white, "#ffffff", 0.6)` to force it genuinely light (fixes "lighter-of-two-darks").
- The 0.15/0.85 guards are a single best-effort nudge; the **only hard contract** is the
  polarity gate the test asserts. **No contrast-vs-bg floor is applied** — on a near-black
  bg ANSI "black" legitimately can't clear 3:1 (it reads against light text, not bg).

**`lighten` for bright variants is pinned (review N3):** use `cli-derive.lighten` (which
validates hex and requires an explicit amount) with **amount `0.25`** — the
`build-theme.lighten` default `0.06` is visually indistinguishable and would make the
bright row a no-op. `bright.white = lighten(normal.white, 0.25)` clamped at `#FFFFFF`.

**Unresolved slots are omitted (review harness-#1):** the status rows
(`red`/`green`/`yellow`) source from `terminal.*` → `tokens.color.{error,success,warning}`,
which are required **only when `deriveAll` is true**. If a `deriveAll:false` user theme
defines neither side, that slot resolves to `undefined` → **omit the key** so Warp uses
its own preset default (never emit `#NaN`/`#undefined`). All 8 bundled themes define
these, so their goldens carry full palettes.

| Warp field | Source (resolved via `resolveHex`; first defined wins; omit if unresolved) |
|---|---|
| `name` | `theme.name` (quoted scalar — see escaping) |
| `background` | `ccTheme.overrides.userMessageBackground` → `tokens.color.background` |
| `foreground` | `terminal.assistantColor` → `tokens.color.textPrimary` |
| `accent` | `terminal.promptColor` → `tokens.color.brandPrimary` |
| `details` | keyword by background luminance (pinned formula above) |
| `normal.black` | darkest-of{textPrimary,surface,background}, forced to a dark pole (`mix → #000000` if lum>0.15) |
| `normal.red` | `terminal.errorColor` → `tokens.color.error` *(omit if absent)* |
| `normal.green` | `terminal.successColor` → `tokens.color.success` *(omit if absent)* |
| `normal.yellow` | `tokens.color.warning` *(omit if absent)* |
| `normal.blue` | `terminal.systemColor` → `tokens.color.brandAccent` |
| `normal.magenta` | `tokens.color.textSecondary` → `brandPrimary` |
| `normal.cyan` | `terminal.userColor` → `tokens.color.brandPrimary` |
| `normal.white` | lightest-of{textPrimary,surface,background}, forced to a light pole (`mix → #ffffff` if lum<0.85) |
| `bright.*` | `lighten(normal.*, 0.25)`; `bright.white` clamped at `#FFFFFF` |

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
`~/.warp/themes/.whitelabel-state.json` =
`{ activeId, yamlPath, originalValueText, sectionInserted }`, plus a one-time
`~/.warp/settings.toml.whitelabel.bak`. `sectionInserted` records whether *we* created the
`[appearance.themes]` header, so reset only removes the header when it was ours and the
section body is otherwise empty (protects a pre-existing `system_theme` sibling).

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
   activation, leave YAML written, print the half-applied notice (below). **Residual
   window (review B2):** a TOCTOU gap remains between this re-stat and the `rename` in
   step 6 — `writeTextAtomic` guarantees the file is never *torn*, but a Warp write
   landing in that narrow window is still lost (last-rename-wins). This is inherent to
   clobbering a live-owned file without OS locks; documented and accepted, narrowed (not
   eliminated) by the re-stat. The user-facing guidance is "apply with Warp closed."
6. `writeTextAtomic` the rewritten file; persist/refresh state (`activeId`, `yamlPath`
   updated; `originalValueText` preserved).

**`deactivateWarpTheme(slugHint)`** (reset) — receives the CC slug from `cmdReset`
*before* CC cleanup deletes it (see Wiring/N1):
1. `SLUG_RE`-assert `activeId` from state; if no state, fall back to `slugHint` (the CC
   `custom:<id>` slug captured by `cmdReset`) so an orphaned YAML from a half-applied
   run is still cleaned. If neither yields a safe slug → no-op.
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
- `cmdReset` (review N1 — ordering is load-bearing): `cmdReset` currently early-returns
  when `settings.json` is absent or `theme` is not a `custom:` value (build-theme.js:1587,
  1602), and later does `delete settings.theme`. **`deactivateWarpTheme(slugHint)` must
  run unconditionally and FIRST** — before those early returns and before
  `delete settings.theme` — capturing the `custom:<id>` slug while it still exists.
  Otherwise a user who already cleared the CC theme via `/theme` can never clean up the
  Warp YAML / restore `settings.toml` (the exact orphan the state model targets). This
  reconciles test 4 (no prior apply → no-op) with test 6 (orphan cleanup via slug): the
  call always runs, but no-ops cleanly when there is nothing of ours to undo.
- `cmdInit`: template gains `"deriveAll": true` + the `terminal` friendly fields.

## Error handling

- Unsafe `theme.id` (`SLUG_RE`) → abort before any path is formed (apply and reset).
- `settings.toml` unreadable → skip activation, warn, leave YAML written, print paste-line.
- Section/key missing → additive insert; duplicate-`theme`-in-other-table → bail.
- Brace scan hits `"""`/`'''` or EOF with depth>0 → bail, leave file untouched.
- Concurrency change detected → abort activation (see state model step 5).
- All TOML writes via `writeTextAtomic` (temp+rename, mode-preserving); `.bak` precedes
  the first edit. **The `.bak` is manual-recovery insurance only** — reset restores from
  `originalValueText` in state, not from `.bak`. Its sole automated guarantee (test 19a)
  is that it is byte-identical to the pre-automation file; restoring *from* it is a
  documented manual step, not a code path.

## Security

- `theme.id` re-asserted against `SLUG_RE` at every path sink (YAML path, reset unlink).
- `theme.name` quoted+escaped for both YAML and TOML sinks; documented as
  defense-in-depth atop the existing name allowlist.
- No new external input, no network, no eval.

## Testing (`node --test`, `__tests__/`) — expanded per re-review

Conventions mirror the existing suite: integration cases run the CLI as a subprocess
with an **isolated `HOME`** (so they hit a temp `~/.warp/`, never the developer's real
one); pure cases use hand oracles; golden output is compared via `assert.deepEqual`.

**Golden mechanism (made concrete — review M1/test-28).** Goldens live in
`__tests__/golden/` keyed by theme **id**. The CC channel already has them; this feature
adds a **Warp-YAML golden** per bundled theme (`__tests__/golden/warp/<id>.yaml`) so the
user-visible YAML is review-gated, not just invariant-checked. Regeneration is a defined
command, not hand-editing: `node build-theme.js compile <theme> --emit-golden` writes
both the CC-JSON and Warp-YAML goldens. The PR's golden diff is the review artifact for
the `deriveAll` rollout.

**Pinned thresholds.** ANSI anchor contrast floor `MIN_ANSI = 3.0`; luminance split for
`details` at `< 0.5` using the pinned sRGB formula. Tests assert against these constants.

**Editor fixture.** The **real worst-case `settings.toml`** shape: nested multi-line
inline table with a trailing comma, sibling `system_theme = false`, and a `[privacy]`
single-quoted regex string containing `{ } , "`.

**Lifecycle / state:**
1. `apply A → apply B → reset` restores the **pre-automation original**, not A. *(top bug)*
2. `apply A → apply A`: restorable original unchanged **and** `settings.toml` is
   byte-identical across the second apply (skip-edit path, no churn).
3. `apply → reset → reset` (double reset) is a clean no-op the second time.
4. `reset` with no prior apply / no state file → exit 0, touches nothing.
5. `apply`, delete the YAML, `reset` → no throw, `settings.toml` still restored.
6. `apply`, delete state file, `reset` → orphaned YAML cleaned via CC `slugHint`.
7. `apply`, insert lines above the section, `reset` restores correct lines (re-locate by content).
8. Fresh machine (no `~/.warp/`): apply exits 0, creates dir + minimal `settings.toml`;
   the created file re-parses cleanly through `locateThemeValue`; `apply → reset` returns
   it to a **no-`theme`-key** state (asserts `originalValueText=null` handling).
9. `~/.warp/` exists, no `settings.toml` → minimal file created (same content assertions as 8).

**TOML editor (pure):**
10. Replace nested multi-line inline table + trailing comma, byte-preserving all else (incl. `system_theme`).
11. `[privacy]` single-quoted braces before the section are ignored.
12. `system_theme`/`theme_mode` siblings not matched.
13. `theme` under `[appearance]` (not `.themes`) → bail, no duplicate key.
14. CRLF round-trips as CRLF; no-trailing-newline preserved.
15. `theme=`, `theme  =`, tab-indented all located; indentation preserved.
16. Comment containing `}` ignored by the matcher.
17. Malformed/never-closing brace (and `"""`/`'''`) → bail, file byte-identical.
18. Round-trip: original → activate → deactivate → **byte-identical** to original (final
    state only; the activated intermediate is single-line and intentionally differs).
19. Crash-injection between temp-write and rename → original intact, no partial.
19a. `.bak` written on first edit is **byte-identical** to the pre-automation file.

**`buildWarpTheme` (pure):**
20. `details` = `darker` for a dark-bg fixture, `lighter` for a light-bg fixture, using
    the pinned luminance formula/threshold (deterministic oracle).
21. `bright.* === lighten(normal.*, 0.25)` (the pinned fn+amount), all valid hex;
    `bright.white` clamped, ≥ `MIN_ANSI` contrast vs background.
22. **For every bundled theme:** resolved `warp.background === resolveHex(ccTheme.overrides.userMessageBackground)`.
23. For every bundled theme **incl. `high-contrast`/`minimalist`**: all emitted ANSI
    colors (incl. `accent`) match `/^#[0-9a-f]{6}$/`; **polarity** holds
    `relLuminance(normal.black) < 0.5 < relLuminance(normal.white)` with a separation gate
    `relLuminance(white) − relLuminance(black) > 0.3` (catches the inversion + the
    "two-darks" hole). No contrast-vs-bg bound on the anchors.
24. A `terminal.*` color in `rgb()` → correct hex; in `ansi:`/`ansi256()` → equals the
    **specific** documented `tokens.color` fallback hex (not merely "valid hex"); never `#NaN`.
25. Name `"Solarized: Dark"` → valid YAML scalar + valid TOML basic string; unicode/emoji
    name UTF-8-valid in both sinks.
26. A validation-forbidden name (`"`, `;`, `{`) causes apply to exit non-zero before `buildWarpTheme`.
26a. A `deriveAll:false` theme omitting `error`/`success`/`warning` entirely → those ANSI
    slots are **omitted** from the YAML (no `#NaN`/`#undefined`), other slots present.

**Concurrency / not-activated branches (review — flagship gap):**
29. **Abort-if-changed:** via a seam, mutate `settings.toml` between `locateThemeValue`
    and `writeTextAtomic`; assert (a) summary prints "Warp theme written but NOT
    activated" + the exact paste-line, (b) the YAML is on disk, (c) `settings.toml`
    **retains the concurrent edit** (not clobbered), (d) no false "applied successfully".
30. For each of {`settings.toml` unreadable, malformed-brace bail, duplicate-`theme`-in-`[appearance]`}:
    YAML written + paste-line printed + no false success.
31. `high-contrast` (and `light`) after `deriveAll`: CC `text`/`diffAdded`/`diffRemoved`
    and Warp `foreground`/`normal.white` clear the theme's intended ratio (≥ 7:1 for
    high-contrast); if unreachable, that theme's `deriveAll` stays off (gates the open item).
32. `writeTextAtomic` **mode-preservation**: chmod fixture to `0600`, apply, assert the
    rewritten `settings.toml` is still `0600` (temp default `0644` must not leak).
33. **Additive insert:** `settings.toml` with other tables but no `[appearance.themes]` →
    apply inserts a valid section + `theme` line at EOF, byte-preserving everything above;
    `reset` removes exactly those lines.

**deriveAll rollout:**
27. Every bundled theme still passes `validateTheme` after its `deriveAll` setting.
28. CC-JSON **and** Warp-YAML goldens regenerated for the 5 flipped themes and asserted;
    `minimalist`'s CC golden unchanged (stays 14 keys); its Warp golden still emitted.

## Documentation

Add a "Warp terminal channel" subsection to SKILL.md: automatic YAML generation,
line-preserving activation, abort-if-changed concurrency, reset cleanup, the
`.whitelabel-state.json` / `.bak` artifacts, and the per-theme `deriveAll` rollout note.

## Open / verify-during-implementation

- Confirm Warp honors `theme = { custom_<slug> = { name, path } }` on live reload; if
  not, switch the writer to bare-string `theme = "<name>"` (the locator/restorer already
  handle the string-value extent). Gated by manual verification on the first apply.
- Verify `high-contrast` retains adequate contrast under `deriveAll` (deriveTokens has
  contrast floors); **gated by test 31** — if it degrades, keep its `deriveAll` off like
  `minimalist` (drops the rollout from 5 themes to 4).
