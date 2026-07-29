import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseRunBashArgs } from "./parse-run-bash-args";

describe("parseRunBashArgs", () => {
  it("parses valid attachment paths", () => {
    expect(parseRunBashArgs(["--attach", "fixtures", "echo ok"])).toEqual({
      attach: [path.resolve("fixtures")],
      bail: false,
      commands: ["echo ok"],
      taskId: undefined,
      tasksDir: undefined,
    });
  });

  it.each([{ argv: ["--attach"] }, { argv: ["--attach", "--bail"] }])(
    "rejects a missing attachment path in %j",
    ({ argv }) => {
      expect(() => parseRunBashArgs(argv)).toThrow(
        "--attach requires a directory path",
      );
    },
  );
});
