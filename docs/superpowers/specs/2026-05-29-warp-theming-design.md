# Design: Automatic Warp Terminal Theming

**Date:** 2026-05-29
**Status:** Approved (pending spec review)
**Component:** `.claude/skills/whitelabel-theme/build-theme.js`

## Problem

Applying a whitelabel theme changes only a handful of Claude Code CLI text colors.
The user observed that **the terminal background and most text don't change**. Root
cause (from prior debug investigation):

1. **No global-background token.** Claude Code's verified 55-token set has only four
   *block-scoped* background tokens (`userMessageBackground`,
   `userMessageBackgroundHover`, `bashMessageBackgroundColor`,
   `memoryBackgroundColor`). The whole-window background is painted by the terminal
   emulator, never by a CC theme.
2. **`deriveAll` off by default.** Without it only ~14 of 55 tokens are emitted, so
   most text keeps the `dark` base preset's colors.

The emulator here is **Warp**, which paints its background from its own theme system
(`~/.warp/themes/*.yaml`) and selects the active theme in `~/.warp/settings.toml`.

## Goal

Make the build pipeline **automatically** produce and activate a matching Warp theme
for every theme — on `apply`, on `reset` (cleanup), and for newly `init`-ed themes —
and enable full token derivation across all bundled themes.

## Scope (agreed decisions)

- **Activation depth:** write the Warp YAML **and** auto-activate it by editing
  `~/.warp/settings.toml`.
- **Trigger:** **always** generate the Warp YAML (regardless of detected terminal).
- **Reset:** full symmetric cleanup — remove the generated YAML and restore the prior
  `settings.toml` theme value.
- **deriveAll:** flip `deriveAll: true` on across all bundled themes **and** the
  `init` template.
- **settings.toml edit strategy:** **Line-preserving structural edit** — parse only
  enough to locate `[appearance.themes].theme` and brace-match its (possibly
  multi-line inline-table) value; rewrite only those lines; byte-preserve every other
  line (comments, key order, formatting). No TOML dependency; no full re-serialize.

## Non-goals

- A general TOML parser/serializer. We locate and replace one value, nothing else.
- Theming emulators other than Warp (the mapping is generic enough to extend later,
  but only Warp activation is implemented now).
- Changing fonts — fonts are a Warp setting and out of scope for any theme channel.

## Architecture

All code lives in `build-theme.js`, in one delimited **"Warp terminal channel"**
section, consistent with the file's existing organization
(`buildClaudeCodeTheme`, `generateManifest`, etc.). New units, each with a single
responsibility and a pure core where possible:

### 1. `buildWarpTheme(theme) -> string` (pure)

Maps theme tokens to a Warp theme YAML string. Deterministic; no I/O.

| Warp field | Source (first defined wins) |
|---|---|
| `name` | `theme.name` (YAML-escaped: single-quoted, internal `'` doubled) |
| `background` | `terminal.backgroundColor` → `tokens.color.background` |
| `foreground` | `terminal.assistantColor` → `tokens.color.textPrimary` |
| `accent` | `terminal.promptColor` → `tokens.color.brandPrimary` |
| `details` | `darker` if background luminance < 0.5 else `lighter` |
| `terminal_colors.normal.black` | `tokens.color.surface` |
| `…normal.red` | `terminal.errorColor` → `tokens.color.error` |
| `…normal.green` | `terminal.successColor` → `tokens.color.success` |
| `…normal.yellow` | `tokens.color.warning` |
| `…normal.blue` | `terminal.systemColor` → `tokens.color.brandAccent` |
| `…normal.magenta` | `tokens.color.textSecondary` → `brandPrimary` |
| `…normal.cyan` | `terminal.userColor` → `tokens.color.brandPrimary` |
| `…normal.white` | `tokens.color.textPrimary` |
| `…bright.*` | `lighten(normal.*)` via the existing helper; `bright.white` → `#FFFFFF` |

Luminance helper (relative, sRGB-weighted) added if not already present.
All emitted color strings are validated hex (inputs are hex per `tokens.color`).

### 2. `writeWarpTheme(theme) -> path` (I/O)

`mkdir -p ~/.warp/themes`; write `~/.warp/themes/<theme.id>.yaml` atomically.
`theme.id` is re-asserted against `SLUG_RE` before forming the path (defense in depth,
matching the existing CC-theme write).

### 3. `activateWarpTheme(theme, yamlPath)` (I/O, line-preserving structural edit)

- If `~/.warp/settings.toml` is absent: create a minimal file containing
  `[appearance.themes]` + the theme line. Done.
