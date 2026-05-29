# `convert/` — theme → arbitrary terminal client

Convert a Claude theme into another terminal client's theme format. This directory is an
**optional, dev-only scaffold** — it is intentionally **not** in the npm `files` allowlist,
so the published core package stays zero-dependency and ships nothing here.

## Two paths

### 1. Deterministic core (implemented, zero-dep, offline)
For **known** clients (iTerm2, Alacritty, Kitty, Windows Terminal — see `registry.json`),
conversion is a pure function with no model and no network:

- `registry.json` — curated *shapes* (slot keys, output format, human aliases) of each
  known client's theme, plus the Claude Code / Warp source key sets. Pure data, no colors.
- `build-vectors.js` — offline script that turns each registry key into a deterministic
  vector (tokenize → char n-grams). Produces `reference-vectors.json`. No model.
- `schema-map.js` — `convert({ sourceEntry, colors, clientEntry, themeName })`:
  vectorizes source + client keys, maps source→client by cosine similarity (+ alias/role
  hints), and `emit()`s the client's theme text (TOML / kitty-conf / JSON / iTerm plist),
  with a per-mapping `confidence`.

CLI: `claude-theme convert --client alacritty <theme-id-or-path>`.

### 2. Model-augmented path for UNKNOWN clients (design — follow-on, opt-in)
The end goal: a user types a client name the registry doesn't know; the tool combs the web
for that client's theme schema, vectorizes its keys, compares to the pre-vectorized Claude
Code / Warp schemas, and converts.

**This path is deliberately not built into the core** because it breaks the project's
zero-dependency / no-network / trust posture. The intended architecture, when added:

1. **Opt-in + network-gated** — only runs on an explicit flag (e.g. `--experimental-web`);
   off by default; clearly disclosed.
2. **Isolated** — the model + fetch logic live here under `convert/`, loaded lazily, never
   required by the core CLI. The core never gains a runtime dependency.
3. **Small local embedding model**, lazy-downloaded on first opt-in use (cached), used only
   to embed the discovered client's schema keys — reusing the SAME vector space as
   `reference-vectors.json` so the existing deterministic mapper does the actual mapping.
4. **Comb step** — fetch the client's documented theme schema (docs/config reference),
   extract candidate keys, present them for confirmation before writing anything.
5. **Always falls back** to the deterministic registry path; the model only *adds* unknown
   clients, it never replaces the offline core.

Until that lands, an unknown client prints a clear "model-augmented path not yet available
(opt-in, coming)" notice and exits cleanly.

## Tests
`__tests__/convert.test.js` covers the deterministic core (registry shape, cosine bounds,
per-client emit validity, determinism). No network/model in tests.
