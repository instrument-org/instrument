import assert from "node:assert/strict";
import { test } from "node:test";

import { describeNode, findNodes, indexTree, outline } from "./ax.mjs";

const node = (nodeId, role, name, childIds = [], extra = {}) => ({
  childIds,
  name: { value: name },
  nodeId,
  role: { value: role },
  ...extra,
});

/** Two sides, each with a Send button, and a hidden group's button. */
const raw = [
  node("1", "RootWebArea", "", ["2", "3", "6", "9"]),
  node("2", "navigation", "Tab groups", ["21"]),
  node("21", "button", "Budget tab group"),
  node("3", "region", "Left side", ["4", "5"]),
  node("4", "textbox", "Talk to Instrument", [], { properties: [{ name: "focused", value: { value: true } }] }),
  node("5", "button", "Send"),
  node("6", "region", "Right side", ["7"]),
  node("7", "button", "Send", ["8"]),
  node("8", "StaticText", "Send"),
  node("9", "generic", "", ["10"], { ignored: true }),
  node("10", "button", "Send", [], { ignored: true }),
];

test("a name in two places matches both, and a scope picks one", () => {
  const index = indexTree(raw);
  const both = findNodes(index, { name: "Send", roles: ["button"] });
  assert.equal(both.matches.length, 2);
  assert.deepEqual(both.matches.map((each) => describeNode(index, each)), [
    'button "Send" in region "Left side"',
    'button "Send" in region "Right side"',
  ]);
  const right = findNodes(index, { name: "Send", roles: ["button"], within: new Set(["6"]) });
  assert.deepEqual(right.matches.map((each) => each.id), ["7"]);
});

test("the outline names what a script can act on, focus included, and nothing hidden", () => {
  assert.equal(
    outline(indexTree(raw)),
    [
      "navigation \"Tab groups\"",
      "  button \"Budget tab group\"",
      "region \"Left side\"",
      "  textbox \"Talk to Instrument\" [focused]",
      "  button \"Send\"",
      "region \"Right side\"",
      "  button \"Send\"",
    ].join("\n"),
  );
});
