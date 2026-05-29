---
title: White-Label Theme Manager
description: Apply, preview, and manage custom themes for Claude's interface
author: Claude Themes Community
version: 1.0.0
commands:
  - name: apply-theme
    description: Apply a theme by ID
  - name: list-themes
    description: List all available themes
  - name: preview-theme
    description: Preview a theme in the browser
  - name: reset-theme
    description: Reset to default Claude styling
---

# White-Label Theme Manager

A zero-dependency theming system for Claude that enables custom color schemes, typography, logos, and terminal styling through a browser extension and CLI toolchain.

## How It Works

The theming system operates through a **bidirectional CLI browser bridge**:

1. **Theme JSON files** define design tokens (colors, fonts, logos) in a declarative format
2. **The CLI compiler** (`build-theme.js`) reads theme files and generates a Chrome extension
3. **The browser extension** injects CSS custom properties and custom fonts into Claude's web interface
4. **Message passing** between the CLI and extension enables live theme switching
5. **Terminal colors** are compiled into a Claude Code custom theme at `~/.claude/themes/<id>.json`, referenced by `"theme": "custom:<id>"` in `~/.claude/settings.json`

### Architecture Overview

```
Theme JSON  build-theme.js   Chrome Extension   Claude Web UI
    |            |                  |                  |
    |--read---->|                  |                  |
    |            |--generate------>|                  |
    |            |  manifest.json   |                  |
    |            |  inject.js       |--inject CSS vars->|
    |            |  styles.css      |  + fonts         |
    |            |  background.js   |  + logo swap     |
    |            |  popup.html      |                  |
    |            |                  |<--runtime msg----|
    |            |<--message relay--|                  |
    |--validate->|                  |                  |
    |--preview-->| (http server)    |                  |
    |--apply---->| (themes/<id>.json + settings theme str) |
    |--reset---->| (remove theme file + clear str)  |
```

### Data Flow

1. **Compile phase**: Theme JSON is parsed, validated, and baked into `inject.js` as a `THEME_DATA` constant
2. **Injection phase**: The content script creates a `CSSStyleSheet` with CSS custom properties on `:root`
3. **Font loading**: If a font URL is specified, the `FontFace` API loads it before applying
4. **Logo replacement**: A `MutationObserver` watches for the sidebar logo element and swaps it
5. **SPA navigation**: The observer persists across React re-renders and route changes
6. **CLI communication**: `chrome.runtime.onMessage` handles theme update/reset commands from the CLI

## Commands

### Apply a Theme

```
/apply-theme <theme-id>
```

Applies a theme by compiling it and updating the active configuration.

Behind the scenes:
1. Validates the theme JSON against `themes/schema.json`
2. Compiles the `terminal`/`tokens.color` values into a Claude Code custom theme written to `~/.claude/themes/<id>.json` (`{ name, base, overrides }`) and sets `"theme": "custom:<id>"` (a string) in `~/.claude/settings.json`. Any previously-applied whitelabel theme file is pruned. Restart Claude Code or re-select via `/theme` to load it.
3. Compiles and outputs the browser extension to `extension/`
4. Displays instructions for loading the extension in Chrome

### List Available Themes

```
/list-themes
```

Scans the `themes/` directory for all valid theme folders and displays a formatted table with ID, name, author, and tags for each theme.

### Preview a Theme

```
/preview-theme <theme-id>
```

Starts a local HTTP server (default port 8765) that renders a mock Claude UI with the theme colors applied. This lets you preview the theme before applying it.

### Reset to Default

```
/reset-theme
```

Removes the active theme and restores Claude's default styling. For the CLI, `build-theme.js reset` deletes the active `~/.claude/themes/<id>.json` and clears the `"theme"` string from `~/.claude/settings.json` (only when it points to a whitelabel `custom:` theme — built-in themes like `"dark"` are left untouched). For the browser, the extension popup's reset sends a reset message to any active tab.

## File Structure

```
.
├── themes/
│   ├── schema.json              # JSON Schema for theme validation
│   └── <theme-id>/
│       └── theme.json           # Theme definition file
├── .claude/
│   └── skills/
│       └── whitelabel-theme/
│           ├── SKILL.md         # This file
│           └── build-theme.js   # CLI compiler
├── scripts/
│   ├── validate-theme.js        # Standalone validation script
│   └── build-marketplace.js     # Marketplace data generator
├── extension/                   # Generated Chrome extension
│   ├── manifest.json
│   ├── inject.js
│   ├── styles.css
│   ├── background.js
│   └── popup.html
└── marketplace/
    └── src/
        └── data/
            ├── themes.json      # Generated theme catalog
            └── stats.json       # Generated aggregate stats
```