- Else read as text. Back up to `~/.warp/settings.toml.whitelabel.bak` (once; the
  backup is the *pre-automation* original — written only if it doesn't already exist).
- Locate the `[appearance.themes]` section header; section body runs until the next
  `[...]` header or EOF.
- Within the body, find the line whose trimmed text starts with `theme =`/`theme=`.
  Determine its value extent:
  - inline table (`{`): scan forward tracking brace depth (ignoring braces inside
    quoted strings) until depth returns to 0 — extent is start line … closing-brace
    line.
  - quoted string: single line.
- Record `{ previousValueLines, startIndex, endIndex }` to a state file
  `~/.warp/themes/.whitelabel-state.json` (`{ activeId, yamlPath, previousValueText }`)
  for reset.
- Replace the extent with the Warp-native inline-table form, preserving the original
  `theme` line's indentation:
  ```toml
  theme = { custom_<slug> = { name = "<Theme Name>", path = "<abs yaml path>" } }
  ```
  (`custom_<slug>` = `custom_` + `theme.id` with `-`→`_`.) Bare-string form
  `theme = "<name>"` is the documented fallback if Warp does not honor the inline form.
- If the section or `theme` key is missing: **additive, non-lossy** insert (append a new
  `[appearance.themes]` section at EOF, or insert the `theme` line right after an
  existing header). Never reformat surrounding lines.
- Print a note to restart/reload Warp if a `WarpTerminal` process appears to be running
  (best-effort; activation still proceeds).

### 4. `deactivateWarpTheme()` (I/O) — used by `reset`

- Read `.whitelabel-state.json`. If absent, no-op (nothing we own to undo).
- Restore the recorded previous `theme` value lines into `settings.toml` (same
  line-preserving editor). If the original had no theme key, remove the line we added.
- Delete `~/.warp/themes/<activeId>.yaml`.
- Delete the state file.

### 5. Wiring

- `cmdApply`: after the CC-theme + extension steps, call `writeWarpTheme` then
  `activateWarpTheme`. Extend the success output with a "Warp" section.
- `cmdReset`: call `deactivateWarpTheme` alongside the existing CC cleanup.
- `cmdInit`: template gains `"deriveAll": true` and the `terminal` friendly fields so a
  freshly created theme produces full CC derivation **and** Warp output immediately.

### 6. `deriveAll` rollout

Set `"deriveAll": true` in the six themes lacking it (branded, dark, high-contrast,
light, minimalist, warm-neutral); nature and cyberpunk already have it. All themes
carry the required `tokens.color` fields (`success`/`error`/`warning` + palette), so
derivation preconditions hold and validation still passes.

## Data flow

```
theme.json ──> buildWarpTheme ──> YAML string ──> ~/.warp/themes/<id>.yaml
                                                          │
cmdApply ─────────────────────────> activateWarpTheme ───┤
                                          │               └─> settings.toml (theme value
                                          └─> .whitelabel-state.json          line replaced)

cmdReset ─> deactivateWarpTheme ─> restore settings.toml value + rm yaml + rm state
```

## Error handling

- Unsafe `theme.id` (fails `SLUG_RE`) → abort before any path is formed.
- `settings.toml` unreadable → skip activation, warn, still leave the YAML written
  (graceful degradation; never corrupt the file).
- `[appearance.themes]`/`theme` not found → additive insert, never a reformat.
- Brace-matching never terminates (malformed file) → bail out of activation with a
  warning rather than guess an extent.
- All file writes use the existing atomic-write helper; a backup precedes the first
  edit.

## Security

- `theme.id` re-asserted against `SLUG_RE` at every path-forming sink (Warp YAML path,
  state file lookups).
- `theme.name` YAML-escaped before embedding in the YAML and TOML string sinks.
- No new external input, no network, no eval — consistent with the project's
  zero-dependency, static-template posture.

## Testing (`node --test`, in `__tests__/`)

- `buildWarpTheme`: deterministic YAML for a representative theme; correct
  `details` for a light vs dark background; `bright.*` = `lighten(normal.*)`;
  name escaping for a name containing a quote.
- settings.toml editor (pure string functions):
  - replace a multi-line inline-table `theme` value, byte-preserving all other lines;
  - replace a single-line string `theme` value;
  - additive insert when the section/key is missing;
  - round-trip: activate then deactivate restores the original bytes of the theme line.
- Regression: every bundled theme still passes `validateTheme` with `deriveAll: true`.

## Documentation

Add a "Warp terminal channel" subsection to SKILL.md describing automatic YAML
generation, `settings.toml` activation (line-preserving), reset cleanup, the
`.whitelabel-state.json`/`.bak` artifacts, and the inline-table-vs-string fallback.

## Open / verify-during-implementation

- Confirm Warp honors the `theme = { custom_<slug> = { name, path } }` form on live
  reload; if not, switch the writer to the bare-string form (`theme = "<name>"`). This
  is the one empirically-uncertain point and is gated by manual verification on apply.
