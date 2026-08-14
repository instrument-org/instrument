import { type ToolName } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { summarizeToolRun } from "./tool-display";

describe("summarizeToolRun", () => {
  it.each<[string, ToolName[], string]>([
    ["one call of one kind", ["read_file"], "Read a file"],
    ["several of one kind", ["bash", "bash", "bash"], "Ran 3 commands"],
    [
      "two kinds, joined",
      ["read_file", "read_file", "bash"],
      "Read 2 files and ran a command",
    ],
    [
      "three kinds, listed then joined",
      ["read_file", "bash", "web_search", "write_file"],
      "Read a file, ran a command, searched the web and created a file",
    ],
    [
      "kept in the order the run went, not the order of the table",
      ["web_search", "read_file"],
      "Searched the web and read a file",
    ],
    [
      "a count left off where it says nothing",
      ["web_search", "web_search", "web_search"],
      "Searched the web",
    ],
    [
      "the heading's own call, which is not a step under it",
      ["start_activity", "read_file", "read_file"],
      "Read 2 files",
    ],
    ["nothing worth naming", ["start_activity"], "Worked on it"],
  ])("%s", (_case, toolNames, expected) => {
    expect(summarizeToolRun(toolNames)).toBe(expected);
  });
});
