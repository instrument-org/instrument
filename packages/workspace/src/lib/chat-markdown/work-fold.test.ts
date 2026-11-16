import { expect, it } from "vitest";

import { SessionMessagePart } from "../../schemas/session/message-part";
import { type SessionMessageRelaxedPart } from "../../schemas/session/message-relaxed-part";
import { type ToolName } from "../../tools/types";
import { isToolPart } from "../is-tool-part";
import { at, messageId, partId, sessionId } from "../records/test-records";
import { spokenDuration, workFoldFacts, workFoldStep } from "./work-fold";

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

it("writes each call as the fold's Markdown", () => {
  const cases = [
    {
      name: "a command that worked keeps no output",
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
      part: call(
        "read_file",
        { explanation: "Reading kyoto.md", filePath: "kyoto.md" },
        {
          output: { filePath: "/Users/someone/Workspace/Chats/Kyoto/kyoto.md" },
        },
      ),
    },
    {
      name: "a file outside the workspace",
      part: call("read_file", { filePath: "/home/other/notes.md" }),
    },
    {
      name: "an edit",
      part: call("edit_file", {
        explanation: "Replacing Day 3",
        filePath: "C:\\Users\\someone\\kyoto.md",
        newString: "Day 3: Nara",
        oldString: "Day 3: Golden Pavilion",
      }),
    },
    {
      name: "a search and the sites it found",
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
      part: call(
        "web_fetch",
        {
          explanation: "Opening the park's page",
          url: "https://nara-park.com",
        },
        { errorText: "Timed out" },
      ),
    },

    {
      name: "a multi-line edit in the workspace, as a diff",
      part: call("edit_file", {
        explanation: "Adding Day 4",
        filePath: "/Users/someone/Workspace/Notes/Kyoto trip.md",
        newString: "Day 3: Nara\nDay 4: Arashiyama",
        oldString: "Day 3: Nara",
      }),
    },
    {
      name: "a picture made in the workspace, shown",
      part: call(
        "generate_image",
        { explanation: "Making a header" },
        {
          output: {
            images: [{ filePath: "/Users/someone/Workspace/Notes/header.png" }],
          },
          seconds: 12,
        },
      ),
    },
    {
      name: "a skill its label already names",
      part: call("load_skill", {
        explanation: "Loading the photo-editing skill",
        name: "photo-editing",
      }),
    },
    {
      name: "a folder asked for",
      part: call("ask_permission", {
        explanation: "Asking for Documents",
        kind: "folder",
        reason: "So I can put the copy on your Desktop.",
        target: "/Users/someone/Documents",
      }),
    },
    {
      name: "a search with titled pages",
      part: call(
        "web_search",
        { query: "quiet dishwashers" },
        {
          output: {
            results: {
              sources: [
                {
                  title: "Best Quiet Dishwashers",
                  url: "https://rtings.com/q",
                },
                { url: "https://example.org/a b" },
              ],
            },
          },
        },
      ),
    },
  ];
  expect(
    cases
      .map(
        ({ name, part }) =>
          `<!-- ${name} -->\n${workFoldStep(part, "/Users/someone/Workspace")}`,
      )
      .join("\n\n"),
  ).toMatchInlineSnapshot(`
    "<!-- a command that worked keeps no output -->
    **Listing the folder**

    \`\`\`sh
    ls -la ~/Desktop '~/My files'
    \`\`\`

    <!-- a command that failed keeps its last lines -->
    **Reading the plan** · exit 1 · 4s

    \`\`\`sh
    cat kyoto.md
    \`\`\`

    \`\`\`text
    two
    three
    no such file
    \`\`\`

    <!-- a file under the home folder -->
    **Reading kyoto.md**

    [Chats/Kyoto/kyoto.md](../../Chats/Kyoto/kyoto.md)

    <!-- a file outside the workspace -->
    **Read a file**

    \`~/notes.md\`

    <!-- an edit -->
    **Replacing Day 3**

    \`~\\kyoto.md\`

    \`\`\`diff
    - Day 3: Golden Pavilion
    + Day 3: Nara
    \`\`\`

    <!-- a search and the sites it found -->
    **Searched the web**

    “nara park deer hours”

    - [www.japan-guide.com/a](https://www.japan-guide.com/a)
    - [japan-guide.com/b](https://japan-guide.com/b)
    - [nara-park.com](https://nara-park.com)

    <!-- a call that threw -->
    **Opening the park's page** · failed

    [nara-park.com](https://nara-park.com)

    Timed out

    <!-- a multi-line edit in the workspace, as a diff -->
    **Adding Day 4**

    [Notes/Kyoto trip.md](../../Notes/Kyoto%20trip.md)

    \`\`\`diff
      Day 3: Nara
    + Day 4: Arashiyama
    \`\`\`

    <!-- a picture made in the workspace, shown -->
    **Making a header** · 12s

    ![header.png](../../Notes/header.png)

    <!-- a skill its label already names -->
    **Loading the photo-editing skill**

    <!-- a folder asked for -->
    **Asking for Documents**

    \`~/Documents\`

    So I can put the copy on your Desktop.

    <!-- a search with titled pages -->
    **Searched the web**

    “quiet dishwashers”

    - [Best Quiet Dishwashers](https://rtings.com/q)
    - [example.org/a b](https://example.org/a%20b)"
  `);
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
