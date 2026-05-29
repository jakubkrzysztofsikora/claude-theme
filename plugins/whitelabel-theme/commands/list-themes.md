---
description: List the built-in white-label Claude themes
allowed-tools: Bash(npx:*)
---

List the available built-in themes by running:

```bash
npx -y claude-whitelabel-themes list
```

Present the resulting table (id, name, author, tags) to the user, and mention they can
apply one with `/apply-theme <id>` or preview it with `/preview-theme <id>`.
