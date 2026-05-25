# API Reference

Complete reference for the Claude White-Label Theme system APIs. This document covers the CLI commands, the Theme JSON schema, the browser runtime API, and all CSS custom properties.

---

## Table of Contents

- [CLI Commands](#cli-commands)
- [Theme JSON Schema](#theme-json-schema)
- [Browser API](#browser-api)
- [CSS Custom Properties](#css-custom-properties)

---

## CLI Commands

The CLI is the primary interface for theme management. All commands are available through:

```bash
node .claude/skills/whitelabel-theme/build-theme.js <command> [options]
```

Or via npm scripts:

```bash
npm run theme:<command> -- [options]
```

### Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help message for a command |
| `--version` | Show CLI version |
| `--verbose` | Enable detailed output |
| `--silent` | Suppress non-error output |

---

### `apply`

Compiles a theme and applies it to the browser extension.

**Usage:**
```bash
node build-theme.js apply <theme.json> [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `theme.json` | string | Yes | Path to the theme definition file |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--output` | string | `extension/` | Output directory for compiled extension |
| `--reload` | boolean | `true` | Auto-reload the browser extension |

**Example:**
```bash
# Apply the dark theme
node build-theme.js apply themes/dark/theme.json

# Apply with custom output directory
node build-theme.js apply themes/nature/theme.json --output ./my-extension/

# Apply without auto-reload
node build-theme.js apply themes/cyberpunk/theme.json --no-reload
```

**Output:**
```
Compiling theme: Dark (by Core Team)
  ID: dark
  Version: 1.0.0
  Colors: 17 CSS variables
  Font: Inter (400, 600, 700)
  Logo: themes/dark/logo.svg
  Output: extension/

Extension compiled successfully!
  manifest.json   -- Browser extension manifest
  theme.css       -- Compiled CSS variables
  inject.js       -- Content injection script
  logo.svg        -- Theme logo (light variant)
  logo-dark.svg   -- Theme logo (dark variant)
```

---

### `compile`

Compiles a theme to an extension directory without applying or reloading.

**Usage:**
```bash
node build-theme.js compile <theme.json> [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `theme.json` | string | Yes | Path to the theme definition file |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--output` | string | `extension/` | Output directory |

**Example:**
```bash
node build-theme.js compile themes/light/theme.json --output ./dist/extension/
```

---

### `list`

Lists all available themes in a directory.

**Usage:**
```bash
node build-theme.js list [themes-dir] [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `themes-dir` | string | No | Directory to scan (default: `themes/`) |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--format` | string | `table` | Output format: `table`, `json`, `names` |
| `--tags` | string | - | Filter by comma-separated tags |

**Example:**
```bash
# List all themes
node build-theme.js list

# List themes in a custom directory
node build-theme.js list ./community-themes/

# Filter by tag
node build-theme.js list --tags dark,high-contrast

# JSON output for scripting
node build-theme.js list --format json
```

**Output (table):**
```
Available themes:
  dark             Dark         (v1.0.0)  Classic dark interface          [dark, default, blue]
  light            Light        (v1.0.0)  Clean light interface           [light, default, blue]
  high-contrast    High Contrast (v1.0.0) Maximum legibility             [accessibility, wcag-aaa]

3 themes found in themes/
```

---

### `validate`

Validates a theme.json file against the schema and accessibility requirements.

**Usage:**
```bash
node build-theme.js validate <theme.json> [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `theme.json` | string | Yes | Path to the theme file |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--verbose` | boolean | `false` | Show detailed validation results |
| `--strict` | boolean | `false` | Fail on warnings in addition to errors |

**Example:**
```bash
# Basic validation
node build-theme.js validate themes/dark/theme.json

# Detailed output
node build-theme.js validate themes/custom/theme.json --verbose

# Strict mode (warnings become errors)
node build-theme.js validate themes/custom/theme.json --strict
```

**Output (verbose):**
```
Validating themes/custom/theme.json...

Schema Check:
  id:                OK  ("custom-theme")
  name:              OK  ("Custom Theme")
  version:           OK  ("1.0.0")
  author:            OK  ("Jane Doe")
  description:       OK  ("A warm autumn-inspired theme.")
  fontFamily:        OK  ("Inter")
  fontWeights:       OK  ([400, 600, 700])

Color Validation:
  backgroundPrimary:   #1a1a2e  OK
  backgroundSecondary: #16213e  OK
  textPrimary:         #eaeaea  OK
  accent:              #e94560  OK
  ...

Contrast Ratios:
  textPrimary on backgroundPrimary:   14.2:1  PASS (AA, AAA)
  textSecondary on backgroundPrimary:  8.7:1  PASS (AA, AAA)
  textMuted on backgroundPrimary:      4.8:1  PASS (AA)
  accent on backgroundPrimary:         5.1:1  PASS (AA)

Font Check:
  "Inter" available on Google Fonts: YES
  Weights [400, 600, 700] available: YES

Logo Check:
  themes/custom/logo.svg:       EXISTS (1.2KB)
  themes/custom/logo-dark.svg:  EXISTS (1.1KB)

Result: VALID (all checks passed)
```

---

### `preview`

Opens a browser preview of a theme without installing it.

**Usage:**
```bash
node build-theme.js preview <theme.json> [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `theme.json` | string | Yes | Path to the theme file |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--port` | number | `3456` | Port for the preview server |
| `--watch` | boolean | `false` | Reload on file changes |
| `--no-open` | boolean | `false` | Don't auto-open browser |

**Example:**
```bash
# Open preview
node build-theme.js preview themes/nature/theme.json

# Preview with hot reload
node build-theme.js preview themes/custom/theme.json --watch

# Preview on a different port
node build-theme.js preview themes/custom/theme.json --port 8080
```

---

### `init`

Scaffolds a new theme with starter files.

**Usage:**
```bash
node build-theme.js init <theme-name> [options]
```

**Arguments:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `theme-name` | string | Yes | Theme ID (kebab-case) |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--template` | string | `dark` | Base template to use |
| `--author` | string | - | Theme author name |
| `--output` | string | `themes/` | Parent directory |

**Example:**
```bash
# Create a new theme
node build-theme.js init ocean-breeze

# Create from light template
node build-theme.js init sunrise --template light --author "Your Name"
```

**Generated files:**
```
themes/ocean-breeze/
  theme.json         -- Theme definition with starter values
  logo.svg           -- Placeholder logo (dark bg variant)
  logo-dark.svg      -- Placeholder logo (light bg variant)
  README.md          -- Template for theme documentation
```

---

## Theme JSON Schema

### Complete Field Reference

| Field | Type | Required | Default | Description | Example |
|-------|------|----------|---------|-------------|---------|
| `id` | string | Yes | - | Unique kebab-case identifier | `"ocean-breeze"` |
| `name` | string | Yes | - | Human-readable name | `"Ocean Breeze"` |
| `version` | string | Yes | - | SemVer version string | `"1.0.0"` |
| `author` | string | Yes | - | Creator name or username | `"Jane Doe"` |
| `description` | string | Yes | - | Short theme description | `"A calming ocean-inspired theme"` |
| `tags` | string[] | No | `[]` | Filter/search keywords | `["blue", "calm", "nature"]` |
| `license` | string | No | `"MIT"` | Content license | `"MIT"` |
| `fontFamily` | string | Yes | - | Google Fonts family name | `"Inter"` |
| `fontWeights` | number[] | Yes | - | Weights to load | `[400, 600, 700]` |

### Color Fields

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `colors.backgroundPrimary` | hex | Yes | Main background | `"#0d1117"` |
| `colors.backgroundSecondary` | hex | Yes | Cards, elevated surfaces | `"#161b22"` |
| `colors.backgroundTertiary` | hex | Yes | Inputs, dropdowns | `"#21262d"` |
| `colors.backgroundHover` | hex | No | Hover states | `"#30363d"` |
| `colors.textPrimary` | hex | Yes | Main text | `"#e6edf3"` |
| `colors.textSecondary` | hex | Yes | Secondary text | `"#b0c4de"` |
| `colors.textMuted` | hex | Yes | Timestamps, placeholders | `"#6b8cae"` |
| `colors.accent` | hex | Yes | Buttons, links, highlights | `"#58a6ff"` |
| `colors.accentHover` | hex | No | Accent on hover | `"#79c0ff"` |
| `colors.border` | hex | Yes | Dividers, outlines | `"#30363d"` |
| `colors.error` | hex | Yes | Error states | `"#ff5252"` |
| `colors.warning` | hex | Yes | Warning states | `"#ffd740"` |
| `colors.success` | hex | Yes | Success states | `"#69f0ae"` |
| `colors.terminalUser` | hex | Yes | User message color | `"#58a6ff"` |
| `colors.terminalAssistant` | hex | Yes | Assistant message color | `"#3fb950"` |
| `colors.terminalSystem` | hex | Yes | System message color | `"#d29922"` |

### Schema Validation Rules

| Rule | Description |
|------|-------------|
| `id` | Must match `^[a-z0-9]+(-[a-z0-9]+)*$` (kebab-case) |
| `version` | Must match SemVer (`^\d+\.\d+\.\d+`) |
| Hex colors | Must match `^#[0-9A-Fa-f]{6}$` (6-digit hex) |
| `fontWeights` | Each value must be in `[100, 200, 300, 400, 500, 600, 700, 800, 900]` |
| Contrast | `textPrimary` on `backgroundPrimary` must be >= 4.5:1 |

---

## Browser API

When the theme is active in the browser, a global API is exposed for programmatic control.

### `window.__CLAUDE_THEME__`

The theme injector creates a global object on `window` that you can access from the browser console or userscripts.

#### Methods

##### `applyTokens(tokens)`

Applies theme tokens directly without reloading the extension.

**Signature:**
```javascript
window.__CLAUDE_THEME__.applyTokens(tokens)
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tokens` | Object | Key-value pairs of CSS variable names to values |

**Example:**
```javascript
// Tweak a single color on the fly
window.__CLAUDE_THEME__.applyTokens({
  '--theme-accent': '#ff6b6b',
  '--theme-accent-hover': '#ff8e8e'
});

// Change the background
window.__CLAUDE_THEME__.applyTokens({
  '--theme-bg-primary': '#1a1a2e',
  '--theme-bg-secondary': '#16213e'
});
```

**Returns:** `void`

---

##### `reset()`

Removes all theme overrides and restores Claude's default appearance.

**Signature:**
```javascript
window.__CLAUDE_THEME__.reset()
```

**Example:**
```javascript
// Turn off theming
window.__CLAUDE_THEME__.reset();
```

**Returns:** `void`

---

##### `getActiveTheme()`

Returns the currently active theme's metadata and colors.

**Signature:**
```javascript
window.__CLAUDE_THEME__.getActiveTheme()
```

**Returns:**
```javascript
{
  id: "dark",
  name: "Dark",
  version: "1.0.0",
  author: "Core Team",
  fontFamily: "Inter",
  colors: {
    backgroundPrimary: "#0d1117",
    backgroundSecondary: "#161b22",
    // ... all colors
  },
  tokens: {
    "--theme-bg-primary": "#0d1117",
    "--theme-bg-secondary": "#161b22",
    // ... all CSS variables
  }
}
```

**Example:**
```javascript
const theme = window.__CLAUDE_THEME__.getActiveTheme();
console.log(`Current theme: ${theme.name} by ${theme.author}`);
console.log(`Primary bg: ${theme.colors.backgroundPrimary}`);
```

---

##### `reload()`

Force-reloads the current theme. Useful if styles get out of sync.

**Signature:**
```javascript
window.__CLAUDE_THEME__.reload()
```

**Example:**
```javascript
window.__CLAUDE_THEME__.reload();
```

---

##### `on(event, callback)`

Listen for theme events.

**Signature:**
```javascript
window.__CLAUDE_THEME__.on(event, callback)
```

**Events:**

| Event | Description | Callback Args |
|-------|-------------|---------------|
| `applied` | Theme was applied | `{ id, name }` |
| `reset` | Theme was reset | `null` |
| `tokenChange` | A token was modified | `{ key, value }` |

**Example:**
```javascript
window.__CLAUDE_THEME__.on('applied', (theme) => {
  console.log(`Theme "${theme.name}" is now active`);
});

window.__CLAUDE_THEME__.on('tokenChange', ({ key, value }) => {
  console.log(`Token ${key} changed to ${value}`);
});
```

---

### Events

The theme system dispatches CustomEvents on `document`:

```javascript
// Listen for theme application
document.addEventListener('theme:applied', (e) => {
  console.log('Theme applied:', e.detail);
});

// Listen for theme reset
document.addEventListener('theme:reset', () => {
  console.log('Theme was reset');
});
```

---

## CSS Custom Properties

The theme system injects the following CSS custom properties (variables) into the page. You can use these in custom stylesheets or browser extensions.

### Layout & Background Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-bg-primary` | `colors.backgroundPrimary` | Main page background |
| `--theme-bg-secondary` | `colors.backgroundSecondary` | Cards, panels, message bubbles |
| `--theme-bg-tertiary` | `colors.backgroundTertiary` | Inputs, dropdowns, nested elements |
| `--theme-bg-hover` | `colors.backgroundHover` | Hover state backgrounds |
| `--theme-surface` | `colors.backgroundSecondary` | Synonym for secondary bg |
| `--theme-surface-elevated` | `colors.backgroundSecondary` | Elevated surfaces (with subtle shadow) |

### Text Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-text-primary` | `colors.textPrimary` | Main headings and body text |
| `--theme-text-secondary` | `colors.textSecondary` | Descriptions, secondary content |
| `--theme-text-muted` | `colors.textMuted` | Timestamps, placeholders, hints |
| `--theme-text-on-accent` | Auto-calculated | Text color for accent-colored buttons |
| `--theme-text-disabled` | Muted at 50% | Disabled button/input text |

### Accent Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-accent` | `colors.accent` | Primary accent (buttons, links) |
| `--theme-accent-hover` | `colors.accentHover` | Accent on hover/focus |
| `--theme-accent-subtle` | Accent at 15% opacity | Subtle accent backgrounds |
| `--theme-accent-border` | Accent at 30% opacity | Accent-tinted borders |

### Semantic Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-error` | `colors.error` | Error text, error borders |
| `--theme-error-bg` | Error at 15% opacity | Error backgrounds |
| `--theme-warning` | `colors.warning` | Warning text, warning borders |
| `--theme-warning-bg` | Warning at 15% opacity | Warning backgrounds |
| `--theme-success` | `colors.success` | Success text, success borders |
| `--theme-success-bg` | Success at 15% opacity | Success backgrounds |

### Border & Divider Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-border` | `colors.border` | Standard borders |
| `--theme-border-subtle` | Border at 50% opacity | Light dividers |
| `--theme-divider` | `colors.border` | Section dividers |

### Terminal / Conversation Colors

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-terminal-user` | `colors.terminalUser` | User message indicators |
| `--theme-terminal-assistant` | `colors.terminalAssistant` | Assistant message indicators |
| `--theme-terminal-system` | `colors.terminalSystem` | System/status message indicators |

### Typography

| Variable | Default Source | Description |
|----------|---------------|-------------|
| `--theme-font-family` | `fontFamily` | Primary UI font |
| `--theme-font-mono` | System mono | Fallback monospace for code |
| `--theme-font-weight-normal` | 400 | Regular text weight |
| `--theme-font-weight-medium` | 500 or first weight | Medium emphasis |
| `--theme-font-weight-bold` | 700 or highest weight | Bold text |

### Shadow & Effects

| Variable | Value | Description |
|----------|-------|-------------|
| `--theme-shadow-sm` | `0 1px 2px rgba(0,0,0,0.1)` | Small shadows |
| `--theme-shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Medium shadows |
| `--theme-shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Large shadows |
| `--theme-focus-ring` | Accent with outline | Focus indicator for accessibility |

### Scrollbar

| Variable | Description |
|----------|-------------|
| `--theme-scrollbar-track` | Scrollbar track background |
| `--theme-scrollbar-thumb` | Scrollbar thumb color |
| `--theme-scrollbar-thumb-hover` | Scrollbar thumb on hover |

---

### Using CSS Variables in Custom Styles

You can reference theme variables in your own CSS:

```css
/* Custom sidebar widget that matches the theme */
.my-widget {
  background-color: var(--theme-bg-secondary);
  color: var(--theme-text-primary);
  border: 1px solid var(--theme-border);
  font-family: var(--theme-font-family);
}

.my-widget:hover {
  background-color: var(--theme-bg-hover);
}

.my-widget .highlight {
  color: var(--theme-accent);
}

.my-widget .error {
  color: var(--theme-error);
  background-color: var(--theme-error-bg);
}
```

---

### Programmatic Access

Read CSS variables from JavaScript:

```javascript
// Get a variable value
const accent = getComputedStyle(document.documentElement)
  .getPropertyValue('--theme-accent')
  .trim();

// Set a variable (temporary override)
document.documentElement.style.setProperty('--theme-accent', '#ff0000');

// Remove override (revert to theme default)
document.documentElement.style.removeProperty('--theme-accent');
```

---

## Exit Codes

The CLI uses standard exit codes:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments or usage |
| `3` | Validation failure |
| `4` | File not found |
| `5` | Network error (font loading, etc.) |
