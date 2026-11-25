// node --test .agents/skills/studio-chrome-devtools/scripts/drive/
import assert from "node:assert/strict";
import { test } from "node:test";

import { bestMatches, fold, nearest, tierOf } from "./names.mjs";

test("fold drops case, spacing, the ellipsis and a trailing shortcut", () => {
  assert.equal(fold("  Print…  "), "print");
  assert.equal(fold("Search ⌘K"), "search");
  assert.equal(fold("New ⌘N"), "new");
  assert.equal(fold("Notifications alt+T"), "notifications");
  assert.equal(fold("Close  New\nTab"), "close new tab");
});

test("tiers run from exact to anywhere", () => {
  assert.equal(tierOf("Send", "Send"), 0);
  assert.equal(tierOf("Search ⌘K", "search"), 1);
  assert.equal(tierOf("Budget tab group", "Budget"), 2);
  assert.equal(tierOf("Open Budget now", "Budget"), 3);
  assert.equal(tierOf("Budgeting", "Budget"), 4);
  assert.equal(tierOf("Send", "Sent"), undefined);
  assert.equal(tierOf("Close New Tab", /^close/i), 0);
});

test("the best tier decides, so an exact name is never ambiguous with a looser one", () => {
  const names = [{ name: "New Tab" }, { name: "New Tab in Split" }, { name: "New tab" }];
  assert.deepEqual(bestMatches(names, "New Tab"), [{ name: "New Tab" }]);
  assert.deepEqual(
    bestMatches(names, "new tab").map((each) => each.name),
    ["New Tab", "New tab"],
  );
  assert.deepEqual(bestMatches(names, "Split"), [{ name: "New Tab in Split" }]);
  assert.deepEqual(bestMatches(names, "Nothing"), []);
});

test("nearest offers the closest names first", () => {
  assert.equal(nearest(["Settings", "Send", "Search ⌘K", "History"], "Sned")[0], "Send");
  assert.deepEqual(nearest(["Close Tab", "Close Tab", "Close Window"], "Close tabs"), ["Close Tab", "Close Window"]);
});
