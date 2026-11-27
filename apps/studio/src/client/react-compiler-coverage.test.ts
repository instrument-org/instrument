// land: every landing. It reads source as text, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import {
  isCompiled,
  PRUNED,
  SKIPPED,
  skipDifferences,
} from "../../scripts/react-compiler-skips";

it("the React Compiler compiles every component and hook in the client but the ones named, and lets go of the scopes PRUNED records", () => {
  const files = fs
    .readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" })
    .filter(isCompiled)
    .map((file) => file.split(path.sep).join("/"))
    .sort();
  const { fewerPruned, missingPruned, morePruned, newlySkipped, nowCompiled } =
    skipDifferences(files);
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
  // A component named in PRUNED letting go of more of its scopes: a value it
  // made once is made on every render, and every screen or turn reading it
  // renders again. Move the hook calls above the values worked out before
  // them, or make the value a hook of its own. Fewer comes off the count.
  expect(morePruned).toEqual([]);
  expect(fewerPruned).toEqual([]);
  // A component in PRUNED that is gone or renamed takes its entry with it.
  expect(missingPruned).toEqual([]);
  expect(
    Object.keys(PRUNED).filter(
      (key) => !files.includes(key.slice(0, key.indexOf("#"))),
    ),
  ).toEqual([]);
}, 60_000);
