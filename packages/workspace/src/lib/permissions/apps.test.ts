import { expect, it } from "vitest";

import { reachesEveryFile } from "./apps";

it.each([
  ["Finder", true],
  ["system events", true],
  ["Terminal", true],
  ["Mail", false],
])("%s reaches every file: %s", (app, expected) => {
  expect(reachesEveryFile(app)).toBe(expected);
});
