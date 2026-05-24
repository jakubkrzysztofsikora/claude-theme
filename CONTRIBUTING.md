# Contributing to Claude White-Label Themes

Welcome, and thank you for your interest in contributing! This project thrives because of community members like you who share their creativity, time, and expertise.

Whether you're here to submit a brand-new theme, improve the tooling, fix a bug, or enhance documentation, you'll find everything you need to get started in this guide.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Submitting a New Theme](#submitting-a-new-theme)
  - [Contributing Code](#contributing-code)
  - [Reporting Bugs](#reporting-bugs)
  - [Requesting Features](#requesting-features)
  - [Improving Documentation](#improving-documentation)
- [Theme Requirements](#theme-requirements)
- [Development Setup](#development-setup)
- [Pull Request Workflow](#pull-request-workflow)
- [Review Process](#review-process)
- [Getting Help](#getting-help)

---

## Code of Conduct

This project and everyone participating in it is governed by our commitment to:

- **Be respectful** -- treat everyone with kindness and consideration.
- **Be constructive** -- offer helpful feedback and accept it gracefully.
- **Be inclusive** -- welcome contributors from all backgrounds and experience levels.
- **Be patient** -- maintainers are volunteers; responses may take a few days.

Harassment, discrimination, or abusive behavior of any kind will not be tolerated. Violations may result in a ban from the project.

---

## How Can I Contribute?

### Submitting a New Theme

The easiest and most popular way to contribute is by creating a new theme. Here's the complete workflow:

#### Step 1: Fork the repository

Click the **Fork** button on GitHub, then clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/claude-whitelabel-themes.git
cd claude-whitelabel-themes
```

#### Step 2: Create a new theme folder

```bash
node .claude/skills/whitelabel-theme/build-theme.js init your-theme-name
```

This scaffolds a new theme at `themes/your-theme-name/` with a starter `theme.json`, placeholder SVG logos, and a `README.md` template.

> **Naming convention**: Use kebab-case for theme IDs. Valid: `ocean-breeze`, `retro-terminal`. Invalid: `Ocean Breeze`, `ocean_breeze`.

#### Step 3: Customize your theme

Edit `themes/your-theme-name/theme.json` to define:

- **Colors** -- backgrounds, text, accents, semantic colors (error, warning, success)
- **Typography** -- a Google Font name and weights
- **Logo** -- replace `logo.svg` and `logo-dark.svg` with your own designs
- **Metadata** -- name, author, description, tags

See [docs/THEME_AUTHORING.md](docs/THEME_AUTHORING.md) for a comprehensive guide on color theory, typography, and logo design.

#### Step 4: Validate your theme

Run the validator to check for schema compliance and accessibility:

```bash
node scripts/validate-theme.js themes/your-theme-name/theme.json
```

This checks:
- All required fields are present
- Colors are valid hex codes
- Contrast ratios meet WCAG AA minimum
- Font name is available on Google Fonts
- SVG logos exist and are valid

#### Step 5: Preview your theme

```bash
node .claude/skills/whitelabel-theme/build-theme.js preview themes/your-theme-name/theme.json
```

A browser window opens showing a mock Claude interface rendered with your theme. Check that:
- Colors look good in context
- Text is readable on all backgrounds
- The logo renders clearly at small sizes
- Accent colors draw attention without overwhelming

#### Step 6: Submit a Pull Request

```bash
git checkout -b theme/your-theme-name
git add themes/your-theme-name/
git commit -m "theme: add Your Theme Name"
git push origin theme/your-theme-name
```

Then open a Pull Request on GitHub. Fill out the PR template with:
- Theme name and description
- Screenshot of the preview
- Accessibility test results (from the validator)
- Any notes on design decisions

---

### Contributing Code

#### Fork, Branch, and PR Workflow

```bash
# 1. Fork on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/claude-whitelabel-themes.git
cd claude-whitelabel-themes

# 2. Create a feature branch
git checkout -b feature/my-feature

# 3. Make your changes
# 4. Test locally (see Development Setup below)

# 5. Commit with a descriptive message
git commit -m "feat: add auto-reload on theme change"

# 6. Push and open a PR
git push origin feature/my-feature
```

#### Code Guidelines

- **Keep the zero-dependency constraint** -- do not add any npm packages to the runtime. Dev dependencies for testing/building are acceptable.
- **Use native APIs** -- prefer `fetch` over libraries, `fs/promises` over file utilities, etc.
- **Write clear, readable code** -- this project prioritizes clarity over cleverness.
- **Add comments** for complex logic; keep them concise.
- **Test your changes** locally before submitting.

#### What to Contribute

Good first issues are tagged with `good first issue` on GitHub. Popular contribution areas:

- New CLI commands or flags
- Better error messages
- Additional validators
- Performance improvements
- Test coverage
- Browser compatibility fixes

---

### Reporting Bugs

Found a bug? We'd love to hear about it so we can fix it.

**Before reporting:**
- Check if the bug has already been reported in [Issues](https://github.com/your-username/claude-whitelabel-themes/issues).
- Try the latest version from the main branch -- the bug may already be fixed.

**To report:**

Open a new issue with:
- **Title**: A clear, concise description
- **Environment**: Node.js version (`node --version`), browser, OS
- **Steps to reproduce**: Numbered steps that reliably trigger the bug
- **Expected behavior**: What you expected to happen
- **Actual behavior**: What actually happened (include error messages)
- **Theme file**: If applicable, attach the `theme.json` causing the issue

Example:

```markdown
**Title**: Font fails to load on themes with spaces in font name

**Environment**: Node.js 20, Chrome 120, macOS 14

**Steps to reproduce**:
1. Create a theme with `"fontFamily": "JetBrains Mono"`
2. Run `node build-theme.js apply theme.json`
3. Load the extension and open claude.ai

**Expected**: Font loads correctly.
**Actual**: Falls back to system font. Console shows "Invalid font name" warning.
```

---

### Requesting Features

Have an idea to make the theming system better? Open a [Feature Request issue](https://github.com/your-username/claude-whitelabel-themes/issues/new?labels=enhancement).

Include:
- **Use case**: What problem does this solve?
- **Proposal**: Your idea, described clearly
- **Alternatives**: Other approaches you've considered
- **Willingness to contribute**: Are you able to implement this?

Feature requests are evaluated against the project's core principles:
- Must preserve the zero-dependency constraint
- Should benefit a broad set of users
- Must not compromise accessibility

---

### Improving Documentation

Documentation improvements are always welcome! Whether it's fixing a typo, clarifying a confusing section, or adding a new guide:

1. Edit the relevant file in `docs/` or the root `README.md`
2. Test any code examples by copying and pasting them
3. Submit a PR with a descriptive title like `docs: clarify Node.js version requirement`

---

## Theme Requirements

All submitted themes must meet the following criteria:

### Unique ID
- Must be unique across the repository
- Use kebab-case (e.g., `ocean-breeze`, `nord-aurora`)
- Must match the folder name

### WCAG AA Minimum Contrast
- Normal text: 4.5:1 contrast ratio minimum
- Large text (18pt+): 3:1 contrast ratio minimum
- The validator (`scripts/validate-theme.js`) will check this automatically

### All Required Fields
Every `theme.json` must include:

```json
{
  "id": "string (required)",
  "name": "string (required)",
  "version": "string (required)",
  "author": "string (required)",
  "description": "string (required)",
  "tags": ["array of strings"],
  "fontFamily": "string (required)",
  "fontWeights": [100, 400, 700],
  "colors": {
    "backgroundPrimary": "#hex",
    "backgroundSecondary": "#hex",
    "backgroundTertiary": "#hex",
    "textPrimary": "#hex",
    "textSecondary": "#hex",
    "textMuted": "#hex",
    "accent": "#hex",
    "accentHover": "#hex",
    "border": "#hex",
    "error": "#hex",
    "warning": "#hex",
    "success": "#hex",
    "terminalUser": "#hex",
    "terminalAssistant": "#hex",
    "terminalSystem": "#hex"
  }
}
```

### Original Work or Properly Licensed Content
- Logos and color palettes must be your original work
- If using third-party assets (e.g., a CC-licensed icon), include attribution in the theme's `README.md`
- Do not use copyrighted brand logos or trademarks without permission

### No Offensive Content
Themes must not contain:
- Hate speech, symbols, or imagery
- Sexually explicit content
- Content glorifying violence
- Anything violating GitHub's Terms of Service

---

## Development Setup

While the project itself has zero runtime dependencies, you'll want these tools for development:

### Prerequisites

- **Node.js** 18+ (`node --version`)
- **Git** (`git --version`)
- **Chrome** or **Edge** (for testing the extension)

### Optional Tools

These are recommended but not required:

```bash
# For linting (optional)
npm install --global eslint

# For contrast testing (optional)
npm install --global contrast-checker
```

### Local Development Workflow

```bash
# 1. Clone your fork
git clone https://github.com/YOUR_USERNAME/claude-whitelabel-themes.git
cd claude-whitelabel-themes

# 2. Test that the CLI works
node .claude/skills/whitelabel-theme/build-theme.js list

# 3. Apply a theme and load it in Chrome
node .claude/skills/whitelabel-theme/build-theme.js apply themes/dark/theme.json
# Then load the extension/ folder in chrome://extensions/

# 4. Make your changes and test iteratively
# Edit files, re-run apply, and reload the extension in Chrome
```

### Running Tests

```bash
# Validate all built-in themes
node scripts/validate-theme.js themes/*/theme.json

# Check contrast ratios for a specific theme
node scripts/check-contrast.js themes/dark/theme.json

# Build the marketplace site locally
node scripts/build-marketplace.js
```

---

## Pull Request Workflow

### Before Creating a PR

1. **Sync your fork** with the upstream repository
2. **Create a feature branch** with a descriptive name:
   - `theme/your-theme-name` for new themes
   - `feat/description` for new features
   - `fix/description` for bug fixes
   - `docs/description` for documentation
3. **Make focused commits** -- one logical change per commit
4. **Test locally** using the validator and manual testing

### Commit Message Convention

We follow conventional commits for clear history:

```
theme: add Ocean Breeze theme
feat: add auto-reload on file change
fix: resolve font loading on Firefox
docs: update installation instructions
refactor: simplify contrast calculation
```

### PR Description

Include in your PR description:
- **What**: What changed and why
- **Testing**: How you tested the change
- **Screenshots**: For visual changes, include before/after images
- **Breaking changes**: List any (should be rare)

### Review Process

1. A maintainer will review your PR within a few days
2. Automated checks run (validation, contrast tests)
3. Address any feedback from reviewers
4. Once approved, a maintainer will merge

### After Merge

- Your contribution will be included in the next release
- New themes appear on the marketplace within 24 hours (auto-deployed)
- You'll be added to the contributors list

---

## Getting Help

Stuck? Here are ways to get help:

- **Read the docs**: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) and [docs/THEME_AUTHORING.md](docs/THEME_AUTHORING.md)
- **Open a Discussion**: Use GitHub Discussions for questions
- **Join the community**: [Discord/Slack invite link]
- **Email maintainers**: [maintainer@example.com]

---

Thank you for contributing! You're helping make Claude theming accessible to everyone.

-- The Claude White-Label Themes Team
