# Release & Distribution Checklist

The repo is packaged for distribution (npm + a self-hosted Claude Code plugin
marketplace). The steps below are **manual owner actions** — they require external
accounts / web forms / a live Claude Code, so they are not automated. Do them in order.

> Status legend: ☐ to do · ✅ done in-repo (code/config landed) · 👤 owner action

## Prereqs (✅ landed in-repo)
- ✅ Zero-dependency CLI installs cleanly via npm; output writes to CWD, not `node_modules`.
- ✅ `package.json`: `bin` (`claude-theme` + `claude-whitelabel-themes` alias), `files`
  allowlist (no proprietary/dev/build leak), `engines: node>=18`, real repo URL,
  `prepublishOnly: npm test`.
- ✅ `.claude-plugin/marketplace.json` + `plugins/whitelabel-theme/` plugin (skill + 4
  commands) — installable, npx-backed, version-pinned.
- ✅ Tests: 125 green, incl. a leak-guard (`npm pack` allowlist) and manifest well-formedness.

## 1. npm publish  👤
The plugin commands `npx claude-whitelabel-themes@^0.1 …` are **non-functional until this
is published** (registry currently 404s).
- ☐ `npm whoami` (login if needed: `npm login`).
- ☐ Final pre-flight: `npm pack --dry-run` (confirm 17 files, no leak) and `npm publish --dry-run`.
- ☐ `npm publish` (the `prepublishOnly` hook runs the suite first).
- ☐ Verify: from a clean dir, `npx claude-whitelabel-themes@^0.1 list` works.
- Decision: package name `claude-whitelabel-themes`, bin `claude-theme`, starting at `0.1.0`.

## 2. Self-hosted plugin marketplace — live smoke test  👤
Requires the GitHub repo public at `jakubkrzysztofsikora/claude-theme` and Claude Code ≥ 2.1.154.
- ☐ Push this branch and merge to `main` (or point users at the branch).
- ☐ In Claude Code: `/plugin marketplace add jakubkrzysztofsikora/claude-theme`.
- ☐ `/plugin install whitelabel-theme`; confirm `/apply-theme`, `/list-themes`,
  `/preview-theme`, `/reset-theme` appear and run (needs step 1 done — they npx the package).
- ☐ Verify `/preview-theme` launches in the background and reports a URL without hanging.
- If Warp does not pick a theme up, the activation format may need adjusting (it is
  currently the bare-string `theme = "<name>"` form, verified against a live Warp).

## 3. Anthropic community directory (discoverability)  👤
- ☐ Submit via `clau.de/plugin-directory-submission` (or `claude.ai/settings/plugins/submit`).
- ☐ Repo must be public (✅ MIT). Submission is reviewed (automated validation + safety
  screening); direct PRs to `anthropics/claude-plugins-community` auto-close.
- ⚠️ **Open question to resolve first:** does a tool that shells out and writes to
  `~/.claude` / `~/.warp` clear the automated safety screening? Treat acceptance as
  discretionary; do **not** assume zero-touch updates (the "auto-sync, no re-submission"
  claim was refuted in research — budget for periodic re-validation).
- Inclusion in the official Anthropic-curated marketplace / "Verified" badge is at
  Anthropic's discretion — upside, not a plan.

## 4. Homebrew tap (on request only — lowest priority)  👤
- ☐ Tag a GitHub release (e.g. `v0.1.0`) so a formula has a download tarball.
- ☐ Create a personal tap repo `homebrew-claude-theme` with a formula (no notability bar;
  homebrew-core needs ~225 stars for self-submission — not realistic yet).
- ☐ `brew install jakubkrzysztofsikora/claude-theme/claude-whitelabel-themes`.

## 5. Chrome Web Store (deferred until adoption)  👤
- The generated extension currently has **no icons** (the manifest `icons` block was
  removed because the build doesn't emit PNGs — fine for "load unpacked"). CWS **requires**
  real 16/48/128px PNG icons + a $5 developer account + store review.
- ☐ When pursued: add brand icon PNGs back to the build, add the `icons` block, package,
  submit. Until then, "load unpacked" (`chrome://extensions/` → Load unpacked → `./extension`)
  is the documented path.

## Notes
- `circit.theme.local.json` is gitignored + npm-excluded (proprietary client theme).
- "Unofficial — not affiliated with Anthropic" disclaimer is in the README and plugin SKILL.
