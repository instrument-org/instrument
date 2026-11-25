// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import {
  isCompiled,
  SKIPPED,
  skipDifferences,
} from "../../scripts/react-compiler-skips";

it("the React Compiler compiles every component and hook in the client but the ones named", () => {
  const files = fs
    .readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
    .filter(isCompiled)
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  const { newlySkipped, nowCompiled } = skipDifferences(files);
  // A new one: fix what the category names (a disable of a hooks rule is
  // Suppression; reach for useEffectEvent) rather than adding it.
  expect(newlySkipped).toEqual([]);
  // One that compiles now comes off the list, as does one whose file is gone.
  expect(nowCompiled).toEqual([]);
  expect(
    Object.keys(SKIPPED).filter(
      (key) => !files.includes(key.slice(0, key.indexOf("#"))),
    ),
  ).toEqual([]);
}, 60_000);
