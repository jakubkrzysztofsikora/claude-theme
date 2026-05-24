# Theme Authoring Guide

So you want to create a Claude theme? Excellent! This guide will walk you through everything you need to know -- from color theory basics to advanced accessibility practices.

Whether you're a designer with years of experience or a developer who just wants Claude to match their wallpaper, you'll find what you need here.

---

## Table of Contents

- [Theme Anatomy](#theme-anatomy)
- [Color Theory for UI Themes](#color-theory-for-ui-themes)
- [Typography Selection](#typography-selection)
- [Logo SVG Design Tips](#logo-svg-design-tips)
- [Terminal Color Design](#terminal-color-design)
- [Accessibility Best Practices](#accessibility-best-practices)
- [Previewing Your Theme](#previewing-your-theme)
- [Submitting to the Marketplace](#submitting-to-the-marketplace)

---

## Theme Anatomy

A theme is a folder containing at least three files. Let's examine each part of a `theme.json`:

```json
{
  "id": "ocean-breeze",
  "name": "Ocean Breeze",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "A calming ocean-inspired theme with deep blues and sandy accents.",
  "tags": ["blue", "calm", "nature"],
  "license": "MIT",
  "fontFamily": "Inter",
  "fontWeights": [400, 600, 700],
  "colors": {
    "backgroundPrimary": "#0a1628",
    "backgroundSecondary": "#111d2e",
    "backgroundTertiary": "#1a2d42",
    "backgroundHover": "#223554",
    "textPrimary": "#e6edf3",
    "textSecondary": "#b0c4de",
    "textMuted": "#6b8cae",
    "accent": "#4fc3f7",
    "accentHover": "#80d8ff",
    "border": "#1e3a5f",
    "error": "#ff5252",
    "warning": "#ffd740",
    "success": "#69f0ae",
    "terminalUser": "#4fc3f7",
    "terminalAssistant": "#69f0ae",
    "terminalSystem": "#ffd740"
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique kebab-case identifier. Used as folder name and CSS prefix. |
| `name` | string | Yes | Human-readable theme name. Shown in listings and the marketplace. |
| `version` | string | Yes | SemVer version (e.g., `1.0.0`). Increment when updating. |
| `author` | string | Yes | Your name or username. Attribution in the marketplace. |
| `description` | string | Yes | 1-2 sentence summary. Shown in theme cards and tooltips. |
| `tags` | string[] | No | Keywords for filtering. Good tags: `dark`, `light`, `blue`, `minimal`, `high-contrast`. |
| `license` | string | No | License for your theme artwork. Default: MIT. |
| `fontFamily` | string | Yes | A Google Fonts family name. Must be exact (case-sensitive). |
| `fontWeights` | number[] | Yes | Array of font weights to load. Typical: `[400, 600, 700]`. |

### Color Fields

| Field | Type | Required | Used For |
|-------|------|----------|----------|
| `backgroundPrimary` | hex | Yes | Main page background, sidebar |
| `backgroundSecondary` | hex | Yes | Cards, message bubbles, elevated surfaces |
| `backgroundTertiary` | hex | Yes | Input fields, dropdowns, nested elements |
| `backgroundHover` | hex | No | Hover states for interactive elements |
| `textPrimary` | hex | Yes | Main text, headings, primary content |
| `textSecondary` | hex | Yes | Secondary text, descriptions, metadata |
| `textMuted` | hex | Yes | Timestamps, placeholders, disabled text |
| `accent` | hex | Yes | Primary buttons, links, active states, key highlights |
| `accentHover` | hex | No | Accent color on hover/focus |
| `border` | hex | Yes | Dividers, outlines, card borders |
| `error` | hex | Yes | Error messages, validation failures |
| `warning` | hex | Yes | Warning states, caution messages |
| `success` | hex | Yes | Success messages, confirmation states |
| `terminalUser` | hex | Yes | User message indicators in terminal view |
| `terminalAssistant` | hex | Yes | Assistant (Claude) message indicators |
| `terminalSystem` | hex | Yes | System messages, status updates |

---

## Color Theory for UI Themes

### Choosing a Palette

A good UI palette has 4-6 colors that work harmoniously. Here's a simple method:

#### The 60-30-10 Rule

This classic design principle helps balance your colors:

- **60% Dominant** (Backgrounds): Your primary background color. Should be neutral -- very light or very dark.
- **30% Secondary** (Text): Your text colors. Must contrast well with backgrounds.
- **10% Accent** (Highlights): Your accent color. Used sparingly for buttons, links, and key elements.

```
60% -- Backgrounds: #0d1117 (deep dark)
30% -- Text:        #e6edf3, #b0c4de, #6b8cae (light grays)
10% -- Accent:      #58a6ff (vivid blue)
```

#### Monochromatic Palettes

Easy and safe. Start with one hue and vary saturation/brightness:

```
Base:    #1a237e (indigo)
Light:   #534bae (light indigo for hover)
Dark:    #000051 (dark indigo for contrast)
Text:    #e8eaf6 (very light indigo-tinted white)
```

#### Analogous Palettes

Colors next to each other on the color wheel. Feels harmonious:

```
Primary:   #1565c0 (blue)
Secondary: #00838f (teal)
Accent:    #0277bd (sky blue)
```

#### Complementary Palettes

Opposite colors on the wheel. High contrast and vibrant:

```
Primary: #1b5e20 (deep green)
Accent:  #c62828 (strong red for alerts/CTAs)
```

### Contrast Ratios

Contrast is the most important factor in readable UI. We measure it as a ratio between two colors.

| Ratio | WCAG Level | Good For |
|-------|-----------|----------|
| 21:1  | AAA+      | Black on white (maximum) |
| 7:1   | AAA       | Small text on backgrounds |
| 4.5:1 | AA        | Normal text (minimum acceptable) |
| 3:1   | AA Large  | Large text (18pt+) or UI components |
| 2:1   | None      | Decorative elements only |

**Always aim for at least 4.5:1 for text.** Our validator enforces this.

#### Quick Contrast Check in Your Terminal

Our built-in contrast checker:

```bash
node scripts/check-contrast.js themes/your-theme/theme.json
```

Or use online tools:
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Stark](https://www.getstark.co/) (Figma/Sketch plugin)

### Light vs Dark Considerations

#### Dark Themes

```
DO:
  Use desaturated backgrounds (#0d1117 not #0000ff)
  Keep text slightly muted (#e6edf3 not #ffffff pure white)
  Use accent colors at full saturation for pop

DON'T:
  Use pure black (#000000) -- it causes eye strain
  Use pure white (#ffffff) text -- too harsh on dark backgrounds
  Make everything too dark -- you need visible hierarchy
```

#### Light Themes

```
DO:
  Use warm or cool off-whites (#fafafa, #f6f8fa not #ffffff)
  Ensure dark text has enough contrast (#1f2328 not #666666)
  Soften borders so they don't dominate (#d0d7de not #888888)

DON'T:
  Use pure white background -- causes glare
  Use light gray text on white -- poor readability
  Make borders too prominent -- they compete with content
```

### Accent Color Usage

Your accent color is your theme's personality. Use it strategically:

**Good accent usage:**
- Primary action buttons ("Send", "Confirm")
- Active navigation items
- Links and interactive text
- Focus rings for accessibility
- Small indicators and badges

**Avoid:**
- Large accent backgrounds (overwhelming)
- Body text in accent color (unreadable)
- More than one strong accent (visual chaos)

---

## Typography Selection

### Good Fonts for Coding Interfaces

Claude is a coding-focused AI, so your font should be readable at small sizes and support code characters.

#### Sans-Serif Recommendations

| Font | Style | Best For | Notes |
|------|-------|----------|-------|
| **Inter** | Neutral, clean | Professional themes | The default. Excellent readability. |
| **Roboto** | Modern, friendly | General purpose | Google's flagship font. |
| **Open Sans** | Humanist, warm | Approachable themes | Great for "friendly" aesthetics. |
| **Source Sans Pro** | Technical, precise | Developer-focused themes | Adobe's open-source gem. |
| **Work Sans** | Geometric, modern | Minimalist themes | Less common, stands out. |
| **Nunito** | Rounded, soft | Playful themes | Good for themes targeting creative users. |

#### Serif Options (Unconventional but Striking)

| Font | Style | Best For |
|------|-------|----------|
| **Merriweather** | Scholarly, refined | Academic/writing-focused themes |
| **Lora** | Elegant, readable | Literary, warm themes |
| **Playfair Display** | Dramatic, high-contrast | Luxury/editorial themes |

#### Monospace (for Code Blocks)

The theming system primarily affects UI text, but your font choice sets the tone. For code-heavy UIs, consider pairing with a monospace font via CSS overrides.

### Google Fonts Integration

Themes specify a Google Font that gets loaded at runtime. To find available fonts:

1. Go to [fonts.google.com](https://fonts.google.com)
2. Browse or search for your desired font
3. Click the font name
4. Copy the exact family name (e.g., `"JetBrains Mono"`, `"Space Grotesk"`)
5. Paste into `theme.json`:

```json
{
  "fontFamily": "Space Grotesk",
  "fontWeights": [400, 500, 700]
}
```

### Weight Selection

Choose 2-3 weights to keep loading fast:

| Weight | Name | Use Case |
|--------|------|----------|
| 300 | Light | Large headings, subtle text |
| 400 | Regular | Body text, most UI |
| 500 | Medium | Slightly emphasized text |
| 600 | SemiBold | Buttons, labels, navigation |
| 700 | Bold | Headings, key emphasis |
| 800+ | ExtraBold | Hero text, special emphasis |

Recommended minimum set: `[400, 600, 700]`

---

## Logo SVG Design Tips

Your theme's logo replaces the Claude logo in the top-left corner. A great logo makes your theme feel complete.

### Keep It Simple

The best logos at small sizes are simple shapes:

```
GOOD:  A single geometric shape (circle, diamond, star)
       A minimalist letterform (stylized "C" or initial)
       An abstract mark (3-5 connected lines)

BAD:   Detailed illustrations (won't render at 16x16)
       Photographs (SVG doesn't support them well)
       Text-heavy designs (illegible at small sizes)
       Complex gradients (distracting, slow to render)
```

### Must Work at 16x16 and 32x32

Your logo will be displayed at multiple sizes. Test it:

1. Open your SVG in a browser
2. Use DevTools to set width to 16px and 16px
3. Verify it's still recognizable
4. Check at 32px (Retina displays)

**Tip**: Use SVG `viewBox="0 0 24 24"` or `viewBox="0 0 32 32"` for consistent scaling.

### Test on Both Light and Dark Backgrounds

Provide both `logo.svg` (for dark backgrounds) and `logo-dark.svg` (for light backgrounds):

```svg
<!-- logo.svg - for dark backgrounds (light-colored logo) -->
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="14" fill="#e6edf3" stroke="#58a6ff" stroke-width="2"/>
</svg>

<!-- logo-dark.svg - for light backgrounds (dark-colored logo) -->
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="14" fill="#1f2328" stroke="#0969da" stroke-width="2"/>
</svg>
```

### SVG Best Practices

```xml
<!-- Good: Clean, optimized SVG -->
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2L30 30H2L16 2Z" fill="currentColor"/>
</svg>

<!-- Avoid: Complex with unnecessary elements -->
<svg width="32" height="32" style="background: red;">
  <!-- Don't use inline styles, width/height attributes, or complex groups -->
</svg>
```

- Use `viewBox` instead of fixed `width`/`height`
- Use `currentColor` for fill if you want the logo to inherit theme colors
- Keep file size under 5KB
- Run through [SVGOMG](https://jakearchibald.github.io/svgomg/) to optimize

---

## Terminal Color Design

Terminal colors define how the conversation appears in Claude's interface. They're used for message indicators, syntax highlighting hints, and status displays.

### ANSI Color Mapping

The terminal colors in your theme map to semantic roles:

| Theme Field | Used For | Design Tip |
|-------------|----------|------------|
| `terminalUser` | User messages, input | Should match or complement your accent |
| `terminalAssistant` | Claude's responses | Different enough from user to distinguish |
| `terminalSystem` | Status, notifications | Neutral but visible |

### Designing Terminal Colors

```
Rule of thumb:
  - User color = slightly desaturated accent
  - Assistant color = complement or analogous to user
  - System color = warm yellow/orange (universal "system" color)

Example (Dark theme):
  terminalUser:      #58a6ff (blue -- matches accent)
  terminalAssistant: #3fb950 (green -- natural "AI" color)
  terminalSystem:    #d29922 (amber -- classic system color)

Example (Nature theme):
  terminalUser:      #81c784 (light green)
  terminalAssistant: #4fc3f7 (sky blue)
  terminalSystem:    #ffd54f (golden yellow)
```

### User vs Assistant vs System

The distinction should be clear at a glance:

- **User messages** often use cooler tones (blues, purples) -- represents input/control
- **Assistant messages** often use warmer or natural tones (greens, teals) -- represents response/AI
- **System messages** use warning tones (yellows, oranges) -- represents status/alerts

Ensure adequate contrast between all three colors.

---

## Accessibility Best Practices

Making your theme accessible means more people can use it comfortably. It's not just about compliance -- it's about inclusion.

### WCAG Guidelines

The Web Content Accessibility Guidelines define standards for accessible web content:

| Level | Requirement | Our Policy |
|-------|-------------|-----------|
| **A** | Basic accessibility | Always met |
| **AA** | Standard accessibility | **Minimum requirement** for all themes |
| **AAA** | Enhanced accessibility | Encouraged, especially for high-contrast themes |

### Key Rules for Theme Authors

#### 1. Contrast Is King

All text must meet these ratios against its background:

```
Normal text (12-14px):  4.5:1 minimum
Large text (18px+):     3:1 minimum
UI components:          3:1 minimum
```

Our validator checks this automatically. If it fails, adjust either the text color or background color until it passes.

#### 2. Don't Rely on Color Alone

Color should reinforce, not replace, meaning:

```
GOOD: Error text in red + error icon + "Error:" prefix
BAD:  Error text in red only
```

Since the system provides semantic colors (error, warning, success), ensure they're distinct in hue, not just in lightness.

#### 3. Color Blindness Considerations

About 8% of men and 0.5% of women have some form of color blindness. Test your theme:

**Common types:**
- **Deuteranopia** (red-green): Can't distinguish red/green
- **Protanopia** (red-blind): Red appears dark
- **Tritanopia** (blue-yellow): Can't distinguish blue/yellow

**Design tips:**
- Don't use red/green as the only way to distinguish states
- Ensure error/success states differ in lightness, not just hue
- Use icons or patterns alongside color

### Testing Tools

#### Automated Contrast Checking

```bash
# Check your theme's contrast ratios
node scripts/validate-theme.js themes/your-theme/theme.json

# Detailed contrast report
node scripts/check-contrast.js themes/your-theme/theme.json --detailed
```

#### Browser DevTools

Chrome and Firefox have built-in color blindness simulators:

1. Open DevTools (F12)
2. Click the three dots menu (top right)
3. Select **More tools** > **Rendering**
4. Under "Emulate vision deficiencies", select a type

#### Online Tools

- [Stark](https://www.getstark.co/) -- Figma/Sketch plugin + web app
- [Color Oracle](http://colororacle.org/) -- Desktop simulator
- [WhoCanUse.com](https://whocanuse.com/) -- Contrast checker with color blindness simulation

### Accessibility Checklist

Before submitting your theme, verify:

- [ ] All text meets 4.5:1 contrast ratio
- [ ] Accent colors are distinguishable from backgrounds
- [ ] Error/warning/success states differ in more than just hue
- [ ] The theme is usable in simulated color blindness modes
- [ ] Interactive elements have visible focus states
- [ ] Text remains readable at 200% zoom

---

## Previewing Your Theme Locally

Always preview before submitting. The preview shows your theme in a realistic mockup.

### Basic Preview

```bash
node .claude/skills/whitelabel-theme/build-theme.js preview themes/your-theme/theme.json
```

This opens a browser window with:
- A mock Claude sidebar
- Sample conversation messages
- Form elements and buttons
- Your logo and font applied

### Preview with Hot Reload

While editing your theme, use hot reload to see changes instantly:

```bash
node .claude/skills/whitelabel-theme/build-theme.js preview themes/your-theme/theme.json --watch
```

Now when you save changes to `theme.json`, the preview updates automatically.

### Manual Testing Checklist

Load the compiled extension and verify:

- [ ] Background colors look right on all pages (chat, projects, settings)
- [ ] Text is readable in all contexts (headings, body, small text)
- [ ] Accent color appears on buttons, links, and active states
- [ ] Your logo renders clearly at top-left
- [ ] Font loads and looks good (check both regular and bold text)
- [ ] Hover states are visible
- [ ] Error/warning/success colors look appropriate
- [ ] No visual glitches during navigation between pages

---

## Submitting to the Marketplace

Once your theme is polished, share it with the world!

### Prepare Your Submission

1. **Validate thoroughly:**
   ```bash
   node scripts/validate-theme.js themes/your-theme/theme.json
   ```

2. **Preview and screenshot:**
   ```bash
   node .claude/skills/whitelabel-theme/build-theme.js preview themes/your-theme/theme.json
   ```
   Take a screenshot of the preview window for your PR description.

3. **Write a good README:**
   Update `themes/your-theme/README.md` with:
   - Theme description and inspiration
   - Screenshot
   - Color palette preview
   - Any special features or notes

### Submit via Pull Request

```bash
git checkout -b theme/your-theme-name
git add themes/your-theme-name/
git commit -m "theme: add Your Theme Name"
git push origin theme/your-theme-name
```

Then open a Pull Request on GitHub. Include:
- Theme name and description
- Screenshot of the preview
- Accessibility test results
- Design inspiration or notes

### Review Process

1. Automated validation runs on your PR
2. A maintainer reviews for quality and accessibility
3. Feedback is provided if changes are needed
4. Once approved, your theme is merged and appears on the marketplace within 24 hours

---

## Quick Reference Card

Keep this handy while creating themes:

```
Hex format:       #RRGGBB (6 digits, no shorthand)
Font:             Exact Google Fonts name, case-sensitive
Logo:             SVG with viewBox, < 5KB, 16x16 readable
Contrast:         4.5:1 minimum for text
Naming:           kebab-case for IDs, Title Case for names
Weights:          [400, 600, 700] recommended
Tags:             3-5 descriptive keywords
```

---

Happy theme crafting! If you get stuck, check the [Getting Started Guide](GETTING_STARTED.md) or ask in our [community discussions](https://github.com/your-username/claude-whitelabel-themes/discussions).
