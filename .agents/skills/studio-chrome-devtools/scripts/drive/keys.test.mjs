import assert from "node:assert/strict";
import { test } from "node:test";

import { parseChord } from "./keys.mjs";

test("chords parse to sendInputEvent's names and a menu's input", () => {
  const chord = parseChord("Meta+Shift+t");
  assert.deepEqual(chord.modifiers, ["meta", "shift"]);
  assert.equal(chord.keyCode, "t");
  assert.deepEqual(chord.input, { alt: false, code: "KeyT", control: false, key: "T", meta: true, shift: true });
  assert.equal(parseChord("cmd+,").input.code, "Comma");
  assert.equal(parseChord("Escape").keyCode, "Escape");
  assert.equal(parseChord("ArrowDown").keyCode, "Down");
  assert.equal(parseChord("Meta++").keyCode, "+");
});

test("an unknown modifier or key is refused, naming what is known", () => {
  assert.throws(() => parseChord("Hyper+k"), /Unknown modifier "Hyper"/);
  assert.throws(() => parseChord("Meta+Launch"), /Unknown key "Launch"/);
});
