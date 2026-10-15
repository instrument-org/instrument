import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import { nativeTextRoutesTable } from "./native-text";

/**
 * docs/architecture/native-and-builtin-commands.md shows the fixed table of
 * GNU text commands uutils answers, per platform. The section between its
 * markers is generated from NATIVE_TEXT_ROUTES, so the doc cannot drift from
 * the code: this fails when they differ, and `pnpm fix` (vitest -u) writes
 * the section again.
 */
const DOC = path.resolve(
  import.meta.dirname,
  "../../../../../docs/architecture/native-and-builtin-commands.md",
);
const START = "<!-- generated: native-text routes; `pnpm fix` writes this -->";
const END = "<!-- end generated -->";

it("shows the table native-text.ts routes", async () => {
  const doc = fs.readFileSync(DOC, "utf8");
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const regenerated = `${doc.slice(0, start + START.length)}\n\n${nativeTextRoutesTable()}\n\n${doc.slice(end)}`;
  await expect(regenerated).toMatchFileSnapshot(DOC);
});
