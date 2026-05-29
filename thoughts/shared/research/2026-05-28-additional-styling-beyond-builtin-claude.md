---
date: 2026-05-28
commit: a024385f03f77fc6426153a14231effb93210f7d
branch: research/styling-beyond-builtin
tags: [theming, claude-code, cli, browser-extension, styling]
status: complete
---
# Research: Applying Additional Styling Beyond Built-in Claude Code Abilities

## Summary

This repo's `build-theme.js` compiles a theme JSON into two channels: a Claude Code CLI custom theme (`~/.claude/themes/<id>.json`) and a Chrome extension for claude.ai. The **CLI channel currently emits only 14 override tokens**, but Claude Code (v2.1.118+) officially documents **~35 overridable tokens** (and ~69 reverse-engineered), including diff colors, selection background, and many UI-mode colors. The biggest near-term opportunity is wiring up the unused-but-supported CLI tokens; broader styling (syntax token colors, fonts, terminal background) remains impossible in the CLI and only achievable via the browser extension or the terminal emulator itself.

## Files Involved

### Theming compiler (single source for both channels)
| File | Layer | Purpose |
|------|-------|---------|
| `.claude/skills/whitelabel-theme/build-theme.js` | Compiler | Builds CLI theme + Chrome extension from theme JSON |
| `themes/schema.json` | Schema | JSON Schema for theme validation |
| `themes/cyberpunk/theme.json` | Theme data | Note: declares `id: "neon-district"` (folder/id mismatch) |
| `themes/branded/theme.json` | Theme data | Uses `tokens.logo`, `tokens.favicon`, `terminal.systemColor` |

### Key functions in build-theme.js
| Symbol | Lines | Purpose |
|--------|-------|---------|
| `CC_TOKENS` | 49–64 | The 14 tokens the CLI channel will emit |
| `pickBase()` | 154–157 | Derives `base` from theme `tags` |
| `buildClaudeCodeTheme()` | 164–208 | Maps `terminal` + `tokens.color` → CLI `overrides` |
| `cmdApply()` | 1130–1229 | Writes `~/.claude/themes/<id>.json` + settings |
| `generateManifest()` | 412–441 | MV3 manifest |
| `generateInjectJs()` | 448–839 | Content script (CSS vars, font, logo observer) |
| `generateStylesCss()` | 844–882 | `:root` CSS custom props |
| `generateBackgroundJs()` | 887–951 | Service worker |
| `generatePopupHtml()` | 957–1076 | Extension popup |

## Current Solution — Two Channels

### Channel 1: Claude Code CLI (limited)

`buildClaudeCodeTheme()` (build-theme.js:164–208) emits exactly these 14 tokens, each only if a source value resolves truthy:

| CC Token | Source (first truthy wins) |
|---|---|
| `claude`, `promptBorder` | `terminal.promptColor` OR `tokens.color.brandPrimary` |
| `briefLabelYou` | `terminal.userColor` OR `tokens.color.userMessageText` |
| `briefLabelClaude`, `text` | `terminal.assistantColor` OR `tokens.color.textPrimary` |
| `error` | `terminal.errorColor` OR `tokens.color.error` |
| `success` | `terminal.successColor` OR `tokens.color.success` |
| `warning` | `tokens.color.warning` |
| `planMode`, `ide` | `terminal.systemColor` OR `tokens.color.brandAccent` |
| `userMessageBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor` | `terminal.backgroundColor` OR `tokens.color.background` |
| `userMessageBackgroundHover` | `lighten(bg, 0.06)` |

Output shape: `{ name, base, overrides }`, written to `~/.claude/themes/<theme.id>.json`; `settings.json.theme` set to `"custom:<theme.id>"` (string). Theme fields **ignored by the CLI channel**: `tokens.logo`, `tokens.favicon`, all `tokens.typography`, and most of `tokens.color` (`surface`, `border`, `textSecondary`, `codeBackground`, etc.).

### Channel 2: Browser extension (much richer)

Generated into `extension/`. Capabilities the CLI lacks:
- All `tokens.color.*` → `--ct-<kebab>` CSS custom properties on `:root` (generateStylesCss:844–882, injectStyles in inject.js:518–567)
- `!important` overrides of `body` background/text/font-family
- Web font loading via `<link>` + `document.fonts.ready` (loadCustomFont, inject.js:576–601)
- Logo swap via MutationObserver, sanitized SVG/text/emoji (inject.js:665–741)
- Runtime activate/deactivate via `chrome.runtime.onMessage`
- **Favicon: declared in schema/themes but NOT implemented** — no generator reads `tokens.favicon`

## External Research — What Claude Code Actually Supports

