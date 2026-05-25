# Getting Started with Claude White-Label Themes

Welcome! This guide will take you from zero to a fully themed Claude experience in about 10 minutes. No prior knowledge of browser extensions or theming systems is required.

---

## Table of Contents

- [What Is Claude White-Label Theming?](#what-is-claude-white-label-theming)
- [Why Zero Dependencies Matter](#why-zero-dependencies-matter)
- [Step 1: Installing the Plugin](#step-1-installing-the-plugin)
- [Step 2: Applying Your First Theme](#step-2-applying-your-first-theme)
- [Step 3: Loading the Browser Extension](#step-3-loading-the-browser-extension)
- [Step 4: Using Slash Commands in Claude Code](#step-4-using-slash-commands-in-claude-code)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Next Steps](#next-steps)

---

## What Is Claude White-Label Theming?

Claude White-Label Themes is a system that lets you completely change the appearance of Claude.ai -- the colors, fonts, and even the logo -- to match your personal taste, brand, or accessibility needs.

Think of it like a "skin" for Claude. You can:

- Change the background to a calming green (Nature theme)
- Switch to a high-contrast mode for better readability
- Apply your company's brand colors and logo
- Create something wild and unique (Cyberpunk theme!)

The system consists of:
1. **A CLI tool** that runs in your terminal (Node.js)
2. **A browser extension** that injects the theme into Claude.ai
3. **Theme files** (`theme.json`) that define colors, fonts, and logos

---

## Why Zero Dependencies Matter

Most software projects depend on hundreds (sometimes thousands) of third-party packages. Each dependency is a potential security risk and a point of failure.

This project uses **zero dependencies** -- nothing to install, nothing to trust, nothing to break. It works using only APIs built into Node.js and your browser. This means:

- **No `npm install`** -- just clone and go
- **No supply chain attacks** -- there's no chain to attack
- **No version conflicts** -- nothing to update or maintain
- **Auditable code** -- you can read every line

If you've ever waited for `npm install` to finish or dealt with a broken dependency, you'll appreciate this approach.

---

## Step 1: Installing the Plugin

### Prerequisites

Before starting, ensure you have:

| Requirement | How to Check | Minimum Version |
|-------------|-----------|-----------------|
| Node.js | `node --version` | 18.0.0 |
| Chrome or Edge | Check browser settings | 90+ |
| Git | `git --version` | 2.30+ |

If you don't have Node.js, download it from [nodejs.org](https://nodejs.org/). The LTS (Long Term Support) version is recommended.

### Clone the Repository

Open your terminal and run:

```bash
# Clone the repository
git clone https://github.com/your-username/claude-whitelabel-themes.git

# Enter the project folder
cd claude-whitelabel-themes

# Verify the CLI is working
node .claude/skills/whitelabel-theme/build-theme.js --help
```

You should see a help message listing available commands. If you do, you're ready to proceed!

---

## Step 2: Applying Your First Theme

Let's apply the built-in **Dark** theme (it's the default and looks great).

### List Available Themes

```bash
node .claude/skills/whitelabel-theme/build-theme.js list
```

Output:
```
Available themes:
  dark             Classic dark interface
  light            Clean light interface
  high-contrast    Maximum legibility
  branded          Organization-ready
  minimalist       Distraction-free
  nature           Earthy greens and browns
  cyberpunk        Neon on deep purple
  warm-neutral     Sepia-infused comfort

8 themes found in themes/
```

### Apply a Theme

```bash
# Apply the dark theme
node .claude/skills/whitelabel-theme/build-theme.js apply themes/dark/theme.json
```

You should see output like:
```
Compiling theme: Dark (by Core Team)
  Colors: 14 variables
  Font: Inter (400, 600, 700)
  Logo: themes/dark/logo.svg
  Output: extension/

Extension compiled successfully!
Next steps:
  1. Load the extension/ folder in chrome://extensions/
  2. Open claude.ai to see your theme
```

The `apply` command:
1. Reads the `theme.json` file
2. Validates the colors and fonts
3. Generates CSS variables
4. Copies the logo SVG
5. Creates a complete browser extension in the `extension/` folder

### Try a Different Theme

```bash
# Apply the nature theme
node .claude/skills/whitelabel-theme/build-theme.js apply themes/nature/theme.json

# Apply the cyberpunk theme
node .claude/skills/whitelabel-theme/build-theme.js apply themes/cyberpunk/theme.json
```

After each `apply`, you'll need to reload the extension in Chrome (see Step 3).

---

## Step 3: Loading the Browser Extension

Now let's load the extension into Chrome so it can theme Claude.ai.

### Enable Developer Mode

1. Open **Chrome** or **Edge**
2. Type `chrome://extensions` in the address bar and press Enter
3. Look for the **Developer mode** toggle in the top-right corner
4. Turn it **ON**

> In Edge, the URL is `edge://extensions` and the toggle is called "Developer mode" as well.

### Load the Extension

1. Click the **Load unpacked** button (top-left area)
2. Navigate to your `claude-whitelabel-themes` folder
3. Select the `extension/` folder inside it
4. Click **Open** (or **Select Folder**)

You should now see the extension listed with your theme's name and logo.

### Verify It's Working

1. Go to [claude.ai](https://claude.ai) and sign in
2. Look for these changes:
   - The **background color** should match your theme
   - The **Claude logo** in the top-left should be replaced
   - The **font** should change (may take 1-2 seconds to load)
   - **Accent colors** on buttons and links should update

### Reloading After Changes

Whenever you apply a different theme:

1. Run the `apply` command in your terminal
2. Go to `chrome://extensions`
3. Find your theme extension
4. Click the **reload** icon (circular arrow) on the extension card
5. Refresh the Claude.ai page

**Tip**: Enable the **"Update"** button in `chrome://extensions` to streamline this process.

---

## Step 4: Using Slash Commands in Claude Code

If you use **Claude Code** (the terminal-based Claude client), you can manage themes without leaving your coding environment.

### Available Commands

```bash
# List themes
claude /theme list

# Apply a theme
claude /theme apply themes/nature/theme.json

# Preview a theme (opens browser)
claude /theme preview themes/cyberpunk/theme.json

# Get help
claude /theme --help
```

### Setting Up the Skill

Claude Code automatically detects skills in the `.claude/skills/` directory. If the slash commands aren't working:

1. Ensure you're running Claude Code in the project directory:
   ```bash
   cd claude-whitelabel-themes
   claude
   ```

2. Check that the skill manifest exists:
   ```bash
   ls .claude/skills/whitelabel-theme/skill.json
   ```

3. Restart Claude Code if you just cloned the repository

---

## Troubleshooting Common Issues

### "node: command not found"

**Problem**: Node.js is not installed or not in your PATH.

**Solution**: Install Node.js 18+ from [nodejs.org](https://nodejs.org/), then restart your terminal.

### "Cannot find module" errors

**Problem**: The build script can't find required files.

**Solution**: Make sure you're running commands from the project root:
```bash
cd claude-whitelabel-themes
pwd  # Should show .../claude-whitelabel-themes
```

### Extension not appearing in Chrome

**Problem**: The `extension/` folder wasn't created.

**Solution**: Check that the `apply` command succeeded:
```bash
ls extension/
# Should show: manifest.json, theme.css, inject.js, logo.svg
```

If the folder is empty, re-run the apply command and check for error messages.

### Theme not applying on Claude.ai

**Problem**: The extension is loaded but Claude looks unchanged.

**Solutions**:
1. Check the **Console** in Chrome DevTools (F12) for errors
2. Make sure the extension is **enabled** (toggle switch in chrome://extensions)
3. Try reloading the extension and refreshing Claude.ai
4. Check if another extension is conflicting (ad blockers, dark mode extensions)
5. Verify you're on `claude.ai` (not `claude.com` or another domain)

### Font not loading

**Problem**: The custom font falls back to system default.

**Solutions**:
1. Check your internet connection (fonts load from Google Fonts)
2. Open Chrome DevTools > Network tab and look for font requests
3. Some corporate firewalls block Google Fonts -- try a different font or download it locally
4. Check the font name spelling in `theme.json`

### Colors look wrong or ugly

**Problem**: The theme colors don't render as expected.

**Solutions**:
1. Use the preview command to see the theme in isolation:
   ```bash
   node .claude/skills/whitelabel-theme/build-theme.js preview themes/your-theme/theme.json
   ```
2. Check that all hex codes are valid (6 digits, starting with `#`)
3. Ensure you're viewing the theme on the intended background (light vs dark)

### "Validation failed" errors

**Problem**: Your `theme.json` doesn't meet requirements.

**Solution**: Run the validator with verbose output:
```bash
node scripts/validate-theme.js themes/your-theme/theme.json --verbose
```

This will tell you exactly which field is missing or invalid.

---

## Next Steps

Congratulations! You now have a themed Claude experience. Here's where to go next:

### Customize an Existing Theme

Make small tweaks to a built-in theme:

1. Copy a theme folder:
   ```bash
   cp -r themes/dark themes/my-dark
   ```

2. Edit `themes/my-dark/theme.json` and change a few colors

3. Apply and test:
   ```bash
   node .claude/skills/whitelabel-theme/build-theme.js apply themes/my-dark/theme.json
   ```

### Create Your Own Theme

Ready to build something unique? Read the [Theme Authoring Guide](THEME_AUTHORING.md) for:
- Complete theme anatomy reference
- Color theory for UI design
- Typography selection
- Logo SVG design tips
- Accessibility best practices

### Explore Advanced Features

- **Auto-switch themes**: Set up time-based theme switching
- **Share your theme**: Submit to the community marketplace
- **Deep dive**: Read the [Architecture Documentation](ARCHITECTURE.md)

### Get Involved

- [Contribute a theme](../CONTRIBUTING.md#submitting-a-new-theme)
- [Report bugs or request features](../CONTRIBUTING.md#reporting-bugs)
- [Join the community](https://github.com/your-username/claude-whitelabel-themes/discussions)

---

**Happy theming!**
