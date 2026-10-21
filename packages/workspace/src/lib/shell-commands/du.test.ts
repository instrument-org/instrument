import path from "node:path";
import { describe, expect, it } from "vitest";

import { realHostPath } from "../host-path";
import { macosGuardedHomeFolders } from "../permissions/macos";
import { parseDuArgs, walkBounds } from "./du";

describe("walkBounds", () => {
  it("leaves out and names the places the rules don't open, and walks what opens in them", () => {
    // Nowhere on disk, so no link resolves it to another spelling.
    const home = path.resolve("/du-bounds-home");
    const at = (...parts: string[]) => path.join(home, ...parts);
    expect(
      walkBounds({
        rules: {
          dangerouslyAllowEveryFolder: false,
          home,
          rules: [
            { level: "allow", path: home, source: "place" },
            {
              level: "ask",
              path: at("Desktop"),
              place: "desktop",
              source: "place",
            },
            { level: "never", path: at("Music"), source: "folder" },
            { level: "allow", path: at("Desktop", "Pricing"), source: "grant" },
            {
              appData: true,
              level: "never",
              path: at("app"),
              source: "system",
            },
          ],
        },
      }),
    ).toEqual({
      closed: [at("app"), at("Desktop"), at("Music")],
      guarded: [
        ...new Set(
          macosGuardedHomeFolders().flatMap((folder) => [
            folder,
            realHostPath(folder),
          ]),
        ),
      ],
      named: [at("Desktop"), at("Music")],
      open: [at("Desktop", "Pricing")],
    });
  });
});

describe("parseDuArgs", () => {
  it.each([
    ["-sh", { human: true, maxDepth: 0 }],
    ["-hs", { human: true, maxDepth: 0 }],
    ["-d1", { maxDepth: 1 }],
    ["-hd1", { human: true, maxDepth: 1 }],
    ["--max-depth=2", { maxDepth: 2 }],
    ["-b", { apparent: true, unit: 1 }],
    ["--apparent-size", { apparent: true, unit: 1024 }],
    ["-m", { unit: 1024 * 1024 }],
    ["-ac", { all: true, grandTotal: true }],
  ])("reads %s", (flag, expected) => {
    expect(parseDuArgs([flag, "dir"])?.options).toMatchObject(expected);
  });

  it("takes a depth from the next argument", () => {
    expect(parseDuArgs(["-h", "-d", "1", "dir"])).toMatchObject({
      operands: ["dir"],
      options: { human: true, maxDepth: 1 },
    });
    expect(parseDuArgs(["--max-depth", "3", "dir"])?.options.maxDepth).toBe(3);
  });

  it("lets -s win over a depth, as GNU du does", () => {
    expect(parseDuArgs(["-d", "2", "-s", "dir"])?.options.maxDepth).toBe(0);
  });

  it("reads everything after -- as an operand", () => {
    expect(parseDuArgs(["-s", "--", "-odd-name"])?.operands).toEqual([
      "-odd-name",
    ]);
  });

  it.each([["-L"], ["--time"], ["--exclude=node_modules"], ["-d"], ["-dx"]])(
    "leaves %s to just-bash",
    (flag) => {
      expect(parseDuArgs([flag, "dir"])).toBeNull();
    },
  );
});
