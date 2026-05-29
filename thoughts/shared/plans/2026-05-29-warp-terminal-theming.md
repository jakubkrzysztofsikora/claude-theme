---
date: 2026-05-29
commit: 3d56aa8
branch: feat/full-token-cli-theme
ticket: none
status: draft
---
# Plan: Automatic Warp Terminal Theming

## Summary
Add a Warp terminal channel to the whitelabel build pipeline: generate a matching
Warp theme YAML for every theme and activate it via a line-preserving edit of
`~/.warp/settings.toml`, with symmetric `reset` cleanup and a per-theme `deriveAll`
rollout. Implements `docs/superpowers/specs/2026-05-29-warp-theming-design.md`.

## Research / spec references
- Spec: `docs/superpowers/specs/2026-05-29-warp-theming-design.md` (twice adversarially reviewed)
- Reused helpers: `.claude/skills/whitelabel-theme/cli-derive.js` exports
  `parseHex, toHex, mix, lighten, relLuminance, contrastRatio, contrastFloor`
- Existing patterns: `build-theme.js` `buildClaudeCodeTheme` (:323), `writeJsonAtomic`
  (:256), `SLUG_RE`/path constants (:34–47), `cmdApply` (:1473), `cmdReset` (:1586),
  `cmdInit` (:1957); golden tests in `__tests__/cli-theming.test.js` (subprocess +
  isolated `HOME`, goldens in `__tests__/golden/<id>.json` via `assert.deepEqual`).

## Pre-flight
- Working tree has an uncommitted edit `themes/nature/theme.json` (deriveAll+base added
  earlier). That is part of this work (nature is "already on" per spec). Commit it with
  Phase 3.

---

## Phase 1 — Pure `warp-channel.js` module (no I/O)

### Changes

#### File: `.claude/skills/whitelabel-theme/warp-channel.js` (Create)
- **What**: A dependency-light, **pure** module: the Warp YAML emitter + the TOML
  line-editor. No `fs`/`os`/`process` — string in, string out — so it unit-tests in
  isolation exactly like `cli-derive.js`.
- **Exports**: `resolveHex`, `buildWarpTheme`, `locateThemeValue`, `replaceThemeValue`,
  `insertThemeKey`, `removeThemeValue`, `warpActivationLine`, and `MIN_ANSI = 3.0`.
- **Reuse**: `require("./cli-derive")` for `parseHex, toHex, mix, lighten, relLuminance,
  contrastFloor`.

- **`resolveHex(value, fallbackHex)`** — normalize any accepted color form to `#rrggbb`:
  ```js
  // #rgb / #rrggbb -> parseHex/toHex; rgb(r,g,b) -> toHex; ansi:/ansi256() -> fallback;
  // absent/unparseable -> fallback (which MAY be undefined -> caller omits the slot)
  function resolveHex(value, fallbackHex) {
    if (typeof value === "string") {
      const v = value.trim();
      if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) return toHex(parseHex(v));
      const m = v.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
      if (m) return toHex({ r: +m[1], g: +m[2], b: +m[3] }); // clamp8 inside toHex
      // ansi: / ansi256() have no RGB -> fall through to fallback
    }
    return fallbackHex; // may be undefined
  }
  ```
  - **Rationale**: `cli-derive.parseHex` is hex-only (throws on `rgb()`/`ansi:`), so the
    conversion lives here. Eliminates the `lighten("ansi:…") = #NaN` bug (spec B2).

