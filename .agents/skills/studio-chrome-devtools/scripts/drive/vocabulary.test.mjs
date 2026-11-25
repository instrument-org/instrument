import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { vocabulary, WORD_NAMES } from "./vocabulary.mjs";
import { createWords, findMenuPath } from "./words.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every word is in scope of a words run", () => {
  const { words } = createWords({ cdp: {}, port: 0, trace: [] });
  assert.deepEqual(Object.keys(words).sort(), [...WORD_NAMES].sort());
});

test("SKILL.md lists the vocabulary words.mjs has", () => {
  const skill = readFileSync(path.join(here, "../../SKILL.md"), "utf8");
  const listed = /<!-- words:start -->\n([\s\S]*?)\n<!-- words:end -->/.exec(skill)?.[1];
  assert.equal(listed, vocabulary(), "Run `studio-drive.mjs words` and paste it between the words markers in SKILL.md.");
});

test("a menu path may leave out the top menu", () => {
  const bar = [
    { enabled: true, label: "File", submenu: [{ enabled: true, label: "Print…" }] },
    { enabled: true, label: "Developer", submenu: [{ enabled: true, label: "Toggle Theme" }] },
  ];
  assert.deepEqual(findMenuPath(bar, ["Print"]), ["File", "Print…"]);
  assert.deepEqual(findMenuPath(bar, ["file", "print…"]), ["File", "Print…"]);
  assert.deepEqual(findMenuPath(bar, ["Toggle Theme"]), ["Developer", "Toggle Theme"]);
  assert.equal(findMenuPath(bar, ["Save"]), undefined);
});
