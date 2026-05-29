"use strict";

// Well-formedness guard for the Claude Code plugin marketplace + plugin manifests and
// command files. These artifacts are not shipped to npm and can't be unit-tested against
// the live Claude Code installer, so this locks the structure a future edit could break.
// Run: `node --test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../../../..");
const MARKETPLACE = path.join(REPO, ".claude-plugin", "marketplace.json");
const PLUGIN_DIR = path.join(REPO, "plugins", "whitelabel-theme");

test("marketplace.json: required fields + resolvable same-repo plugin source", () => {
  const m = JSON.parse(fs.readFileSync(MARKETPLACE, "utf8"));
  assert.ok(m.name && typeof m.name === "string", "marketplace name");
  assert.ok(m.owner && m.owner.name, "owner.name");
  assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0, "plugins[]");
  for (const p of m.plugins) {
    assert.ok(p.name, "plugin entry name");
    assert.ok(
      typeof p.source === "string" && p.source.startsWith("./"),
      "relative ./ source",
    );
    const dir = path.join(REPO, p.source);
    assert.ok(fs.existsSync(dir), `plugin source dir exists: ${p.source}`);
    assert.ok(
      fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json")),
      `plugin.json exists for ${p.name}`,
    );
  }
});

test("plugin.json: has a name", () => {
  const p = JSON.parse(
    fs.readFileSync(
      path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"),
      "utf8",
    ),
  );
  assert.ok(p.name, "plugin.json name");
});

test("plugin SKILL.md has name: + description: frontmatter", () => {
  const s = fs.readFileSync(path.join(PLUGIN_DIR, "SKILL.md"), "utf8");
  assert.match(s, /^---\n/, "starts with frontmatter");
  assert.match(s, /\nname:\s*\S/, "has name:");
  assert.match(s, /\ndescription:\s*\S/, "has description:");
});

test("each command file has frontmatter + npx body; $ARGUMENTS used iff it takes args", () => {
  const cmdDir = path.join(PLUGIN_DIR, "commands");
  const expectArgs = {
    "apply-theme.md": true,
    "preview-theme.md": true,
    "list-themes.md": false,
    "reset-theme.md": false,
  };
  const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith(".md"));
  assert.deepEqual(
    files.sort(),
    ["apply-theme.md", "list-themes.md", "preview-theme.md", "reset-theme.md"],
    "exactly the 4 advertised commands",
  );
  for (const f of files) {
    const body = fs.readFileSync(path.join(cmdDir, f), "utf8");
    assert.match(body, /^---\r?\n/, `${f}: starts with frontmatter`);
    const fm = body.slice(0, body.indexOf("\n---", 3));
    assert.match(fm, /\bdescription:\s*\S/, `${f}: description in frontmatter`);
    assert.match(
      body,
      /npx -y claude-whitelabel-themes@\^0\.1/,
      `${f}: pinned npx invocation`,
    );
    if (expectArgs[f])
      assert.match(body, /\$ARGUMENTS/, `${f}: uses $ARGUMENTS`);
    else
      assert.ok(
        !body.includes("$ARGUMENTS"),
        `${f}: no $ARGUMENTS (takes no args)`,
      );
  }
});
