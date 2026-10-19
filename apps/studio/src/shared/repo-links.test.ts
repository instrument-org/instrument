import * as shared from "@instrument-org/shared";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const BLOB_MAIN = `${shared.APP_REPO_URL}/blob/main/`;

/**
 * Every link the app sends a person to in this repository's files on GitHub,
 * by the constant that holds it, so moving or renaming the file it names
 * fails here before the link does.
 */
const links = Object.entries(shared).flatMap(([name, value]) =>
  typeof value === "string" && value.startsWith(BLOB_MAIN)
    ? [{ file: value.slice(BLOB_MAIN.length).split("#")[0] ?? "", name }]
    : [],
);

it("links to the repository's files somewhere", () => {
  expect(links.map((link) => link.name)).toEqual(
    expect.arrayContaining(["SANDBOX_OFF_URL", "WINDOWS_SANDBOX_URL"]),
  );
});

it.each(links)("$name names a file in the repository", ({ file }) => {
  expect(existsSync(path.join(REPO_ROOT, file))).toBe(true);
});
