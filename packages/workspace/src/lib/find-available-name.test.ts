import { describe, expect, it } from "vitest";

import { findAvailableName } from "./find-available-name";

const takenBy = (taken: string[]) => {
  const set = new Set(taken);
  return (candidate: string) => set.has(candidate);
};

describe("findAvailableName", () => {
  it("returns the requested name when free", async () => {
    expect(await findAvailableName({ isTaken: takenBy([]), name: "image" }))
      .toMatchInlineSnapshot(`
        {
          "name": "image",
          "renamed": false,
        }
      `);
  });

  it("bumps to -2 on first collision", async () => {
    expect(
      await findAvailableName({ isTaken: takenBy(["image"]), name: "image" }),
    ).toMatchInlineSnapshot(`
      {
        "name": "image-2",
        "renamed": true,
      }
    `);
  });

  it("skips consecutive taken suffixes", async () => {
    expect(
      await findAvailableName({
        isTaken: takenBy(["image", "image-2", "image-3"]),
        name: "image",
      }),
    ).toMatchInlineSnapshot(`
      {
        "name": "image-4",
        "renamed": true,
      }
    `);
  });

  it("honors startAt for the 1-based convention", async () => {
    expect(
      await findAvailableName({
        isTaken: takenBy(["file"]),
        name: "file",
        startAt: 1,
      }),
    ).toMatchInlineSnapshot(`
      {
        "name": "file-1",
        "renamed": true,
      }
    `);
  });

  it("inserts the suffix before the extension when splitExtension is set", async () => {
    expect(
      await findAvailableName({
        isTaken: takenBy(["report.zip"]),
        name: "report.zip",
        splitExtension: true,
      }),
    ).toMatchInlineSnapshot(`
      {
        "name": "report-2.zip",
        "renamed": true,
      }
    `);
  });

  it("awaits async predicates", async () => {
    const taken = new Set(["image", "image-2"]);
    expect(
      await findAvailableName({
        isTaken: (candidate) => Promise.resolve(taken.has(candidate)),
        name: "image",
      }),
    ).toMatchInlineSnapshot(`
      {
        "name": "image-3",
        "renamed": true,
      }
    `);
  });
});
