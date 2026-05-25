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
5. **Terminal colors** are synced to `~/.claude/settings.json` for CLI theming

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
    |--apply---->| (settings.json)  |                  |
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
2. Writes terminal color configuration to `~/.claude/settings.json`
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

Removes the active theme and restores Claude's default styling. Clears the theme from `~/.claude/settings.json` and sends a reset message to any active browser extension.

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

Optional sections include `tokens.typography`, `tokens.logo`, `tokens.favicon`, and `terminal` color overrides.

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
- **Input validation**: All theme files are validated against JSON Schema before processing
- **No eval() or dynamic code execution**: All code is generated from static templates
