import { describe, expect, it } from "vitest";

import { cardFileVersions } from "./card-file-versions";
import { type TranscriptMessage } from "./transcript-message";

/** A reply that kept `files`, each `[path, hash, copy?]`. */
const reply = (id: string, files: [string, string, string?][]) =>
  ({
    id,
    parts: [
      {
        data: {
          device: "mac",
          files: files.map(([path, hash, copy]) => ({
            hash,
            hostPath: `/w/${path}`,
            path,
            size: 1,
            ...(copy && { copy }),
          })),
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
      reply("m2", [["moon.svg", "b", "/v/2.svg"], ["sun.svg", "s", "/v/s.svg"]]),
      reply("m3", [["sun.svg", "s", "/v/s.svg"]]),
    ]);
    expect(Object.fromEntries([...found].map(([id, files]) => [id, Object.fromEntries(files)]))).toMatchInlineSnapshot(`
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
    const found = cardFileVersions([reply("m1", [["moon.svg", "a"]]), reply("m2", [["moon.svg", "b"]])]);
    expect(found.get("m1" as never)?.get("moon.svg")).toEqual({ changedSince: true });
  });
});
