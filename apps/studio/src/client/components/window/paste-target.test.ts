import { expect, it } from "vitest";

import { createPasteTarget } from "./paste-target";

it("hands the folder a menu's Paste named to the paste it set off, once", () => {
  let now = 0;
  const target = createPasteTarget(() => now);

  target.name("Reports/");
  now = 100;

  expect(target.take()).toBe("Reports/");
  expect(target.take()).toBeNull();
});

// The paste the menu asked for never came: the next ⌘V lands where the
// keyboard is, not in the folder the menu named.
it("forgets a folder named by a Paste whose paste never came", () => {
  let now = 0;
  const target = createPasteTarget(() => now);

  target.name("Reports/");
  now = 5000;

  expect(target.take()).toBeNull();
});
