---
description: Reset Claude to default — remove the applied white-label CLI/Warp theme
allowed-tools: Bash(npx:*)
---

Reset to defaults by running:

```bash
npx -y claude-whitelabel-themes reset
```

This removes the applied Claude Code custom theme and restores the prior Warp theme
(`~/.warp/settings.toml`), deleting the generated Warp theme file. Tell the user to
re-pick a theme via `/theme` in Claude Code if they want a non-default one, and to
restart Warp. The browser extension is unaffected (remove it in `chrome://extensions/`).
