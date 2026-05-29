---
description: Start a local preview server for a white-label Claude theme
argument-hint: <theme-id-or-path> [port]
allowed-tools: Bash(npx:*)
---

Start the theme preview server for `$ARGUMENTS` (optional trailing port, default 8765):

```bash
npx -y claude-whitelabel-themes preview $ARGUMENTS
```

Tell the user the local URL it prints (e.g. http://localhost:8765) and that it renders a
mock Claude UI with the theme applied. Remind them to stop the server (Ctrl-C) when done.

If `$ARGUMENTS` is empty, ask for a theme id (see `/list-themes`) or a path to a theme JSON.
