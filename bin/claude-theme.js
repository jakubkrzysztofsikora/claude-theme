#!/usr/bin/env node
"use strict";

// Stable published entrypoint for the `claude-theme` CLI. Kept as a thin wrapper so the
// public bin contract is decoupled from the internal skill layout (the engine may move
// within .claude/skills/ without breaking installs).
require("../.claude/skills/whitelabel-theme/build-theme.js").main();
