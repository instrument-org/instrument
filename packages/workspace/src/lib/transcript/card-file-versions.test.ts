import { describe, expect, it } from "vitest";

import { cardFileVersions } from "./card-file-versions";
import { type TranscriptMessage } from "./transcript-message";

/** A reply that kept `files`, each `[path, hash, copy?, folder?, number?]`. */
const reply = (
  id: string,
  files: [string, string, string?, string?, number?][],
  kind?: "original" | "restored",
) =>
  ({
    id,
    parts: [
      {
        data: {
          device: "mac",
          files: files.map(([path, hash, copy, folder = "/w", number]) => ({
            hash,
            hostPath: `${folder}/${path}`,
            path,
            size: 1,
            ...(copy && { copy }),
            ...(number !== undefined && { number }),
          })),
          ...(kind && { kind }),
        },
        type: "data-fileVersions",
      },
    ],
    role: "assistant",
  }) as unknown as TranscriptMessage; // only the fields the lookup reads

describe("cardFileVersions", () => {
  it("draws an earlier turn's file from its copy once a later turn changed it", () => {
    const found = cardFileVersions([
      reply("m1", [["moon.svg", "a", "/v/1.svg"]]),
      reply("m2", [
        ["moon.svg", "b", "/v/2.svg"],
        ["sun.svg", "s", "/v/s.svg"],
      ]),
      reply("m3", [["sun.svg", "s", "/v/s.svg"]]),
    ]);
    expect(
      Object.fromEntries(
        [...found].map(([id, files]) => [id, Object.fromEntries(files)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "m1": {
          "moon.svg": {
            "changedSince": false,
            "copy": "/v/1.svg",
          },
        },
      }
    `);
  });

  it("says a file changed since when its copy is not on this computer", () => {
    const found = cardFileVersions([
      reply("m1", [["moon.svg", "a"]]),
      reply("m2", [["moon.svg", "b"]]),
    ]);
    expect(found.get("m1" as never)?.get("moon.svg")).toEqual({
      changedSince: true,
    });
  });

  it("draws the last reply from its copy once the person restored an earlier version", () => {
    const found = cardFileVersions([
      reply("m1", [["moon.svg", "a", "/v/1.svg"]]),
      reply("m2", [["moon.svg", "b", "/v/2.svg"]]),
      reply("m2", [["moon.svg", "a", "/v/1.svg"]], "restored"),
    ]);
    expect(found.get("m2" as never)?.get("moon.svg")).toEqual({
      changedSince: false,
      copy: "/v/2.svg",
    });
    expect(found.get("m1" as never)).toBeUndefined();
  });

  it("keeps a namesake in another folder from passing for the file", () => {
    const found = cardFileVersions([
      reply("m1", [["chart.svg", "a", "/v/1.svg", "/a"]]),
      reply("m2", [["chart.svg", "b", "/v/2.svg", "/a"]]),
      reply("m3", [["chart.svg", "a", "/v/1.svg", "/b"]]),
    ]);
    expect(found.get("m1" as never)?.get("chart.svg")).toEqual({
      changedSince: false,
      copy: "/v/1.svg",
    });
  });

  it("numbers every card for a file once it has a second version, and none for a file with one", () => {
    const found = cardFileVersions([
      reply("m1", [
        ["faq.md", "a", "/v/faq.md/v1.md", "/w", 1],
        ["plan.md", "p", "/v/plan.md/v1.md", "/w", 1],
      ]),
      reply("m2", [["faq.md", "b", "/v/faq.md/v2.md", "/w", 2]]),
    ]);
    expect(
      Object.fromEntries(
        [...found].map(([id, files]) => [id, Object.fromEntries(files)]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "m1": {
          "faq.md": {
            "changedSince": false,
            "copy": "/v/faq.md/v1.md",
            "number": 1,
          },
        },
        "m2": {
          "faq.md": {
            "changedSince": false,
            "number": 2,
          },
        },
      }
    `);
  });

  it("numbers a file of the person's the chat changed once as v2", () => {
    const found = cardFileVersions([
      reply(
        "m1",
        [["notes.md", "a", "/v/notes.md/v1.md", "/w", 1]],
        "original",
      ),
      reply("m1", [["notes.md", "b", "/v/notes.md/v2.md", "/w", 2]]),
    ]);
    expect(found.get("m1" as never)?.get("notes.md")).toEqual({
      changedSince: false,
      number: 2,
    });
  });
});
