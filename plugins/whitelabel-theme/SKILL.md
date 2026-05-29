---
name: whitelabel-theme
description: Use when the user wants to apply, preview, list, reset, or build a custom "white-label" theme for Claude — changing the claude.ai browser UI colors, Claude Code terminal/CLI colors, and/or Warp terminal colors. Triggers on "apply a theme", "change Claude's theme", "build a theme", "Circit theme", "reset my theme".
---

# White-Label Theme Manager

Themes Claude across three channels from one theme JSON: the **claude.ai browser UI**
(a generated Chrome extension), **Claude Code terminal colors** (`~/.claude`), and the
**Warp** terminal (`~/.warp`).

This plugin is a thin wrapper over the zero-dependency **`claude-whitelabel-themes`** CLI,
invoked with `npx` (no global install needed; `npx -y` fetches it on first use).

## Commands

- `/apply-theme <id-or-path>` — apply a theme everywhere (CLI + Warp + browser extension)
- `/list-themes` — list the built-in themes
- `/preview-theme <id-or-path> [port]` — start a local preview server
- `/reset-theme` — restore defaults (removes the applied CLI/Warp theme)

## How to run (for any of the above)

Use the Bash tool to call the CLI, passing the user's argument through:

```bash
npx -y claude-whitelabel-themes <command> [args]
```

For example, applying: `npx -y claude-whitelabel-themes apply "<id-or-path>"`.

After **apply**: tell the user to re-pick the theme via `/theme` in Claude Code (or
restart) and to **reload/restart Warp**; for the browser, load the generated `extension/`
directory via `chrome://extensions/` → Load unpacked. After **reset**: the prior theme is
restored. Building a brand-new theme uses `npx -y claude-whitelabel-themes init "<Name>"`.

## Notes

- Requires Node.js ≥ 18 (for `npx`).
- The browser extension is written to `./extension` in the current directory
  (override with `compile --out <dir>`).
- Unofficial — not affiliated with Anthropic.