## Theme JSON Format

A minimal valid theme requires these fields:

```json
{
  "name": "My Theme",
  "id": "my-theme",
  "version": "1.0.0",
  "author": "Author Name",
  "description": "A short description",
  "license": "MIT",
  "tags": ["dark", "professional"],
  "preview": {
    "background": "#0f0f23",
    "surface": "#1a1a2e",
    "textPrimary": "#e0e0ff",
    "brandPrimary": "#6366f1",
    "userMessageText": "#ffffff"
  },
  "tokens": {
    "color": {
      "brandPrimary": "#6366f1",
      "background": "#0f0f23",
      "surface": "#1a1a2e",
      "textPrimary": "#e0e0ff",
      "userMessageText": "#ffffff"
    }
  }
}
```

Optional sections include `tokens.typography`, `tokens.logo`, `tokens.favicon`, and `terminal` (the Claude Code CLI channel).

## Terminal (Claude Code CLI) Theming

The `terminal` block controls the compiled Claude Code custom theme. The token
set is **verified against the installed Claude Code binary** (currently 2.1.154)
via `scripts/extract-cc-tokens.js`; tokens that don't exist in the build (e.g.
`selectionBg`, `messageActionsBackground`) are excluded. Re-run that script when
targeting a newer Claude Code version.

```json
"terminal": {
  "deriveAll": true,
  "base": "dark",
  "userColor": "#FF007F",
  "assistantColor": "#F8F8FF",
  "backgroundColor": "#0A0612",
  "promptColor": "#FF007F",
  "errorColor": "#FF1A1A",
  "successColor": "#39FF14",
  "systemColor": "#00F0FF",
  "overrides": { "diffAdded": "#174c13", "rainbow_violet": "#da45f7" }
}
```

- **`deriveAll`** (boolean, default `false`) — when `true`, the full ~55-token
  set (diffs, selection-adjacent UI, rainbow, subagent colors, etc.) is
  **derived from the palette**, so the terminal changes dramatically. When
  `false` (the default), only the ~14 explicitly-mapped tokens are emitted —
  this preserves backward compatibility. **Requires** hex
  `tokens.color.success`, `error`, and `warning` (note: there is no
  `warningColor` terminal field — warning is always sourced from
  `tokens.color.warning`).
- **Precedence** (lowest → highest): derived set → friendly `terminal.*` fields
  → `terminal.overrides`. Under `deriveAll`, only **explicit** `terminal.*`
  fields override the derived values (the `tokens.color` fallbacks are
  suppressed), so a color you set by hand always wins over inference.
- **`base`** — the Claude Code base preset to extend: `dark`, `light`,
  `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`. If omitted,
  it is inferred from `tags`.
- **`overrides`** — a raw escape hatch mapping a Claude Code token name directly
  to a color. Use the exact token names (e.g. `diffAddedWord`,
  `rainbow_violet_shimmer`, `red_FOR_SUBAGENTS_ONLY`). Unknown names are
  rejected with an error.
- **Color values** in `terminal.*` and `overrides` accept: hex (`#rgb` /
  `#rrggbb`), `rgb(r,g,b)` (0–255), `ansi256(n)` (0–255), or `ansi:<name>`
  (e.g. `ansi:magentaBright`). `ansi:` values only follow the terminal palette
  under an `*-ansi` base — a warning is emitted otherwise. `tokens.color` stays
  hex-only (it feeds the browser CSS channel).
- The browser extension channel **ignores** `terminal` entirely.

The CLI applies theme files live (hot-reload) — edit `~/.claude/themes/<id>.json`
or re-run apply, then re-select via `/theme` if needed.

## Extension Installation

After running `/apply-theme`, load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Visit [claude.ai](https://claude.ai) to see the theme applied

## Security Considerations

- **Zero npm dependencies**: No supply chain attack surface
- **Native Node.js APIs only**: `fs`, `path`, `crypto`, `http`, `child_process`, `readline`, `url`
- **No external network calls** except for optional font URLs
- **CSP-friendly**: Generated extensions use no inline scripts except the baked-in theme data
- **Input validation**: All theme files are validated in code by `validateTheme()` before processing (the JSON Schema in `themes/schema.json` is documentation; it is not loaded at runtime). Untrusted fields are HTML-escaped / JSON-encoded at every generated-artifact sink, and `terminal.overrides` keys are allowlisted against the verified token set with prototype-pollution keys rejected.
- **No eval() or dynamic code execution**: All code is generated from static templates
