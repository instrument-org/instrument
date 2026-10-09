import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  readJsonRecord,
  updateJsonRecord,
  updateJsonRecordSync,
} from "./json-record-file";

const root = withTempDir("json-record-file");

function file() {
  return path.join(root.path, ".instrument", "settings.json");
}

async function writeRaw(contents: string) {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), contents);
}

async function readRaw(): Promise<unknown> {
  return JSON.parse(await fs.readFile(file(), "utf8"));
}

describe.each([
  ["updateJsonRecord", updateJsonRecord],
  [
    "updateJsonRecordSync",
    async (...args: Parameters<typeof updateJsonRecordSync>) =>
      updateJsonRecordSync(...args),
  ],
])("%s", (_name, update) => {
  it("makes the file and its folder when there is none", async () => {
    await update(file(), () => ({ name: "Lisbon" }));

    expect(await readRaw()).toEqual({ name: "Lisbon" });
  });

  it("keeps every field the change leaves out, known or not", async () => {
    await writeRaw(
      JSON.stringify({ futureField: { kept: true }, name: "Lisbon" }),
    );

    await update(file(), () => ({ name: "Porto" }));

    expect(await readRaw()).toEqual({
      futureField: { kept: true },
      name: "Porto",
    });
  });

  it("drops a field the change sets to undefined", async () => {
    await writeRaw(JSON.stringify({ name: "Lisbon", projectId: "p-1" }));

    await update(file(), () => ({ projectId: undefined }));

    expect(await readRaw()).toEqual({ name: "Lisbon" });
  });

  it("leaves the file alone when the change has nothing to write", async () => {
    await writeRaw('{"name":"Lisbon"}');

    await update(file(), () => undefined);

    expect(await fs.readFile(file(), "utf8")).toBe('{"name":"Lisbon"}');
  });

  it.each([
    ["truncated JSON", '{"name": "Lis'],
    ["JSON that is not an object", "[1, 2]"],
  ])("refuses to write over %s", async (_label, contents) => {
    await writeRaw(contents);

    await expect(update(file(), () => ({ name: "Porto" }))).rejects.toThrow(
      /unreadable/,
    );
    expect(await fs.readFile(file(), "utf8")).toBe(contents);
  });

  it("refuses to write over a file it cannot open", async () => {
    // A folder where the file belongs fails the read with something other
    // than not-found, the way a permission error does.
    await fs.mkdir(file(), { recursive: true });

    await expect(update(file(), () => ({ name: "Porto" }))).rejects.toThrow(
      /unreadable/,
    );
    expect((await fs.stat(file())).isDirectory()).toBe(true);
  });

  it("leaves no temporary file behind", async () => {
    await update(file(), () => ({ name: "Lisbon" }));

    expect(await fs.readdir(path.dirname(file()))).toEqual(["settings.json"]);
  });
});

describe("updateJsonRecord", () => {
  it("serializes overlapping updates, so neither is lost", async () => {
    await writeRaw("{}");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        updateJsonRecord(file(), (record) => ({
          [`field${index}`]: index,
          count: (typeof record.count === "number" ? record.count : 0) + 1,
        })),
      ),
    );

    const written = await readJsonRecord(file());
    expect(written.kind === "read" && written.record.count).toBe(20);
    expect(written.kind === "read" && Object.keys(written.record).length).toBe(
      21,
    );
  });
});

describe("readJsonRecord", () => {
  it.each([
    ["no file", undefined, "missing"],
    ["truncated JSON", '{"a":', "unreadable"],
    ["null", "null", "unreadable"],
    ["an object", '{"a":1}', "read"],
  ])("reads %s as %s", async (_label, contents, kind) => {
    if (contents !== undefined) {
      await writeRaw(contents);
    }
    expect((await readJsonRecord(file())).kind).toBe(kind);
  });
});