- **`buildWarpTheme(theme, ccTheme) -> string`** — deterministic YAML:
  ```js
  const c = (theme.tokens && theme.tokens.color) || {};
  const t = theme.terminal || {};
  // background is a REQUIRED token (validateTheme guarantees hex tokens.color.background),
  // so bg is always defined for a valid theme; assert as a tripwire for the degenerate path.
  const bg = resolveHex(ccTheme.overrides.userMessageBackground, resolveHex(c.background));
  if (!bg) throw new Error("buildWarpTheme: unresolved background"); // can't happen for valid themes
  const fg = resolveHex(t.assistantColor, resolveHex(c.textPrimary));
  // slot() MUST be declared before first use — it's a const arrow (NOT hoisted); the
  // `accent` line below references it (round-4 fixed a TDZ ReferenceError here).
  const slot = (...chain) => chain.reduce((acc,v)=>acc ?? resolveHex(v), undefined); // omit if undefined
  const accent = slot(t.promptColor, c.brandPrimary);              // emitted top-level
  const details = relLuminance(bg) < 0.5 ? "darker" : "lighter";   // KEYWORD, not a color

  // Absolute ANSI anchors by POLARITY, not contrastFloor (which would invert them:
  // on a dark bg contrastFloor pushes the dark candidate toward WHITE — review C1/B1).
  // The 0.15/0.85 guards are a single best-effort nudge; the ONLY hard contract is the
  // polarity the test-23 oracle checks (don't assert >=0.85 — a mid-tone candidate may
  // land ~0.69 after one mix, which still satisfies the oracle).
  const byLum = (...hx) => hx.filter(Boolean).sort((a,b)=>relLuminance(a)-relLuminance(b));
  const cands = byLum(resolveHex(c.textPrimary), resolveHex(c.surface), bg);
  let black = cands[0];                                  // darkest available
  if (relLuminance(black) > 0.15) black = mix(black, "#000000", 0.6); // force genuinely dark
  let white = cands[cands.length-1];                     // lightest available
  if (relLuminance(white) < 0.85) white = mix(white, "#ffffff", 0.6); // force genuinely light
  const normal = {
    black, white,
    red: slot(t.errorColor, c.error),       green: slot(t.successColor, c.success),
    yellow: slot(c.warning),                blue: slot(t.systemColor, c.brandAccent),
    magenta: slot(c.textSecondary, c.brandPrimary), cyan: slot(t.userColor, c.brandPrimary),
  };
  const bright = {};                                     // explicit loop — no lodash mapValues
  for (const [k, h] of Object.entries(normal)) if (h) bright[k] = lighten(h, 0.25); // clamps at #ffffff
  // Emit YAML in Warp's REAL shape (cf. ~/.warp/themes/forest_canopy.yaml):
  //   accent/background/foreground: single-quoted hex; details: <keyword>;
  //   name: "<double-quoted YAML scalar, escaped>";
  //   terminal_colors:\n  normal: {…}\n  bright: {…}   — omit any undefined slot.
  // ALL hex emitted LOWERCASE (toHex/lighten already produce lowercase; case-23 asserts
  // /^#[0-9a-f]{6}$/). Do NOT expect casing parity with the hand-written forest_canopy.yaml
  // (which is uppercase) — the golden must match the emitter's lowercase output.
  ```
  - **Where**: new file. `slot`/`mix`/`relLuminance`/`lighten` from `cli-derive`.
  - **Rationale**: `background` from the already-built `ccTheme` guarantees Warp bg == CC
    block bg. **Anchors use polarity + a forced dark/light pole** — `contrastFloor` is the
    wrong primitive here (it targets the higher-headroom extreme, inverting "black" on
    dark themes — confirmed via cyberpunk `#0A0612 → #6c6a71`). For a near-black bg, ANSI
    `black` legitimately can't clear 3:1 vs bg (it reads against light text, not bg), so
    **no contrast floor is applied to the anchors** — only a luminance-pole guarantee.

- **`locateThemeValue(text) -> {start,end,valueText,indent,eol} | {kind:'missing'} | {kind:'malformed'}`**
  - Char-level scanner. Detect EOL (`\r\n` vs `\n`). Find section header matching
    `/^\[appearance\.themes\]\s*$/` on a trimmed line; body ends at next `/^\s*\[/` header
    or EOF. Within body find a line whose trimmed text matches `/^theme\s*=/`.
  - Value extent from first non-ws after `=` (across newlines):
    `{` → brace-depth scan, tracking basic `"…"` (with `\"`), literal `'…'` (no escape),
    `#`-to-EOL comments; **bail** (`malformed`) on `"""`/`'''` or EOF with depth>0.
    `"`/`'` → to matching close on the logical line. bare → to EOL.
  - **Rationale**: handles the real `settings.toml` (nested inline table + trailing comma
    + `[privacy]` single-quoted regex braces). See spec "TOML line-editor".

