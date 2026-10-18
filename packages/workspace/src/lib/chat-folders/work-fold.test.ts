import { expect, it } from "vitest";

import { SessionMessagePart } from "../../schemas/session/message-part";
import { type SessionMessageRelaxedPart } from "../../schemas/session/message-relaxed-part";
import { type ToolName } from "../../tools/types";
import { isToolPart } from "../is-tool-part";
import { at, messageId, partId, sessionId } from "../records/test-records";
import { spokenDuration, workFoldFacts, workFoldLines } from "./work-fold";

let next = 0;

function call(
  tool: ToolName,
  input: Record<string, unknown>,
  {
    errorText,
    output,
    seconds = 0,
  }: { errorText?: string; output?: unknown; seconds?: number } = {},
): SessionMessagePart.ToolPart {
  next += 1;
  const raw: SessionMessageRelaxedPart.ToolPart = {
    ...(errorText === undefined ? { output } : { errorText }),
    input,
    metadata: {
      createdAt: at(0),
      endedAt: at(seconds),
      id: partId(next),
      messageId: messageId(1),
      sessionId: sessionId(1),
    },
    state: errorText === undefined ? "output-available" : "output-error",
    toolCallId: `call-${next.toString()}`,
    type: `tool-${tool}`,
  };
  const part = SessionMessagePart.coerce(raw);
  if (!isToolPart(part)) {
    throw new Error("not a tool part");
  }
  return part;
}

it.each([
  {
    name: "a command that worked keeps no output",
    lines: ["Listing the folder", "  $ ls -la ~/Desktop '~/My files'"],
    part: call(
      "bash",
      {
        command: "ls -la /Users/someone/Desktop '/Users/other/My files'",
        explanation: "Listing the folder",
      },
      { output: { exitCode: 0, output: "a\nb\nc\nd" } },
    ),
  },
  {
    name: "a command that failed keeps its last lines",
    lines: [
      "Reading the plan · exit 1 · 4s",
      "  $ cat kyoto.md",
      "  two",
      "  three",
      "  no such file",
    ],
    part: call(
      "bash",
      { command: "cat kyoto.md", explanation: "Reading the plan" },
      {
        output: { exitCode: 1, output: "one\ntwo\n\nthree\nno such file\n" },
        seconds: 4,
      },
    ),
  },
  {
    name: "a file under the home folder",
    lines: ["Reading kyoto.md", "  Chats/Kyoto/kyoto.md"],
    part: call(
      "read_file",
      { explanation: "Reading kyoto.md", filePath: "kyoto.md" },
      { output: { filePath: "/Users/someone/Workspace/Chats/Kyoto/kyoto.md" } },
    ),
  },
  {
    name: "a file outside the workspace",
    lines: ["Read a file", "  ~/notes.md"],
    part: call("read_file", { filePath: "/home/other/notes.md" }),
  },
  {
    name: "an edit",
    lines: [
      "Replacing Day 3",
      "  ~\\kyoto.md",
      "  “Day 3: Golden Pavilion” → “Day 3: Nara”",
    ],
    part: call("edit_file", {
      explanation: "Replacing Day 3",
      filePath: "C:\\Users\\someone\\kyoto.md",
      newString: "Day 3: Nara",
      oldString: "Day 3: Golden Pavilion",
    }),
  },
  {
    name: "a search and the sites it found",
    lines: [
      "Searched the web",
      "  nara park deer hours",
      "  japan-guide.com, nara-park.com, example.org",
    ],
    part: call(
      "web_search",
      { query: "nara park deer hours" },
      {
        output: {
          results: {
            sources: [
              { url: "https://www.japan-guide.com/a" },
              { url: "https://japan-guide.com/b" },
              { url: "https://nara-park.com" },
              { url: "https://example.org" },
              { url: "https://fourth.example" },
            ],
          },
        },
      },
    ),
  },
  {
    name: "a call that threw",
    lines: [
      "Opening the park's page · failed",
      "  https://nara-park.com",
      "  Timed out",
    ],
    part: call(
      "web_fetch",
      { explanation: "Opening the park's page", url: "https://nara-park.com" },
      { errorText: "Timed out" },
    ),
  },
])("$name", ({ lines, part }) => {
  expect(workFoldLines(part, "/Users/someone/Workspace")).toEqual(lines);
});

it("says what a stretch did, a few facts and a count of the rest", () => {
  const edit = (filePath: string) =>
    call("edit_file", { filePath, newString: "b", oldString: "a" });
  expect(
    workFoldFacts([
      call("read_file", { filePath: "/Users/someone/kyoto.md" }),
      edit("kyoto.md"),
      edit("kyoto.md"),
      call("bash", { command: "ls" }),
      call("web_search", { query: "a" }),
      call("web_search", { query: "b" }),
    ]),
  ).toEqual([
    "read kyoto.md",
    "edited kyoto.md twice",
    "ran a command",
    "and 2 more steps",
  ]);
  expect(
    workFoldFacts([
      call("write_file", { filePath: "a.md" }),
      call("write_file", { filePath: "b.md" }),
      call("read_file", { filePath: "a.md" }),
      call("read_file", { filePath: "b.md" }),
      call("read_file", { filePath: "c.md" }),
    ]),
  ).toEqual(["wrote 2 files", "read 3 files"]);
});

it.each([
  [0, "1s"],
  [14_400, "14s"],
  [180_000, "3m"],
  [190_000, "3m 10s"],
])("%dms reads as %s", (ms, said) => {
  expect(spokenDuration(ms)).toBe(said);
});
