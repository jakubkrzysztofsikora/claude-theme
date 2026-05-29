---
description: Apply a white-label Claude theme everywhere (browser + Claude Code CLI + Warp)
argument-hint: <theme-id-or-path>
allowed-tools: Bash(npx:*)
---

Apply the white-label theme `$ARGUMENTS` by running the CLI:

```bash
npx -y claude-whitelabel-themes@^0.1 apply "$ARGUMENTS"
```

Then summarize what changed and the reload steps:
- **Claude Code:** re-pick the theme via `/theme` (or restart).
- **Warp:** fully restart Warp to load the new background + palette.
- **Browser:** load the generated `./extension` via `chrome://extensions/` → Load unpacked.

If `$ARGUMENTS` is empty, ask the user for a theme id (see `/list-themes`) or a path to a theme JSON.