- **`replaceThemeValue(text, newValueLine)`** / **`insertThemeKey(text, line)`** /
  **`removeThemeValue(text, loc, { removeEmptySection })`** — splice only the located
  extent (replace), or insert after header / append a new `[appearance.themes]` section at
  EOF (insert), or delete the `theme` line(s) (remove). All preserve indent, EOL,
  trailing-newline. Bail if a `theme` key exists under a different table (`[appearance]`).
  - **`removeThemeValue` is required** by the `originalValueText: null` restore (test 8)
    and the additive-insert reset (test 33) — there is no other way to undo an insert
    (review M2).
  - **Section-removal is caller-driven, not inferred (round-4):** a pure function cannot
    tell from text alone whether *we* created `[appearance.themes]`. `insertThemeKey`
    reports whether it created the header; `activateWarpTheme` records that as
    `sectionInserted` in state. On reset, `removeThemeValue` is called with
    `removeEmptySection: state.sectionInserted` and only drops the header when **the
    section body is otherwise empty**. This protects the real-file case (header holds both
    `theme` and a `system_theme` sibling) — the sibling and header survive.

- **`warpActivationLine(theme, yamlPath)`** →
  `theme = { custom_<id-with-underscores> = { name = "<escaped>", path = "<yamlPath>" } }`
  using the file's indent.

### Success Criteria
#### Automated Verification
- [ ] New tests pass: `npm test` (file `__tests__/warp-channel.test.js`)
- [ ] TOML-editor **pure** cases 10–17 (10 nested table+trailing comma; 11 `[privacy]` braces
      ignored; 12 siblings; 13 duplicate-in-`[appearance]` → bail; 14 CRLF/no-newline;
      15 whitespace variants; 16 comment-brace; 17 malformed/`"""` → bail). *(18/19/19a are
      Phase-2 — they need the I/O round-trip + `.bak`.)*
- [ ] `removeThemeValue` pure cases: (a) delete a self-inserted empty `[appearance.themes]`
      section (`removeEmptySection:true`, body empty → header gone); (b) **delete a `theme`
      line that sits beside a `system_theme` sibling (`removeEmptySection:true` but body
      NOT empty) → sibling AND header survive** (real-file case); (c)
      `removeEmptySection:false` → header always kept. Backs tests 8 & 33.
