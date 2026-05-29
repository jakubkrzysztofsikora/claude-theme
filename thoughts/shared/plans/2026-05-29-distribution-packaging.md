---
date: 2026-05-29
commit: 40f876d
branch: feat/distribution-packaging
status: in-progress
---
# Plan: Distribution & Packaging (npm-first, plugin-second)

## Summary
Make the white-label theme tool actually distributable, correcting the errors the
adversarial review found in the research-based plan. Order: **make the CLI installable
(Phase 0) → npm (Phase 1) → self-hosted Claude plugin marketplace done correctly
(Phase 2) → prepare external submissions (Phase 3, manual)**. Autonomous scope is
Phases 0–2 (code/files + tests); Phase 3 is readiness + a checklist (the actual
submissions/accounts are the owner's manual action).

## Why this order (from review)
The tool is a standalone CLI with 3 output targets; **npm is the primary artifact**, the
plugin is a thin discovery wrapper. Nothing may be published until the install-breaking
path bug and the proprietary-leak risk are fixed.

---

## Phase 0 — Make the CLI installable (prerequisite)

### Changes — `.claude/skills/whitelabel-theme/build-theme.js`
- **`EXTENSION_DIR`**: change from `path.resolve(__dirname, "../../../extension")` to
  `path.resolve(CWD, "extension")`. Installed via npm, the old path lands in
  `node_modules` (read-only/ephemeral); CWD-relative writes where the user can find it.
  In-repo (cwd = repo root) it resolves to the same `repo/extension`, so dev + tests are
  unaffected.
- **`init` output dir**: `cmdInit` writes to `THEMES_DIR` (package dir). Change its target
  to `path.resolve(CWD, "themes", id)` so a new theme lands in the user's project, not
  `node_modules`. In-repo (cwd = repo) it's still `repo/themes`.
- **`THEMES_DIR` / `SCHEMA_PATH`**: keep package-relative — `list` showing the bundled
  built-in themes is correct, and the schema ships with the package.
- **`generateManifest`**: remove the `icons` block. The build never emits
  `icon16/48/128.png`, so the manifest references missing files → broken icons on
  "load unpacked" and an automatic Chrome Web Store rejection. A Chrome MV3 manifest is
  valid without `icons` (Chrome shows a default). (CWS, when pursued later, needs real
  PNGs added back.)

### Success criteria
- [ ] `npm test` still green (existing suite unaffected; cwd-relative == repo-relative in tests)
- [ ] From a scratch dir outside the repo: `node <repo>/.claude/.../build-theme.js compile <theme> ` writes `extension/` into the scratch CWD, not the repo/package
- [ ] Compiled `extension/manifest.json` has no `icons` key; loads in Chrome dev mode without broken-icon errors (manual)

### Dependencies: none. Blocks: Phase 1, 2.

---

## Phase 1 — npm packaging

### Changes — `package.json`
- Add `"bin": { "claude-theme": ".claude/skills/whitelabel-theme/build-theme.js" }`
  (file already has `#!/usr/bin/env node`).
- Add `"files"` allowlist: the 3 skill JS modules + SKILL.md, `themes/`, `README.md`,
  `LICENSE` — and NOTHING else. This is the leak fix: it excludes
  `circit.theme.local.json` (`"license":"Proprietary"`), `marketplace/` (React app),
  `thoughts/`, `docs/`, `__tests__/`, `extension/`.
- Add `"engines": { "node": ">=18" }`.
- Fix `"repository.url"` → `https://github.com/jakubkrzysztofsikora/claude-theme.git`.
- Keep package name `claude-whitelabel-themes`; the `bin` is the short ergonomic name
  (`claude-theme`). Verify the name is free on npm (`npm view`).

### Changes — `README.md`
- Replace every `your-username` placeholder (clone URL + GitHub Pages link, ~3 places)
  with `jakubkrzysztofsikora` / repo `claude-theme`.
- Add an "Unofficial — not affiliated with Anthropic" line (trademark hygiene for a
  `claude`-named tool) and an `npx claude-theme …` quick-start.

### Success criteria
- [ ] `npm pack --dry-run` tarball contains ONLY the allowlisted files; assert it does
  NOT contain `circit.theme.local.json`, `marketplace/`, `thoughts/`, `__tests__/`
- [ ] `npm publish --dry-run` succeeds
- [ ] Clean-room smoke test: `npm pack` → install the tarball into a temp dir →
  `npx claude-theme list` and `… validate <theme>` run without `MODULE_NOT_FOUND` and
  without writing into the install dir
- [ ] `npm test` still green

### Dependencies: Phase 0. Blocks: Phase 3.

---

## Phase 2 — Self-hosted Claude plugin marketplace (done correctly)

### Changes — new files
- **`.claude-plugin/marketplace.json`**: `{ name, owner:{name,...}, plugins:[{ name,
  source:"./" , description }] }`. Pick a non-reserved marketplace name (NOT
  `claude-plugins-official` etc.).
- **`.claude-plugin/plugin.json`**: declare the plugin; point components at the existing
  layout via explicit paths — `"skills": "./.claude/skills/"`, `"commands": "./commands/"`
  — so no skill relocation is needed (review BLOCKER 1 fix).
- **`commands/` directory** with the 4 command files the SKILL.md advertises but that do
  not exist (review BLOCKER 2): `apply-theme.md`, `list-themes.md`, `preview-theme.md`,
  `reset-theme.md`. Each invokes the bundled CLI via `${CLAUDE_PLUGIN_ROOT}/.claude/
  skills/whitelabel-theme/build-theme.js` so the command works after a plugin install
  (the script is in the plugin cache, not on PATH).
- **`SKILL.md` frontmatter**: ensure `name:` + `description:` (drop/auggment non-standard
  `title:` if present) so the skill namespaces correctly.

### Distinct-from note
The repo's existing `marketplace/` (React theme-browser website) is unrelated to the
Claude plugin marketplace — do not touch it; do not conflate.

### Success criteria
- [ ] `.claude-plugin/marketplace.json` + `plugin.json` validate against the current
  Claude Code plugin schema (subagent-verified against the docs)
- [ ] The 4 `commands/*.md` exist and reference `${CLAUDE_PLUGIN_ROOT}` (no hardcoded paths)
- [ ] **Manual (owner):** `/plugin marketplace add jakubkrzysztofsikora/claude-theme` then
  `/plugin install …` in Claude Code ≥2.1.154 installs and the commands run
- [ ] `npm test` still green (no regression; new files aren't shipped to npm)

### Dependencies: Phase 0. (Independent of Phase 1.)

---

## Phase 3 — External submissions (READINESS ONLY — owner executes)

Not autonomous (web forms / external accounts). Deliver a `RELEASE.md` / checklist:
- Community directory: submit via `clau.de/plugin-directory-submission` AFTER a live
  `/plugin marketplace add` smoke test. Open question to resolve first: does a
  file-writing/shell-out CLI clear automated safety screening? Treat acceptance as
  discretionary; do NOT assume zero-touch updates (the "auto-sync" claim was refuted 0-3).
- Homebrew: personal tap only, on request — needs a tagged GitHub release first.
- Chrome Web Store: deferred until adoption; needs real icons (Phase 0 removed the broken
  refs) + $5 account + review.

### Success criteria
- [ ] `RELEASE.md` checklist committed; no code changes

---

## Risk register
| Risk | Mitigation |
|---|---|
| npm tarball leaks `circit.theme.local.json` (Proprietary) | `files` allowlist + `npm pack` assertion (Phase 1) |
| `npx` fails because output paths hit `node_modules` | Phase 0 CWD-relative output + clean-room smoke test |
| Broken extension icons | Phase 0 removes the `icons` block |
| Plugin commands non-functional | Phase 2 creates real `commands/*.md` via `${CLAUDE_PLUGIN_ROOT}` |
| Plugin/marketplace schema drift (ecosystem launched ~May 2026, pinned 2.1.154) | Subagent-verify against current docs; owner live-tests before announcing |
| Conflating repo `marketplace/` website with plugin marketplace | Explicit non-touch note |

## Rollback
All changes are additive or path-localized; `git revert` per phase. New branch
`feat/distribution-packaging` keeps it isolated from `main`.
