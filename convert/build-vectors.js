#!/usr/bin/env node
"use strict";

// =============================================================================
// convert/build-vectors.js — OFFLINE deterministic vectorizer.
//
// Reads convert/registry.json and pre-computes the bag-of-words + char-trigram
// sparse vector for every key of every source key-set and every known client,
// writing convert/reference-vectors.json. This is the artifact schema-map.js can
// load instead of re-vectorizing at runtime.
//
// NO MODEL. NO NETWORK. Pure, reproducible: re-running this on the same registry
// must produce a byte-identical reference-vectors.json (keys are sorted). Run:
//
//   node convert/build-vectors.js          # writes convert/reference-vectors.json
//   node convert/build-vectors.js --check  # exit 1 if the committed file is stale
//
// This is a SCAFFOLD tool and is NOT shipped in the npm tarball (`files` allowlist).
// =============================================================================

const fs = require("node:fs");
const path = require("node:path");
const { vectorizeKeySet } = require("./schema-map");

const REGISTRY = path.join(__dirname, "registry.json");
const OUT = path.join(__dirname, "reference-vectors.json");

/** Deep-sort object keys so JSON.stringify output is stable/diffable. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

function build() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  const result = {
    $comment:
      "PRE-GENERATED key vectors (bag-of-words + char-trigram). Produced by convert/build-vectors.js from convert/registry.json — do not hand-edit; re-run the script.",
    registryVersion: registry.version,
    sources: {},
    clients: {},
  };
  for (const id of Object.keys(registry.sources || {})) {
    result.sources[id] = vectorizeKeySet(registry.sources[id]);
  }
  for (const id of Object.keys(registry.clients || {})) {
    result.clients[id] = vectorizeKeySet(registry.clients[id]);
  }
  return sortDeep(result);
}

function serialize(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  const next = serialize(build());
  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== next) {
      process.stderr.write(
        "reference-vectors.json is stale — run `node convert/build-vectors.js`\n",
      );
      process.exit(1);
    }
    process.stdout.write("reference-vectors.json is up to date\n");
    return;
  }
  fs.writeFileSync(OUT, next);
  process.stdout.write(`wrote ${path.relative(process.cwd(), OUT)}\n`);
}

if (require.main === module) main();

module.exports = { build, serialize, sortDeep };