- [ ] `buildWarpTheme` pure cases 20, 21, 22, 23, 24, 25, 26a against the real-file fixture + all 8 bundled themes
- [ ] Case 22 (`warp.background === resolveHex(cc.userMessageBackground ?? tokens.color.background)`) for every bundled theme
- [ ] **`accent` oracle (round-4):** per theme `accent === resolveHex(t.promptColor ?? c.brandPrimary)` and matches `/^#[0-9a-f]{6}$/` (else a wrong source mapping bakes silently into the golden)
- [ ] Case 23 **(corrected oracle — review C2):** every ANSI value (incl. `accent`) matches
      `/^#[0-9a-f]{6}$/`; polarity holds: `relLuminance(normal.black) < 0.5 <
      relLuminance(normal.white)` for **every** theme incl. high-contrast/minimalist, **plus
      a separation gate `relLuminance(white) − relLuminance(black) > 0.3`** (so a monochrome
      theme can't pass the split by a hair). *No contrast-vs-bg bound on the anchors.*
- [ ] Case 24 (`rgb()` → hex; `ansi:`/`ansi256()` → the **specific** `tokens.color` fallback hex; never `#NaN`)
- [ ] Case 25 (name `"Solarized: Dark"` → valid YAML scalar + TOML string; unicode/emoji UTF-8-valid)
- [ ] Case 26a (`deriveAll:false` theme omitting error/success/warning → those slots omitted, no `#NaN`)
#### Manual Verification
- [ ] Eyeball one emitted YAML (e.g. nature) vs the real `~/.warp/themes/forest_canopy.yaml`
      for structural parity (`terminal_colors:` nesting, single-quoted hex, `details` keyword)

### Dependencies
- Requires: nothing (pure; imports only `cli-derive.js`)
- Blocks: Phase 2, Phase 3

---

## Phase 2 — I/O wiring in `build-theme.js`

### Changes

#### File: `.claude/skills/whitelabel-theme/build-theme.js`

- **Constants** (near :34–47): add — **reuse the existing `HOME` constant** (`build-theme.js:34`
  defines `const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp"`); do **not**
  introduce `require("os")`/`os.homedir()` (review m1/M1 — divergent home resolution).
  ```js
  const WARP_DIR = path.join(HOME, ".warp");                  // same HOME the CC paths use
  const WARP_THEMES_DIR = path.join(WARP_DIR, "themes");
  const WARP_SETTINGS = path.join(WARP_DIR, "settings.toml");
  const WARP_STATE = path.join(WARP_THEMES_DIR, ".whitelabel-state.json");
  const WARP_BAK = path.join(WARP_DIR, "settings.toml.whitelabel.bak");
  const warp = require("./warp-channel");
  ```
  - `crypto` (for the sha256 concurrency hash) is already required at the top of the file;
    no new requires beyond `./warp-channel`.

- **`writeTextAtomic(filePath, text)`** (new, near `writeJsonAtomic` :256):
  ```js
  function writeTextAtomic(filePath, text) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true }); // dir may not exist (minimal-file branch)
    const tmp = `${filePath}.${process.pid}.tmp`;              // SAME dir -> intra-fs rename
    let mode;
    try { mode = fs.statSync(filePath).mode; } catch {}
    fs.writeFileSync(tmp, text);
    if (mode !== undefined) fs.chmodSync(tmp, mode);           // preserve perms (e.g. 0600)
    if (process.env.WL_WARP_FAULT === "crash-before-rename") throw new Error("injected"); // TEST SEAM (test 19)
    fs.renameSync(tmp, filePath);
  }
  ```

- **`writeWarpTheme(theme, ccTheme)`** (new): `SLUG_RE`-assert `theme.id`; `mkdir -p
  WARP_THEMES_DIR`; `writeTextAtomic(<dir>/<id>.yaml, warp.buildWarpTheme(theme, ccTheme))`;
  return the path.

- **`activateWarpTheme(theme, yamlPath, ccTheme)`** (new) — exactly the spec state model:
  1. `settings.toml` absent → create minimal (`[appearance.themes]\n` + activation line),
     write state `{activeId, yamlPath, originalValueText:null, sectionInserted:true}`;
     return `{activated:true}`.
  1a. minimal-file branch must `fs.mkdirSync(WARP_DIR,{recursive:true})` (and `WARP_THEMES_DIR`
     for the state file) before writing.
  2. read text; `hash0 = sha256(text)`; `loc = warp.locateThemeValue(text)`.
  3. if `loc.kind==='malformed'`/`'duplicate'` → return `{activated:false, reason, line}` (no write).
  4. baseline guard: `originalValueText = stateExists ? state.originalValueText :
     (loc.valueText ?? null)`. If current value already equals the activation line →
     return `{activated:true, noop:true}` (no write, state untouched).
  5. write `WARP_BAK` only if absent (snapshot of the step-2 text = the pre-automation file).
  6. **TEST SEAM (test 29):** `if (process.env.WL_WARP_FAULT==='mutate-settings')
     fs.appendFileSync(WARP_SETTINGS, "\n# concurrent edit")` — runs exactly here, between
     locate and the re-stat, gated by env so it's inert in production.
  7. **concurrency:** re-read `settings.toml`; if `sha256 !== hash0` → return
     `{activated:false, reason:'changed', line}` (YAML already written; settings untouched
     so the concurrent edit survives).
  8. `{text:newText, sectionInserted} = loc.kind==='missing' ? warp.insertThemeKey(...) :
     {text: warp.replaceThemeValue(...), sectionInserted:false}`; `writeTextAtomic(WARP_SETTINGS,
     newText)`; write/refresh state — **preserve `originalValueText`; record `sectionInserted`**
     (true only when we created the `[appearance.themes]` header, incl. the minimal-file branch).
  - Returns a result object; **never throws** on the expected branches (only the injected
    `crash-before-rename` seam throws, exercised by test 19).

- **`deactivateWarpTheme(slugHint)`** (new):
  1. read state if present; `activeId = SLUG_RE.test(state?.activeId) ? state.activeId :
     (SLUG_RE.test(slugHint) ? slugHint : null)`; if null → return.
  2. if `settings.toml` readable: `loc = locateThemeValue`; **restore only if** current
     value matches what we wrote (`custom_<activeId>` + our yamlPath); then
     `state.originalValueText != null` → `warp.replaceThemeValue` with it; else
     `warp.removeThemeValue(text, loc, { removeEmptySection: state.sectionInserted })`
     (undo our insert, keeping the header iff it pre-existed) → `writeTextAtomic`.
  3. delete `WARP_THEMES_DIR/<activeId>.yaml` if it sits within `WARP_THEMES_DIR` (`unlink`,
     ignore ENOENT); delete `WARP_STATE`. Leave `WARP_BAK`.

- **`cmdApply`** (:1473) — after the existing `cmdCompile(themeFilePath)` (line ~1544),
  before the success block:
  ```js
  const yamlPath = writeWarpTheme(theme, ccTheme);     // ccTheme already built at :1492
  const warpRes = activateWarpTheme(theme, yamlPath, ccTheme);
  ```
  Extend the success output: a Warp section. **If `!warpRes.activated`**, print
  *"Warp theme written but NOT activated"* + the exact `warpRes.line` to paste (spec M2).

- **`cmdReset`** (:1586) — **insert at the very top, before all early returns** (spec N1).
  To avoid the double-read + duplicate parse-error log (review m2), read `settings.json`
  **once** here and thread the parsed object into the existing logic rather than letting
  it re-read:
  ```js
  function cmdReset() {
    // Warp cleanup runs first & unconditionally, capturing the CC slug while it exists.
    const pre = fs.existsSync(SETTINGS_PATH) ? readJson(SETTINGS_PATH) : null; // readJson logs+returns null on bad JSON
    const slugHint = (pre && typeof pre.theme === "string" && pre.theme.startsWith("custom:"))
      ? pre.theme.slice("custom:".length) : undefined;
    deactivateWarpTheme(slugHint);
    // ...existing CC reset logic, reusing `pre`. CRITICAL: readJson returns null for BOTH
    //    absent and unparseable, so split them explicitly to preserve current behavior:
    //      !fs.existsSync(SETTINGS_PATH) -> log "nothing to reset", return (exit 0)
    //      pre === null (exists but bad JSON) -> log error, process.exit(1)
    //    then the unchanged "no custom: theme" no-op + theme-file removal branches.
  }
  ```

- **`cmdInit`** (:1957) — the template **already has a `terminal` block** (`build-theme.js:2014`:
  `userColor/assistantColor/backgroundColor/promptColor`). **Extend it in place** (do not
  add a second — duplicate key, last wins) so a new theme gets full CC derivation + Warp
  output. Add `deriveAll: true`, `base: "dark"`, `systemColor`, `errorColor`, `successColor`:
  ```js
  terminal: {
    deriveAll: true, base: "dark",
    userColor: "#6366f1", assistantColor: "#e0e0ff", systemColor: "#818cf8",
    errorColor: "#ef4444", successColor: "#22c55e",
    backgroundColor: "#0f0f23", promptColor: "#6366f1",
  },
  ```
  (Also add `brandAccent` to the template's `tokens.color` — it currently has
  `brandSecondary`, but the Warp `normal.blue` / `accent` chain and `deriveAll` read
  `brandAccent`.)

### Success Criteria
#### Automated Verification
- [ ] `npm test` green (new integration cases in `__tests__/warp-io.test.js`, isolated `HOME`)
- [ ] Lifecycle **1–9, all enumerated** — 1 (A→B→reset restores pre-automation original),
      2 (idempotent byte-identity), **3 (double-reset no-op)**, **4 (reset no prior apply →
      no-op, proves the N1 unconditional-first call is safe)**, **5 (delete YAML then reset →
      no throw, settings still restored)**, 6 (orphan cleanup via slugHint), **7 (insert
      lines above section → reset re-locates by content)**, 8/9 (minimal-file content +
      reset-to-no-`theme`-key)
- [ ] Concurrency **29** via `WL_WARP_FAULT=mutate-settings` seam → not-activated + paste-line
      + the concurrent edit survives in `settings.toml`. **Injection mechanism (round-4):**
      the existing `run(home, args)` helper forwards `process.env` but takes **no** per-call
      `env` override — `warp-io.test.js` must either add an `env` param to its own `run`
      copy or `process.env.WL_WARP_FAULT = …` / `delete` around each call (set-and-restore).
- [ ] Not-activated branches **30** (unreadable / malformed / duplicate-in-`[appearance]`):
      YAML written + paste-line printed + no false "applied successfully"
- [ ] Round-trip **18** (original → activate → deactivate → byte-identical to the real-file
      fixture) + **19** crash-injection via `WL_WARP_FAULT=crash-before-rename` (original
      intact, no partial) + **19a** `.bak` byte-identical to pre-automation file
- [ ] Mode **32** (chmod 0600 → still 0600 after rewrite)
- [ ] Additive insert **33** (no `[appearance.themes]` → append at EOF; reset removes exactly those)
- [ ] **26** (validation-forbidden name → `apply` exits non-zero before `buildWarpTheme`)
- [ ] Existing CC apply/reset tests still pass (no regression to `cmdApply`/`cmdReset`)
#### Manual Verification
- [ ] On a real machine: `apply nature` → Warp reloads to Forest Canopy (confirms the
      `theme = { custom_<slug> = {…} }` format is honored — the spec's open item); if not,
      switch `warpActivationLine` to bare-string and re-run
- [ ] `reset` returns `~/.warp/settings.toml` to the prior theme; YAML + state removed

### Dependencies
- Requires: Phase 1
- Blocks: Phase 3 (uses `buildWarpTheme` for golden emission)

---

## Phase 3 — `deriveAll` rollout + golden regeneration

### Changes

#### File: `.claude/skills/whitelabel-theme/build-theme.js` — `cmdCompile` (:1428) + `main()` (:2051)
- **What**: add a `--emit-golden` path that writes both goldens for a theme:
  `__tests__/golden/<id>.json` (CC) and `__tests__/golden/warp/<id>.yaml` (Warp).
- **Plumbing (sketch is otherwise insufficient — review HIGH):** `cmdCompile` currently
  takes one arg and `main()`'s `compile` case passes only `args[1]`. Change to
  `cmdCompile(themeFilePath, { emitGolden = false } = {})`; in `main()` detect
  `args.includes("--emit-golden")`. In the `emitGolden` branch, **build `ccTheme` first**
  (`cmdCompile` does NOT today — it only emits the extension): `const ccTheme =
  buildClaudeCodeTheme(theme)`, write `golden/<id>.json` from it, then write
  `golden/warp/<id>.yaml` from `warp.buildWarpTheme(theme, ccTheme)`.
- **Rationale**: goldens are currently hand-maintained; a defined emit command makes the
  rollout diff the review artifact (spec M1).

#### Theme files (Modify): set `"deriveAll": true` in the `terminal` block
- `themes/branded/theme.json`, `themes/dark/theme.json`, `themes/high-contrast/theme.json`,
  `themes/light/theme.json`, `themes/warm-neutral/theme.json`
- `themes/nature/theme.json` — already edited (commit the working-tree change here)
- **Leave `themes/minimalist/theme.json` OFF** (monochrome intent); cyberpunk already on.
- Each must have a `terminal` block with the friendly fields; add one where missing.

#### Golden files (Create/Modify)
- Regenerate via `node build-theme.js compile <theme.json> --emit-golden` for the 5 (or 4)
  flipped themes + emit `golden/warp/<id>.yaml` for all 8.

### Success Criteria
#### Automated Verification
- [ ] **27** every bundled theme passes `validateTheme` with its `deriveAll` setting
- [ ] **28 (recompute-and-compare — review HIGH, mirrors the CC golden test at
      `cli-theming.test.js:163`):** for every bundled theme,
      `assert.equal(warp.buildWarpTheme(theme, buildClaudeCodeTheme(theme)),
      readFileSync(golden/warp/<id>.yaml))` — so the committed Warp golden can never drift
      from the emitter. CC goldens asserted as today; `minimalist` CC golden unchanged
      (14 keys), its Warp golden present. Plus: `compile --emit-golden` output is
      byte-identical to the in-process `buildWarpTheme` (closes emit-vs-assert drift).
- [ ] **31 (concrete thresholds — review HIGH).** Measure with `contrastRatio` from
      `cli-derive`:
      - high-contrast: CC `text` ≥ **7:1** vs `tokens.color.background`; CC
        `diffAdded`/`diffRemoved` ≥ **4.5:1** vs background (chromatic — 7:1 unreachable);
        Warp `foreground` ≥ **7:1** and `normal.white` ≥ **7:1** vs Warp `background`.
      - light: CC `text` ≥ **4.5:1** vs background; Warp `foreground` ≥ **4.5:1** vs Warp bg.
      If high-contrast misses its floors → set its `deriveAll` off (rollout 5→4).
- [ ] `npm test` fully green
#### Manual Verification
- [ ] Review the golden diff — confirm the 5 themes' richer palettes look intended, not regressed

### Dependencies
- Requires: Phase 1, Phase 2
- Blocks: nothing

---

## Phase 4 — Documentation

#### File: `.claude/skills/whitelabel-theme/SKILL.md` (Modify)
- Add a "Warp terminal channel" subsection: automatic YAML generation, line-preserving
  activation, abort-if-changed concurrency, reset cleanup, `.whitelabel-state.json` /
  `.bak` artifacts, the per-theme `deriveAll` note, and the bare-string fallback.

### Success Criteria
#### Automated Verification
- [ ] No code/test changes; `npm test` still green
#### Manual Verification
- [ ] Docs match shipped behavior (esp. whichever activation format won the Phase-2 manual check)

### Dependencies
- Requires: Phase 2 (behavior must be final), Phase 3
- Blocks: nothing

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Warp rejects `theme = { custom_<slug> = {…} }` inline form | **Low** | Med | The live `~/.warp/settings.toml` already uses exactly this inline-table form (`custom_base_16 = {…}`) — evidence Warp accepts it. Still gated by the Phase-2 manual reload check; documented bare-string fallback handled by locator/restorer |
| TOCTOU: Warp writes between re-stat and rename | Low | Med | Narrowed by re-stat; documented residual; guidance "apply with Warp closed" |
| `deriveAll` degrades high-contrast | Med | Low | Test 31 gates it; revert to off (rollout 5→4) |
| Brace-matcher mishandles an unforeseen TOML shape | Low | High | Bail-on-uncertain (malformed/duplicate) leaves file untouched + paste-line; real-file fixture in tests |
| Atomic rename leaks temp perms | Low | Med | `writeTextAtomic` stat+chmod; test 32 |
| Regression to existing CC apply/reset | Low | High | Warp code is additive; existing CC tests must stay green (Phase 2 criterion) |

## Rollback Strategy
- Pure feature, isolated module. Revert is `git revert` of the phase commits.
- Runtime artifacts: `reset` removes the YAML + state and restores `settings.toml`; the
  one-time `~/.warp/settings.toml.whitelabel.bak` is the manual safety net.
- `deriveAll` rollout is revertible per-theme by flipping the flag + regenerating goldens.

## File Ownership Summary
| File | Phase | Change Type |
|------|-------|-------------|
| `.claude/skills/whitelabel-theme/warp-channel.js` | 1 | Create |
| `.claude/skills/whitelabel-theme/__tests__/warp-channel.test.js` | 1 | Create |
| `.claude/skills/whitelabel-theme/build-theme.js` | 2,3 | Modify |
| `.claude/skills/whitelabel-theme/__tests__/warp-io.test.js` | 2 | Create |
| `themes/{branded,dark,high-contrast,light,warm-neutral,nature}/theme.json` | 3 | Modify |
| `.claude/skills/whitelabel-theme/__tests__/golden/<id>.json` (flipped) | 3 | Modify |
| `.claude/skills/whitelabel-theme/__tests__/golden/warp/<id>.yaml` (all 8) | 3 | Create |
| `.claude/skills/whitelabel-theme/SKILL.md` | 4 | Modify |

## Open / verify-during-implementation
- Confirm `os.homedir()` resolves under the test's isolated `HOME` for `~/.warp` (it does
  for `~/.claude`); if not, thread a base dir through.
- Warp inline-table-vs-bare-string activation format (Phase-2 manual gate).
- high-contrast under deriveAll (Test 31 gate).
