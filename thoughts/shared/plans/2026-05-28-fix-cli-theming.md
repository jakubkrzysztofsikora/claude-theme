---
date: 2026-05-28
commit: a824800
branch: fix/cli-theming
ticket: none
status: implemented (all 5 phases done; 23/23 tests pass; green-lit by harness-dev/senior-eng/QA subagents)
---
# Plan: Fix Claude Code CLI theming in build-theme.js

> **v3** — all 5 decisions resolved; `CC_TOKENS` verified against the installed `claude 2.1.153` binary (`messageActionsBackground` removed as non-existent). See "Decisions" section.
>
> **v2 changelog** — hardened after review by harness-dev / senior-eng / QA adversarial subagents.
> All critical claims were verified against the code. Key corrections, in order of severity:
> 1. **`THEMES_DIR` collision** — `build-theme.js:35` already defines `THEMES_DIR` (repo source dir, used by `cmdList`/`cmdInit`). Adding another `const THEMES_DIR` is a `SyntaxError`. New constant is named **`CLAUDE_THEMES_DIR`**.
> 2. **settings.json corruption guard** — `readJson` returns `null` on any parse failure; the old `readJson() || {}` + full overwrite would wipe `permissions`/`env`/`hooks`/etc. Apply must **abort** if an existing, non-empty settings.json fails to parse, and write **atomically** (temp + rename).
> 3. **bannerAscii lives in 5 places** — `build-theme.js:224` (validator branch) + `:1001`, `README.md:110`, `schema.json:288`, **and `themes/dark/theme.json:55`** (real ASCII banner). All must go together or dark-theme validation breaks (the validator's `else` HEX check would reject the banner string).
> 4. **`base` from theme `tags`, not luminance** — luminance guessing silently downgrades `dark-ansi`/daltonized users.
> 5. **Test isolation** — all verification runs under `HOME=$(mktemp -d)` (HOME read at `build-theme.js:33`) with golden-file snapshots; never touch the dev's real `~/.claude/`.
> 6. **`systemColor`** (present in all 8 themes) and **partial-failure / orphan cleanup** are now addressed.
> Open judgment calls are listed at the bottom.

## Summary
Rewrite the CLI half of the whitelabel-theme tool so it produces a real Claude Code custom theme (`~/.claude/themes/<id>.json` + `theme: "custom:<id>"` string in settings.json) instead of an unrecognized object, then prune the fictional fields and align the schema + docs to the real contract.

## Background / Root Cause
`cmdApply` writes `settings.theme` as an **object** with invented keys (`userMessageColor`, `assistantMessageColor`, `backgroundColor`, `promptColor`, `bannerAscii`). Claude Code CLI ignores all of it because:
- `theme` in `~/.claude/settings.json` must be a **string** enum (`"dark"`, `"light"`, … or `"custom:<slug>"`).
- Custom colors live in `~/.claude/themes/<slug>.json` as `{ name, base, overrides }`, where `overrides` maps a fixed set of token names (e.g. `claude`, `error`, `success`, `promptBorder`, `briefLabelYou`, `userMessageBackground`).
- `bannerAscii` is not a Claude Code feature at all.

Authoritative source: https://code.claude.com/docs/en/terminal-config.md ("Create a custom theme") and https://code.claude.com/docs/en/commands.md (`/theme`).

There is also **no CLI reset** today — `SKILL.md` promises `/reset-theme` clears the CLI config, but reset only exists in the browser extension.

## Token Mapping (theme.json → Claude Code overrides)
Source precedence: `terminal.<x>` → `tokens.color.<y>` → omit if neither present. All values are `#rrggbb`, which Claude Code accepts directly.

| Theme source | Claude Code override token(s) | Notes |
|---|---|---|
| `terminal.promptColor` / `tokens.color.brandPrimary` | `claude`, `promptBorder` | brand accent + input border |
| `terminal.userColor` / `tokens.color.userMessageText` | `briefLabelYou` | "You" speaker label |
| `terminal.assistantColor` / `tokens.color.textPrimary` | `briefLabelClaude`, `text` | assistant label + body text |
| `terminal.errorColor` / `tokens.color.error` | `error` | |
| `terminal.successColor` / `tokens.color.success` | `success` | |
| `tokens.color.warning` | `warning` | |
| `terminal.systemColor` / `tokens.color.brandAccent` | `planMode`, `ide` | was previously dropped; present in all 8 themes |
| `terminal.backgroundColor` / `tokens.color.background` | `userMessageBackground`, `userMessageBackgroundHover`, `bashMessageBackgroundColor`, `memoryBackgroundColor` | CLI has no global bg; apply to the real bg tokens so the theme's bg is honored where Claude Code allows it (per user decision). `*Hover` = same value lightened ~6%. **`selectionBg` deliberately NOT set to the same value** — selection == message bg makes selections invisible. |

> **Token verification (done — decision #1):** all tokens above were grepped against the installed binary `~/.local/share/claude/versions/2.1.153`. Every token is present **except `messageActionsBackground`, which does NOT exist in this version** — it was dropped from the mapping. `CC_TOKENS` in the code must match this verified set. Re-run the grep when targeting a newer Claude Code.

`base` is taken from theme **`tags`** (the schema already provides them): first matching tag wins among `dark-ansi`, `light-ansi`, `dark-daltonized`, `light-daltonized`, `light`, `dark`; fallback `"dark"`. Luminance is NOT used (it would downgrade ansi/daltonized users). Only tokens with a resolved source value are emitted — no nulls.

> **Greyscale status colors (decision #2): pass through.** `minimalist`/`high-contrast` map `error`/`success`/`warning` to near-greys; we emit them verbatim — the theme author is assumed to know what they want. No flooring/clamping.

## Phase 1: Rewrite `cmdApply` CLI output

### Changes

#### File: `.claude/skills/whitelabel-theme/build-theme.js`
- **What**: Replace the object written to `settings.theme` (lines 994-1004) with (a) a generated custom-theme file and (b) a string theme reference.
- **Where**: `cmdApply()` ~line 963-1005; add helpers `buildClaudeCodeTheme`, `lighten`, `pickBase`, an atomic `writeJsonAtomic`, a token allow-list `CC_TOKENS`, and a **`CLAUDE_THEMES_DIR`** constant near `SETTINGS_DIR` (line 37). **Do NOT reuse the name `THEMES_DIR` — it already exists at line 35 (repo source dir).**
- **Rationale**: Matches the real Claude Code contract so the CLI actually applies colors, without corrupting settings.json.
- **Code sketch**:
  ```js
  // new constant near line 37 — distinct name to avoid the line-35 collision
  const CLAUDE_THEMES_DIR = path.join(SETTINGS_DIR, 'themes');

  // pin token names (cite docs date); used both to emit and to assert validity
  // verified against claude 2.1.153 binary — messageActionsBackground is NOT a real token, excluded
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;          // module-level; reused by reset + orphan prune
  const CC_TOKENS = new Set(['claude','promptBorder','briefLabelYou','briefLabelClaude',
    'text','error','success','warning','planMode','ide','userMessageBackground',
    'userMessageBackgroundHover','bashMessageBackgroundColor','memoryBackgroundColor']);
  const VALID_BASES = ['dark-ansi','light-ansi','dark-daltonized','light-daltonized','light','dark'];

  function lighten(hex, amt = 0.06) {            // schema guarantees #RRGGBB
    const n = hex.slice(1);
    const ch = i => Math.round(parseInt(n.slice(i, i + 2), 16) + (255 - parseInt(n.slice(i, i + 2), 16)) * amt);
    return '#' + [0,2,4].map(i => ch(i).toString(16).padStart(2,'0')).join('');
  }
  function pickBase(theme) {
    const tags = (theme.tags || []).map(s => s.toLowerCase());
    return VALID_BASES.find(b => tags.includes(b)) || 'dark';
  }

  function buildClaudeCodeTheme(theme) {
    const t = theme.terminal || {};
    const c = theme.tokens?.color || {};
    const bg = t.backgroundColor || c.background;
    const ov = {};
    const put = (k, v) => { if (v) ov[k] = v; };           // #000000 is truthy → safe
    const brand = t.promptColor || c.brandPrimary;
    put('claude', brand); put('promptBorder', brand);
    put('briefLabelYou', t.userColor || c.userMessageText);
    const assistant = t.assistantColor || c.textPrimary;
    put('briefLabelClaude', assistant); put('text', assistant);
    put('error', t.errorColor || c.error);
    put('success', t.successColor || c.success);
    put('warning', c.warning);
    const accent = t.systemColor || c.brandAccent;
    put('planMode', accent); put('ide', accent);
    if (bg) {
      for (const k of ['userMessageBackground','bashMessageBackgroundColor',
        'memoryBackgroundColor']) put(k, bg);
      put('userMessageBackgroundHover', lighten(bg));      // selectionBg intentionally omitted
    }
    // self-check: every emitted key must be a known token (catches typos/drift)
    for (const k of Object.keys(ov)) if (!CC_TOKENS.has(k)) throw new Error(`unknown CC token: ${k}`);
    return { name: theme.name, base: pickBase(theme), overrides: ov };
  }

  // atomic, comment-safe settings update — inside cmdApply, replacing lines 980-1005:
  const ccTheme = buildClaudeCodeTheme(theme);            // build first; throws before any write
  if (!fs.existsSync(CLAUDE_THEMES_DIR)) fs.mkdirSync(CLAUDE_THEMES_DIR, { recursive: true });

  // CORRUPTION GUARD: abort rather than clobber an existing-but-unparseable settings.json
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    const parsed = readJson(SETTINGS_PATH);
    if (parsed === null) { log('error', `Refusing to overwrite unparseable ${SETTINGS_PATH}`); process.exit(1); }
    settings = parsed;
  }

  // ORPHAN PRUNE (decision #3): if a different whitelabel custom theme was active, delete its file
  const prev = settings.theme;
  if (typeof prev === 'string' && prev.startsWith('custom:')) {
    const prevSlug = prev.slice('custom:'.length);
    if (SLUG_RE.test(prevSlug) && prevSlug !== theme.id) {
      const pf = path.join(CLAUDE_THEMES_DIR, `${prevSlug}.json`);
      if (fs.existsSync(pf)) { fs.unlinkSync(pf); log('info', `Pruned previous theme: ${pf}`); }
    }
  }
  settings.theme = `custom:${theme.id}`;                  // STRING, not object

  // ORDERING: write settings first (atomic); if the themes file then fails, settings still
  // points at a custom theme we can re-generate via re-apply. Theme file is the cheap artifact.
  const themeFile = path.join(CLAUDE_THEMES_DIR, `${theme.id}.json`);
  writeJsonAtomic(SETTINGS_PATH, settings);              // temp + fs.renameSync
  writeJsonAtomic(themeFile, ccTheme);
  log('ok', `Wrote custom theme: ${themeFile}`);
  log('ok', `Set theme: "custom:${theme.id}" in ${SETTINGS_PATH}`);
  ```
- **`writeJsonAtomic`**: write to `${path}.tmp` then `fs.renameSync` over the target (rename is atomic on same filesystem). Replace the direct `writeJson` for settings.json and the theme file.
- **Note on object→object merge**: existing broken installs have `theme` as an OBJECT; `settings.theme = "custom:..."` replaces it wholesale — self-healing. We do NOT spread the old object.
- **Also**: update the "Next steps" console block (lines 1016-1029) — a running Claude Code session does **not** live-reload `theme`; tell the user to restart Claude Code (or re-pick via `/theme`), and note `/theme` writes its own value and can overwrite ours.

### Success Criteria

#### Automated Verification
- [ ] `node .claude/skills/whitelabel-theme/build-theme.js apply themes/cyberpunk/theme.json` exits 0
- [ ] `~/.claude/themes/neon-district.json` exists and is valid JSON with `name`, `base`, `overrides`
- [ ] `node -e "const j=require(require('os').homedir()+'/.claude/settings.json'); if(j.theme!=='custom:neon-district')process.exit(1)"` passes (theme is the exact string)
- [ ] Every key in `overrides` is in the documented token allow-list (assert in a small test script)
- [ ] All `overrides` values match `^#[0-9A-Fa-f]{6}$`

#### Manual Verification
- [ ] In a fresh Claude Code session, `/theme` lists/selects "neon-district" and colors (prompt border, You/Claude labels, error/success) visibly change
- [ ] Settings.json `theme` is honored on startup without errors

### Dependencies
- Requires: nothing
- Blocks: Phase 2 (reset must mirror what apply writes), Phase 4 (docs describe new behavior)

## Phase 2: Add a real CLI reset command

### Changes

#### File: `.claude/skills/whitelabel-theme/build-theme.js`
- **What**: Add `cmdReset()` and wire `reset` into the dispatcher (~lines 1459-1478) and usage text.
- **Where**: new function near `cmdApply`; new `case`/branch in the arg dispatcher.
- **Rationale**: SKILL.md already documents `/reset-theme` for the CLI; today nothing implements it.
- **Code sketch**:
  ```js
  // SLUG_RE defined module-level in Phase 1 (shared with orphan prune)
  function cmdReset() {
    if (!fs.existsSync(SETTINGS_PATH)) { log('info', 'No settings.json; nothing to reset.'); return; }
    const settings = readJson(SETTINGS_PATH);
    if (settings === null) { log('error', `Refusing to touch unparseable ${SETTINGS_PATH}`); process.exit(1); }
    const cur = settings.theme;
    if (typeof cur !== 'string' || !cur.startsWith('custom:')) {
      log('info', 'No whitelabel custom theme active; leaving theme unchanged.');  // e.g. "dark" stays
      return;
    }
    const slug = cur.slice('custom:'.length);
    if (!SLUG_RE.test(slug)) { log('error', `Refusing unsafe theme slug: ${slug}`); process.exit(1); }  // path-traversal guard
    const f = path.join(CLAUDE_THEMES_DIR, `${slug}.json`);
    if (fs.existsSync(f)) { fs.unlinkSync(f); log('ok', `Removed ${f}`); }
    else { log('warn', `Theme file already absent: ${f}`); }
    delete settings.theme;
    writeJsonAtomic(SETTINGS_PATH, settings);
    log('ok', 'Cleared theme; Claude Code reverts to its default.');
  }
  ```
- **Path-traversal guard**: the slug comes from a possibly hand-edited `settings.theme` (e.g. `custom:../../foo`); validate against `SLUG_RE` before any `unlinkSync`.
- **Built-in theme semantics**: if `theme` is a built-in string (`"dark"`), reset deliberately leaves it (we only own `custom:` themes). SKILL.md must be reworded to match (it currently over-promises "clears the CLI config").
- **Orphans (decision #3 — resolved):** `apply` now prunes the previously-referenced custom theme file before writing the new one (see Phase 1 orphan-prune block), so `~/.claude/themes/` doesn't accumulate stragglers. `reset` still removes the currently-referenced file.

### Success Criteria

#### Automated Verification
- [ ] After apply then `... build-theme.js reset`, `~/.claude/themes/neon-district.json` no longer exists
- [ ] `theme` key absent from settings.json after reset
- [ ] `reset` when no theme active exits 0 and changes nothing

#### Manual Verification
- [ ] Claude Code session reverts to default theme after reset

### Dependencies
- Requires: Phase 1 (shares `THEMES_DIR`, mirrors the string format)

## Phase 3: Remove fictional `bannerAscii` (5 locations — verified)

`bannerAscii` is referenced in **five** places (grep-verified). They must change together: removing the validator branch while leaving dark's banner string makes the validator's `else` HEX check reject it → **dark-theme validation breaks**.

### Changes

#### File: `.claude/skills/whitelabel-theme/build-theme.js`
- **What**: (a) `:1001` write of `bannerAscii` is already gone via the Phase 1 rewrite. (b) **Delete the validator branch at lines 224-229** — the `if (key === 'bannerAscii') {...continue;}` block in `validateTheme`. After removal, the loop hex-checks every `terminal.*` value, which is correct once dark's banner is gone.

#### File: `themes/dark/theme.json`
- **What**: Remove the `terminal.bannerAscii` key at line 55 (the multi-line ASCII art). **This is the one shipped theme that uses it** — missed in v1.

#### File: `themes/schema.json`
- **What**: Remove the `bannerAscii` property from `properties.terminal.properties` (line ~288).

#### File: `README.md`
- **What**: Remove/replace the `bannerAscii` claim at line 110 (missed in v1) — it documents the same fictional CLI-banner behavior.

#### Note on the second validator
- `scripts/validate-theme.js` is a **standalone** validator (its own `readJson`/`validateTheme`, does not import build-theme.js and does not read schema.json at runtime). Grep shows it has **no** `bannerAscii` branch, so it already hex-checks the field — meaning dark's banner must be removed for `npm run validate:themes` to pass. Confirm both validators agree after the change.

### Success Criteria

#### Automated Verification
- [ ] `grep -rn bannerAscii . | grep -v thoughts/ | grep -v .git/` returns no matches
- [ ] `npm run validate:themes` passes for ALL themes (esp. `dark`)
- [ ] `node .claude/skills/whitelabel-theme/build-theme.js validate themes/dark/theme.json` passes

#### Manual Verification
- [ ] Schema documents only fields that map to real Claude Code tokens

### Dependencies
- Requires: Phase 1 (rewrite already drops the bannerAscii read at :1001)

## Phase 4: Fix documentation

### Changes

#### File: `.claude/skills/whitelabel-theme/SKILL.md`
- **What**: Correct the CLI theming description.
  - Line 29: change "Terminal colors are synced to `~/.claude/settings.json`" → "A Claude Code custom theme is written to `~/.claude/themes/<id>.json` and selected via `theme: \"custom:<id>\"` in settings.json".
  - Line 47 (architecture diagram `apply` row): reflect themes-dir + string ref.
  - Lines 70-74 ("Behind the scenes"): replace step 2 with the real two-artifact behavior.
  - Reset section (lines 93-97): describe the new `cmdReset` behavior (removes themes file + clears string).
  - Optionally note the token mapping table for theme authors.

### Success Criteria

#### Manual Verification
- [ ] SKILL.md no longer claims object-shaped settings.theme or bannerAscii
- [ ] Described commands match actual build-theme.js dispatcher

### Dependencies
- Requires: Phases 1-3 (docs describe final behavior)

## Phase 5: Isolated test harness (new — was missing)

The original "automated verification" wrote to the dev's **real** `~/.claude/`. `HOME` is read once at `build-theme.js:33`, so a subprocess with `HOME=$(mktemp -d)` fully isolates all writes. Use Node's built-in `node:test` (zero-dep, matches the repo's no-dependency ethos). Lock the mapping with **golden-file snapshots** of the generated `~/.claude/themes/<id>.json` per shipped theme.

### Minimum test matrix
| # | Scenario | Assert |
|---|---|---|
| 1 | apply each of 8 themes (HOME=tmp) | `settings.theme === "custom:<id>"` (string); generated theme file matches committed golden |
| 2 | every emitted override **value** | matches `^#[0-9A-Fa-f]{6}$` (catches a broken `lighten`) |
| 3 | every emitted override **key** | ∈ `CC_TOKENS` (locks the allow-list) |
| 4 | fixture theme with **no `terminal`** block | falls back to `tokens.color`; exercises the otherwise-dead fallback path |
| 5 | fixture with **no background** anywhere | no bg tokens emitted; no `userMessageBackgroundHover`; no nulls |
| 6 | `base` resolution | derived from `tags`, not luminance (fixture with light bg but `dark` tag → `dark`) |
| 7 | existing settings.json with extra keys (`permissions`,`env`) | preserved after apply (corruption guard) |
| 8 | existing **unparseable** settings.json | apply exits non-zero, file untouched |
| 9 | apply → reset | theme file gone, `theme` key absent, exit 0 |
| 10 | reset with `theme:"dark"` | unchanged, exit 0 (pins the chosen semantics) |
| 11 | reset stale `custom:missing` | key cleared, exit 0, no throw |
| 12 | reset `custom:../../etc` | exits non-zero, no unlink outside dir (path-traversal guard) |
| 13 | double reset | exit 0, no throw |
| 14 | `THEMES_DIR` vs `CLAUDE_THEMES_DIR` | are distinct paths (guards against the shadowing regression) |

### Success Criteria
- [ ] `node --test` green
- [ ] Golden files committed under e.g. `.claude/skills/whitelabel-theme/__tests__/golden/`

### Dependencies
- Requires: Phases 1-3.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Override token names drift in future Claude Code versions | Med | Med | Centralize the allow-list in one const; cite docs date in a comment |
| Background tokens look wrong applied uniformly | Med | Low | Only fullscreen-mode backgrounds affected; user opted in. Easy to narrow later |
| Overwriting a user's hand-authored `~/.claude/themes/<id>.json` on id collision | Low | Med | id is namespaced by theme; reset only deletes when settings.theme points to it |
| Existing users have the old broken object in settings.json | High | Low | Phase 1 overwrites `theme` with a string, self-healing on next apply |

## Rollback Strategy
All changes are local to `build-theme.js`, `themes/schema.json`, shipped `theme.json`s, and `SKILL.md`; revert the commit. Runtime artifacts (`~/.claude/themes/<id>.json`, the `theme` string) are removed by the new `reset` command or by hand.

## File Ownership Summary
| File | Phase | Change Type |
|------|-------|-------------|
| .claude/skills/whitelabel-theme/build-theme.js | 1,2,3 | Modify |
| themes/schema.json | 3 | Modify |
| themes/dark/theme.json | 3 | Modify (remove bannerAscii) |
| README.md | 4 | Modify (remove bannerAscii claim) |
| .claude/skills/whitelabel-theme/SKILL.md | 4 | Modify |
| .claude/skills/whitelabel-theme/__tests__/* + golden/ | 5 | Create |

## Decisions (all resolved — ready to implement)
1. **Token verification — DONE.** Grepped `CC_TOKENS` against `claude 2.1.153`; dropped `messageActionsBackground` (not present). All other tokens confirmed real. Re-verify when targeting a newer version.
2. **Greyscale status colors — pass through.** Emit theme values verbatim; assume the author knows what they want. No flooring.
3. **Orphan cleanup — yes.** `apply` prunes the previously-referenced custom theme file (Phase 1 orphan-prune block).
4. **`text` mapping — keep.** `text` (all body text) is mapped to assistant/`textPrimary`.
5. **`systemColor` → `planMode`/`ide` — keep.**
