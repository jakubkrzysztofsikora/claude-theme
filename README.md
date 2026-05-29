# Claude White-Label Themes

> **Zero-dependency theming system for Claude. Community-driven theme marketplace.**

> ⚠️ **Unofficial.** This is an independent, community project — not affiliated with,
> endorsed by, or supported by Anthropic. "Claude" is a trademark of Anthropic.

<p align="center">
  <img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933" alt="Node.js >= 18" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#theme-showcase">Themes</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="docs/API_REFERENCE.md">API Docs</a> &bull;
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

## Theme Preview

Eight built-in themes, each crafted with attention to accessibility, contrast, and personality:

| Theme | Preview | Description | Tags |
|-------|---------|-------------|------|
| **Dark** | ![#0d1117](https://via.placeholder.com/16/0d1117/0d1117) `#0d1117` | Classic dark interface with deep blacks and subtle grays | `dark`, `default`, `high-contrast` |
| **Light** | ![#ffffff](https://via.placeholder.com/16/ffffff/ffffff) `#ffffff` | Clean light interface for daytime productivity | `light`, `default`, `minimal` |
| **High-Contrast** | ![#000000](https://via.placeholder.com/16/000000/000000) `#000000` | Maximum legibility, WCAG AAA compliant | `accessibility`, `wcag-aaa`, `dark` |
| **Branded** | ![#1a237e](https://via.placeholder.com/16/1a237e/1a237e) `#1a237e` | Organization-ready with professional accent colors | `corporate`, `branded`, `professional` |
| **Minimalist** | ![#fafafa](https://via.placeholder.com/16/fafafa/fafafa) `#fafafa` | Stripped-back, distraction-free interface | `minimal`, `clean`, `light` |
| **Nature** | ![#1b5e20](https://via.placeholder.com/16/1b5e20/1b5e20) `#1b5e20` | Earthy greens and warm browns for a calming feel | `nature`, `green`, `organic` |
| **Cyberpunk** | ![#ff00ff](https://via.placeholder.com/16/ff00ff/ff00ff) `#ff00ff` | Neon accents on deep purple-black backgrounds | `neon`, `dark`, `cyberpunk` |
| **Warm-Neutral** | ![#3e2723](https://via.placeholder.com/16/3e2723/3e2723) `#3e2723` | Sepia-infused tones for reduced eye strain | `warm`, `sepia`, `comfortable` |

> Browse all themes in the [`themes/`](themes/) directory. Each theme is self-contained with its own `theme.json`, `logo.svg`, and `README.md`.

---

## Quick Start

Get your first theme running in under 60 seconds.

### Option A — npm / npx (no clone)

```bash
# Run directly without installing
npx claude-whitelabel-themes list
npx claude-whitelabel-themes apply ./my-theme.json

# …or install the `claude-theme` command globally
npm install -g claude-whitelabel-themes
claude-theme list
```

> The CLI writes its generated browser extension to `./extension` in your current
> directory (override with `compile --out <dir>`), and applies CLI/Warp themes to
> `~/.claude` and `~/.warp`.

### Option B — clone the repo (for theme development)

```bash
git clone https://github.com/jakubkrzysztofsikora/claude-theme.git
cd claude-theme
```

### 2. Apply a theme

```bash
# Apply the built-in dark theme
node .claude/skills/whitelabel-theme/build-theme.js apply themes/dark/theme.json

# Or use npm scripts
npm run theme:apply -- themes/dark/theme.json
```

### 3. List available themes

```bash
node .claude/skills/whitelabel-theme/build-theme.js list
```

### 4. Load the browser extension

1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select the generated `extension/` folder
4. Open [claude.ai](https://claude.ai) -- your theme is live!

---

## Features

### Zero Dependencies
100% native Node.js and browser APIs. No `node_modules` to install, no supply chain to audit. The entire system runs on APIs available in Node.js 18+ and modern browsers.

### Bidirectional Terminal + Browser Synchronization
Changes made in your terminal are instantly reflected in the browser. The browser extension listens for theme updates and hot-reloads without a page refresh. Edit your `theme.json`, save, and watch Claude transform in real time.

### 8 Built-In Themes
Every theme ships with a complete color system (backgrounds, text, accents, semantic colors), a custom SVG logo, and a hand-picked Google Font. All themes are WCAG AA compliant at minimum.

### Community Theme Marketplace
Browse, preview, and install themes contributed by the community at our [GitHub Pages marketplace](https://jakubkrzysztofsikora.github.io/claude-theme/). Submit your own themes via pull request.

### Submit Themes via Pull Request
The theme submission workflow is fully automated. Fork the repo, add your theme, validate it locally, and open a PR. CI runs accessibility checks and generates a preview. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Live Preview Before Applying
Preview any theme in a browser window before committing to it. The preview renders a mock Claude interface with real colors, fonts, and your logo.

```bash
node .claude/skills/whitelabel-theme/build-theme.js preview themes/cyberpunk/theme.json
```

### Dynamic Font Loading
Themes specify Google Fonts that are automatically loaded via the FontFace API. No external CSS files -- fonts are fetched and injected at runtime, working even in CSP-restricted environments.

### Logo Replacement
Replace the Claude logo with your own SVG. Logos are embedded directly into the extension and swapped at runtime. Support for light/dark variants and hover states.

### Claude Code CLI Theming
The `terminal` colors in `theme.json` are compiled into a real Claude Code custom theme. On `apply`, the tool writes `~/.claude/themes/<id>.json` (`{ name, base, overrides }`) and sets `"theme": "custom:<id>"` in `~/.claude/settings.json`. Restart Claude Code (or re-select via `/theme`) to load it; run `reset` to remove it.

### CSS Variable Overrides
The entire theme is expressed as CSS custom properties (`--theme-bg-primary`, `--theme-accent`, etc.), making it easy to tweak individual values or layer additional styles on top.

### MutationObserver-Based SPA Navigation
Claude is a single-page application. The theme injector uses `MutationObserver` to detect route changes and DOM updates, ensuring your theme persists across conversations, projects, and settings pages.

---

## Architecture

The theming system has three components that work together:

| Component | What It Does |
|-----------|-------------|
| **CLI Compiler** (`build-theme.js`) | Reads `theme.json`, validates schema, compiles a browser extension |
| **Browser Injector** (`content-script.js`) | Injects CSS variables, loads fonts, swaps logos, syncs with CLI |
| **Claude Skill** (`.claude/skills/whitelabel-theme/`) | Slash commands inside Claude Code: `/theme apply`, `/theme list` |

### How the Bidirectional Bridge Works

```
Terminal (Node.js)                          Browser (Chrome/Edge)
     |                                              |
     |  1. build-theme.js apply theme.json          |
     |--------------------------------------------->|
     |     writes to extension/manifest.json        |
     |     + compiled CSS/JS                        |
     |                                              |
     |  2. Extension detects file change            |
     |     via chrome.runtime.reload() or           |
     |     Native Messaging port                    |
     |                                              |
     |  3. content-script.js injects                |
     |     CSS variables + loads font               |
     |     + swaps logo SVG                         |
     |                                              |
     |  4. User sees theme instantly                |
```

### Security Model: Zero Supply-Chain Risk

Every dependency is a potential attack vector. This system removes that vector entirely:

```
Traditional:  Your Code -> 200 deps -> 2,000 sub-deps -> ???
This System:  Your Code -> 0 deps  -> 0 sub-deps  -> N=0
```

- No `npm install` required (unless you want the optional dev tools)
- No third-party code in the runtime path
- All network requests (font loading, etc.) use native browser APIs
- Extension code is fully auditable in a single file

---

## Installation

### Prerequisites

- **Node.js** 18+ (check with `node --version`)
- **Chrome** 90+ or **Edge** 90+ (for Manifest V3 support)
- **Claude Code** (optional, for slash commands)

### Step-by-Step

#### 1. Clone the repository

```bash
git clone https://github.com/jakubkrzysztofsikora/claude-theme.git
cd claude-whitelabel-themes
```

#### 2. Apply a theme (generates the extension)

```bash
# Apply the default dark theme
node .claude/skills/whitelabel-theme/build-theme.js apply themes/dark/theme.json
```

This creates an `extension/` folder containing:
- `manifest.json` -- browser extension manifest
- `theme.css` -- compiled CSS variables
- `inject.js` -- content script for injection
- `logo.svg` -- your theme's logo
- `logo-dark.svg` -- dark variant (if provided)

#### 3. Load the extension in Chrome/Edge

1. Open Chrome and go to `chrome://extensions/`
2. Toggle **Developer mode** on (top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder inside the project
5. The extension is now active on `claude.ai`

#### 4. Verify it's working

Open [claude.ai](https://claude.ai) and look for:
- The background color changed to your theme's primary background
- The logo replaced with your theme's SVG
- The font changed (may take 1-2 seconds to load)

#### 5. (Optional) Enable slash commands in Claude Code

```bash
# Claude Code will automatically detect the skill
claude /theme list
claude /theme apply themes/nature/theme.json
```

---

## Theme Showcase

### Built-In Themes

| Theme | Author | Type | Accent | WCAG | Tags |
|-------|--------|------|--------|------|------|
| **dark** | Core Team | Dark | `#58a6ff` | AA | `default`, `dark`, `blue` |
| **light** | Core Team | Light | `#0969da` | AA | `default`, `light`, `blue` |
| **high-contrast** | Core Team | Dark | `#ffdd00` | AAA | `accessibility`, `high-contrast` |
| **branded** | Core Team | Light/Dark | `#6200ea` | AA | `corporate`, `purple` |
| **minimalist** | Core Team | Light | `#212121` | AA | `minimal`, `monochrome` |
| **nature** | Core Team | Light/Dark | `#2e7d32` | AA | `green`, `organic`, `calm` |
| **cyberpunk** | Core Team | Dark | `#ff00ff` | AA | `neon`, `cyberpunk`, `purple` |
| **warm-neutral** | Core Team | Light/Dark | `#8d6e63` | AA | `warm`, `sepia`, `comfortable` |

### Theme File Structure

```
themes/dark/
├── theme.json        # Theme definition (colors, font, metadata)
├── logo.svg          # Logo for light backgrounds
├── logo-dark.svg     # Logo for dark backgrounds
└── README.md         # Theme-specific documentation
```

### Preview a Theme

```bash
# Opens a browser preview window
node .claude/skills/whitelabel-theme/build-theme.js preview themes/cyberpunk/theme.json
```

---

## Project Structure

```
claude-whitelabel-themes/
|-- .claude/
|   -- skills/
|       -- whitelabel-theme/
|           |-- build-theme.js       # CLI compiler & entry point
|           |-- schema.json          # Theme JSON schema definition
|           |-- skill.json           # Claude Skill manifest
|           |-- templates/           # Theme scaffolding templates
|           -- content-script.js     # Browser injection script
|-- docs/
|   |-- GETTING_STARTED.md           # Beginner-friendly walkthrough
|   |-- THEME_AUTHORING.md           # Guide for theme creators
|   |-- API_REFERENCE.md             # Complete API documentation
|   -- ARCHITECTURE.md               # Technical deep-dive
|-- extension/                       # Generated extension (gitignored)
|-- marketplace/                     # GitHub Pages marketplace site
|-- scripts/
|   |-- validate-theme.js            # Standalone theme validator
|   |-- build-marketplace.js         # Marketplace site generator
|   -- check-contrast.js             # WCAG contrast checker
|-- themes/
|   |-- dark/
|   |   |-- theme.json
|   |   |-- logo.svg
|   |   |-- logo-dark.svg
|   |   -- README.md
|   |-- light/
|   |   -- ...
|   |-- high-contrast/
|   |   -- ...
|   |-- branded/
|   |   -- ...
|   |-- minimalist/
|   |   -- ...
|   |-- nature/
|   |   -- ...
|   |-- cyberpunk/
|   |   -- ...
|   -- warm-neutral/
|       -- ...
|-- CONTRIBUTING.md                  # Contribution guidelines
|-- LICENSE                          # MIT License
|-- package.json                     # Optional npm scripts
-- README.md                        # This file
```

---

## CLI Commands

All commands are available via `node .claude/skills/whitelabel-theme/build-theme.js` or npm scripts:

| Command | Description | Usage |
|---------|-------------|-------|
| `apply` | Apply a theme (compile + notify) | `apply <theme.json>` |
| `compile` | Compile theme to extension/ | `compile <theme.json>` |
| `list` | List all available themes | `list [themes-dir]` |
| `validate` | Validate a theme.json file | `validate <theme.json>` |
| `preview` | Preview theme in browser | `preview <theme.json>` |
| `init` | Scaffold a new theme | `init <theme-name>` |

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full API documentation.

---

## Contributing

We love contributions! Whether you're submitting a new theme, fixing a bug, or improving documentation, we appreciate your help.

Please read our [Contributing Guide](CONTRIBUTING.md) for details on:
- Submitting new themes
- Code contribution workflow
- Development setup
- Reporting issues

### Quick Contribution: Fix a Typo

Found a typo? Click the edit button on any file in GitHub, make your change, and submit a PR -- no need to clone locally.

---

## Roadmap

- [ ] Firefox support (Manifest V2/V3 polyfill)
- [ ] Safari extension
- [ ] Theme import/export (shareable `.claude-theme` files)
- [ ] Real-time theme editor (visual UI)
- [ ] Auto-dark-mode (time-based theme switching)
- [ ] Community voting on marketplace themes

---

## License

MIT License. See [LICENSE](LICENSE) for the full text.

Copyright (c) 2026 Claude White-Label Themes Contributors.

---

<p align="center">
  Built with zero dependencies by the community.
</p>
