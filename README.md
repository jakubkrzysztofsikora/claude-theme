# Claude White-Label Themes

> **Personalize Claude everywhere — one theme restyles the claude.ai web UI, the
> Claude Code CLI, and your Warp terminal. Author once, apply across all three.**

**Why:** every other Claude theming option styles a *single* surface — a VS Code color
theme, a Claude Code preset, or a browser userstyle. None of them give you **one palette
that follows you across all three places you actually use Claude**: the claude.ai web UI,
the Claude Code CLI, and your Warp terminal. Native Claude only offers Light / Dark, and
Claude Code's terminal colors are otherwise hard to fully control. This is a
zero-dependency CLI that compiles **a single theme file** into a browser extension + a
Claude Code theme + a Warp theme — author once, apply everywhere — with 11 built-in themes,
accessible high-contrast/colorblind bases, and an `init`-to-author workflow.

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

## Why this vs. other options

Other Claude theming projects each cover **one surface**. This is the only one where you
**author a theme once and it applies across the claude.ai web UI, the Claude Code CLI, and
Warp** — from a single `theme.json`.

| | claude.ai web | Claude Code CLI | Warp / terminal | Author once | a11y / high-contrast | Zero-dependency |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **This tool** (`claude-whitelabel-themes`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [`ashwingopalsamy/claude-code-theme`](https://github.com/ashwingopalsamy/claude-code-theme) (VS Code theme) | ❌ | ❌ | ❌ | ❌ | ❌ | n/a |
| [`rafsanmuhammed/claude-code-themes`](https://github.com/rafsanmuhammed/claude-code-themes) | ❌ | ✅ | ❌ | ❌ | ❌ | n/a |
| userstyles / [Stylus](https://github.com/openstyles/stylus) (browser userstyle) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

Surface coverage is the differentiator: the same palette, logo, and font follow you from
the browser into the terminal, so your Claude looks consistent wherever you work — and the
built-in high-contrast/colorblind bases keep it readable.

---

## See it

<!--
  SCREENSHOTS — TODO (owner): drop real images into docs/media/ and reference them here.
  This tool's value is visual; placeholder color chips are not a substitute. Capture:
    1. docs/media/web-before-after.png|gif — claude.ai default vs. a theme applied
       (e.g. apply forest-canopy, screenshot the sidebar/chat; a GIF toggling is ideal).
    2. docs/media/cli.gif — Claude Code terminal before/after, or an Asciinema cast
       (asciinema rec docs/media/cli.cast) of `claude-theme apply neon-district`.
    3. docs/media/warp.png — Warp window on a theme (e.g. forest-canopy / neon-district).
  Then replace the placeholder lines below with: ![Themed claude.ai](docs/media/web-before-after.png)
-->

> 📸 _Screenshots coming soon._ Until then, apply a theme and see for yourself:
> `npx claude-whitelabel-themes apply forest-canopy` (browser + CLI + Warp).

## Built-in themes

Eleven themes spanning dark, light, high-contrast, colorblind-safe, and monochrome — each
self-contained in [`themes/<id>/theme.json`](themes/). Apply any by **id**:
`claude-theme apply <id>`.

| Theme (`id`) | Background | Accent | Tags |
|---|---|---|---|
| **Neon District** (`neon-district`) | `#0A0612` | `#FF007F` | dark, cyberpunk, neon |
| **Midnight Forge** (`midnight-forge`) | `#0F1115` | `#0192F4` | dark, professional, ide-inspired |
| **Forest Canopy** (`forest-canopy`) | `#0F1F17` | `#4ADE80` | dark, nature, green |
| **A11y First** (`a11y-first`) | `#000000` | `#00CCFF` | high-contrast, accessibility, wcag-aaa |
| **High Contrast Pro** (`high-contrast-pro`) | `#000000` | `#FFFFFF` | dark, high-contrast, accessibility |
| **Daltonized Dark** (`daltonized-dark`) | `#0B0E14` | `#648FFF` | dark, daltonized, colorblind-safe |
| **Daltonized Light** (`daltonized-light`) | `#FFFFFF` | `#3A56D4` | light, daltonized, colorblind-safe |
| **Clean Slate** (`clean-slate`) | `#FAFAF9` | `#2563EB` | light, minimal, professional |
| **Parchment** (`parchment`) | `#F5F0E8` | `#A07818` | light, warm, sepia |
| **Terracotta Pro** (`terracotta-pro`) | `#FDF6F0` | `#9A4822` | light, warm, earthy |
| **Mono Space** (`mono-space`) | `#FFFFFF` | `#1A1A1A` | light, minimalist, monochrome |

> Run `claude-theme list` for the live table, or `claude-theme preview <id>` to see a theme
> in a mock UI before applying. Each theme dir has its own `theme.json` + `README.md`.

### Accessibility

Claude Code's terminal UI uses hardcoded colors that ordinary terminal themes can't
override, which is a documented accessibility gap
([anthropics/claude-code#34702](https://github.com/anthropics/claude-code/issues/34702)),
and its near-white user-input highlight can wash out text on bright themes
([#8504](https://github.com/anthropics/claude-code/issues/8504)). These presets target
both — and `deriveAll` always sets `userMessageBackground` from the theme background, so
the input block is never an unreadable white box:

- **High Contrast Pro** — pure-black/pure-white, WCAG AAA (21:1 text contrast).
- **Daltonized Dark / Light** — colorblind-safe (Okabe-Ito / IBM blue+orange+yellow), so
  status colors stay distinguishable for red-green color vision deficiency.
- **A11y First** — WCAG AAA high-contrast on pure black.

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

### 11 Built-In Themes
Every theme ships with a complete color system (backgrounds, text, accents, semantic colors), a custom SVG logo, and a hand-picked Google Font. All themes are WCAG AA compliant at minimum, and the bundle includes high-contrast (AAA) and colorblind-safe (daltonized) presets — see [Accessibility](#accessibility).

### Resilient to claude.ai changes (best-effort)
The browser extension themes claude.ai by injecting **CSS custom properties on `:root`** (not brittle class selectors), carries a schema version, and **self-heals** — re-injecting on SPA navigation and warning once (never crashing) if claude.ai's markup changes. claude.ai is a third-party app we don't control, so a major redesign may still require an extension update; if your theme stops applying, please [open an issue](https://github.com/jakubkrzysztofsikora/claude-theme/issues).

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
cd claude-theme
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
| `apply` | Apply a theme (compile + notify) | `apply <id\|theme.json>` |
| `compile` | Compile theme to `./extension` | `compile <id\|theme.json> [--out <dir>]` |
| `list` | List all available themes | `list` |
| `validate` | Validate a theme.json file | `validate <id\|theme.json>` |
| `preview` | Preview theme in browser | `preview <id\|theme.json> [port]` |
| `reset` | Remove the applied theme (CLI + Warp), restore defaults | `reset` |
| `init` | Scaffold a new theme (in `./themes`) | `init <theme-name>` |
| `doctor` | Check the CC token set for drift vs the installed Claude Code binary | `doctor` |
| `convert` | Convert a theme to another terminal client (iTerm2 / Alacritty / Kitty / Windows Terminal) | `convert --client <name> <id\|theme.json>` |

The theme argument accepts a built-in theme id or directory name (e.g. `cyberpunk`,
`neon-district`) **or** a path to a `theme.json`. The browser extension is written to
`./extension` in the current directory (override with `compile --out <dir>`).

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for full API documentation.

---

## Claude Code plugin

This repo is also a self-hosted **Claude Code plugin marketplace**. Once the npm package
is published, add it inside Claude Code (v2.1.154+):

```text
/plugin marketplace add jakubkrzysztofsikora/claude-theme
/plugin install whitelabel-theme
```

That installs the `/apply-theme`, `/list-themes`, `/preview-theme`, and `/reset-theme`
slash commands. The commands shell out to the published `claude-whitelabel-themes` npm
package via `npx`, so they require **Node.js ≥ 18** and the package to be **published to
npm first**. (Unofficial — not affiliated with Anthropic.)

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