Source of truth: [code.claude.com/docs/en/terminal-config](https://code.claude.com/docs/en/terminal-config) (custom themes, v2.1.118+). Themes hot-reload — edits to `~/.claude/themes/<id>.json` apply live without restart.

### Officially documented overridable tokens (~35) — superset of our 14

Color value formats accepted: `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `ansi256(n)`, `ansi:<name>` (e.g. `ansi:cyanBright`). Unknown tokens are silently ignored.

| Category | Tokens |
|---|---|
| Brand | `claude`, `claudeShimmer` |
| Text | `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `remember` |
| Status | `success`, `error`, `warning`, `warningShimmer`, `merged` |
| Input/mode | `promptBorder`, `promptBorderShimmer`, `permission`, `permissionShimmer`, `planMode`, `autoAccept`, `bashBorder`, `ide`, `fastMode`, `fastModeShimmer` |
| **Diffs (NOT currently emitted)** | `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`, `diffAddedWord`, `diffRemovedWord` |
| Fullscreen | `userMessageBackground`, `userMessageBackgroundHover`, `messageActionsBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg` |
| Usage meter | `rate_limit_fill`, `rate_limit_empty` |
| Speaker labels | `briefLabelYou`, `briefLabelClaude` |
| Subagents | 8 `*_FOR_SUBAGENTS_ONLY` colors |
| Rainbow | `rainbow_*` (+ `_shimmer`) — 14 tokens |

Community-reverse-engineered full catalog (~69 tokens, unofficial, may break): [cameronsjo gist](https://gist.github.com/cameronsjo/34a6fb8ade2b44c8380e1a2adebbac2b).

### Syntax highlighting — NOT customizable
- Palette is hardcoded, selected by `base` (`dark` → Monokai-style, `light` → GitHub-light-style). `Ctrl+T` in `/theme` only toggles on/off.
- `"syntaxHighlightingDisabled": true` disables it entirely. No per-token remap API exists. Open requests: [#48636](https://github.com/anthropics/claude-code/issues/48636), [#42189](https://github.com/anthropics/claude-code/issues/42189).
- Note: **diff line backgrounds are separate** from syntax token colors and ARE overridable (`diffAdded`/`diffRemoved`/…).

### Terminal emulator vs Claude Code
- **Emulator controls:** background color, the 16 ANSI colors (used only with `*-ansi` base), fonts, cursor, transparency.
- **Claude Code controls (bypasses ANSI):** `dark`/`light` presets use hardcoded RGB for all chrome + syntax.
- **Escape hatch:** `base: "dark-ansi"` + `ansi:<name>` override values make the UI follow the terminal palette — but has known readability bugs ([#40905](https://github.com/anthropics/claude-code/issues/40905), [#40071](https://github.com/anthropics/claude-code/issues/40071)).
- No transparent/rgba backgrounds in the TUI ([#15771](https://github.com/anthropics/claude-code/issues/15771)).

### Other supported customization levers
- **Status line:** `statusLine` in settings → shell script receiving JSON on stdin; script emits ANSI-colored text. Fully styleable. [docs](https://code.claude.com/docs/en/statusline). Community: [ccstatusline](https://github.com/sirmalloc/ccstatusline).
- **Plugins:** can contribute themes to the `/theme` picker but use the same token set — no new token types. [plugins-reference](https://code.claude.com/docs/en/plugins-reference#themes).
- **Color depth:** set `export COLORTERM=truecolor` / `FORCE_COLOR=3` in the shell before launching `claude` (env block in settings does NOT affect Claude Code's own UI as of v2.1.143). tmux forces 256-color regardless ([#59867](https://github.com/anthropics/claude-code/issues/59867)).
- **`prefersReducedMotion: true`** disables shimmer animations.

## Capability Gap Summary

| Want | CLI today | CLI possible (docs) | Browser ext |
|---|---|---|---|
| Prompt/label/status colors | yes (14 tokens) | yes | n/a |
| Diff add/remove colors | no, not emitted | yes (`diffAdded`/`diffRemoved`/…) | n/a |
| Selection, subtle, suggestion, permission, autoAccept, bashBorder, fastMode | no, not emitted | yes | n/a |
| Subagent / rainbow / rate-limit colors | no | yes | n/a |
| Syntax token colors | no | no (not supported anywhere) | yes via CSS |
| Terminal background, fonts | no | no (emulator-only) | yes |
| Logo / arbitrary CSS | no | no | yes |

## Open Questions

- Do we want to expand `buildClaudeCodeTheme()` + `CC_TOKENS` + `themes/schema.json` to map the additional ~21 documented CLI tokens (especially diffs, selectionBg, subtle/suggestion, permission/autoAccept/bashBorder)? This is the highest-leverage change to make CLI themes feel dramatic.
- Should theme JSON expose `base` selection directly (incl. `dark-ansi`) rather than inferring from `tags` via `pickBase()`?
- Should we support `ansi:`/`ansi256()` color values for terminal-palette-following themes?
- The unimplemented `tokens.favicon` in the extension — wire it up or remove from schema?
