// land: every landing. It reads the source tree, which `vitest related` cannot
// trace to the change that breaks it, so scripts/land.sh always runs it.
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const SRC = path.join(import.meta.dirname, "..");
const HOME = import.meta.dirname;

/** Named like model text, but it cleans the text it is handed and holds none. */
const NOT_MODEL_TEXT = new Set(["lib/sanitize-model-text.ts"]);

it("keeps every model text module in src/model-text", () => {
  const strays = fs
    .readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => file.endsWith("-model-text.ts"))
    .filter((file) => !file.startsWith(HOME + path.sep))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .filter((file) => !NOT_MODEL_TEXT.has(file));
  expect(strays).toEqual([]);
});
