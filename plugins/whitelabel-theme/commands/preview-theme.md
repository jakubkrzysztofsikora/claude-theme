---
description: Start a local preview server for a white-label Claude theme
argument-hint: <theme-id-or-path> [port]
allowed-tools: Bash(npx:*)
---

Start the theme preview server for `$ARGUMENTS` (optional trailing port, default 8765).

**The preview server is long-running and blocks** — launch it in the BACKGROUND (use the
Bash tool's background mode / `run_in_background`), do not run it in the foreground:

```bash
npx -y claude-whitelabel-themes@^0.1 preview $ARGUMENTS
```

Once it reports a URL (e.g. http://localhost:8765), give that URL to the user and tell
them it renders a mock Claude UI with the theme applied. Remind them you can stop the
background server when they're done (kill the background task).

If `$ARGUMENTS` is empty, ask for a theme id (see `/list-themes`) or a path to a theme JSON.
