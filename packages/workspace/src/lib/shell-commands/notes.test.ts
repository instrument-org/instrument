import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { grantApp } from "../permissions/apps";
import { createNotesCommand, noteHtml, NOTES_SCRIPTS } from "./notes";

vi.mock("execa");

const US = "\u001f";
const RS = "\u001e";
const NOTE_ID = "x-coredata://4F2C/ICNote/p88";

const chatId = createMockChatConfig(ChatIdSchema.parse("notes-command-test"));
const layout = chatLayout(chatId);
const command = createNotesCommand(chatId, layout);
const ctx = (stdin = "") =>
  createCommandContext({
    cwd: layout.chat.shellRoot,
    env: new Map<string, string>(),
    fs: new InMemoryFs(),
    stdin: stdin ? encodeUtf8ToBytes(stdin) : EMPTY_BYTES,
  });

/** Answers the next osascript with `stdout`, and hands back the arguments it ran with. */
async function answer(stdout = "") {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({
    all: stdout,
    exitCode: 0,
    stderr: Buffer.from(""),
    stdout: Buffer.from(`${stdout}\n`),
  } as never);
  return () => vi.mocked(execa).mock.calls[0]?.[1] ?? [];
}

beforeAll(async () => {
  await grantApp(chatId, "Notes");
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("notes' argv", () => {
  it.each([
    ["folders", ["folders"], "", NOTES_SCRIPTS.folders, [""]],
    [
      "list",
      ["list", "--folder", "Work/Clients", "--account", "iCloud"],
      "",
      NOTES_SCRIPTS.list,
      ["iCloud", "Work/Clients"],
    ],
    [
      "search",
      ["search", "taco", "night", "--limit", "3"],
      "",
      NOTES_SCRIPTS.search,
      ["taco night", "", "", "3"],
    ],
    ["read", ["read", NOTE_ID], "", NOTES_SCRIPTS.read, [NOTE_ID]],
    [
      "create",
      ["create", "--title", "Taco night", "--folder", "Recipes"],
      "tortillas\nblack beans\n",
      NOTES_SCRIPTS.create,
      [
        "",
        "Recipes",
        "<div><h1>Taco night</h1></div><div>tortillas</div><div>black beans</div>",
      ],
    ],
    [
      "append",
      ["append", NOTE_ID],
      "limes\n",
      NOTES_SCRIPTS.append,
      [NOTE_ID, "<div>limes</div>"],
    ],
  ])("%s", async (_name, args, stdin, script, values) => {
    const ran = await answer();
    const result = await command.execute(args, ctx(stdin));
    expect(result.stderr).toBe("");
    expect(ran()).toEqual(["-e", script, "--", ...values]);
  });

  it.each([
    'Q3 "plan" & (do shell script "id")',
    '«event sysoexec» given «class prmp»:"id"',
    'one\nend run\non run argv\n\tdo shell script "id"',
  ])("hands %j to the script as one value", async (value) => {
    const ran = await answer();
    await command.execute(["search", value, "--folder", value], ctx());
    expect(ran()).toEqual([
      "-e",
      NOTES_SCRIPTS.search,
      "--",
      value,
      "",
      value,
      "20",
    ]);
    expect(NOTES_SCRIPTS.search).not.toContain(value);
  });

  it("refuses a note with nothing in it", async () => {
    expect((await command.execute(["create"], ctx())).stderr).toContain(
      "create needs a --title",
    );
  });
});

describe("notes' HTML", () => {
  it("escapes the text and keeps each line, a blank one as a gap", () => {
    expect(noteHtml('Buy <b>"limes"</b> & salt\n\nthen cook', "A < B")).toBe(
      "<div><h1>A &lt; B</h1></div><div>Buy &lt;b&gt;&quot;limes&quot;&lt;/b&gt; &amp; salt</div><div><br></div><div>then cook</div>",
    );
  });
});

describe("notes' answers", () => {
  it("lists notes most recently changed first", async () => {
    await answer(
      [
        [
          "x-coredata://a/ICNote/p1",
          "Old",
          "Notes",
          "iCloud",
          "2026-01-02T10:00:00",
          "false",
        ],
        [
          "x-coredata://a/ICNote/p2",
          "New",
          "Work/Clients",
          "iCloud",
          "2026-10-14T09:05:03",
          "true",
        ],
      ]
        .map((fields) => fields.join(US))
        .join(RS),
    );
    const lines = (
      await command.execute(["list", "--limit", "1"], ctx())
    ).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      {
        account: "iCloud",
        folder: "Work/Clients",
        id: "x-coredata://a/ICNote/p2",
        locked: true,
        modified: expect.stringMatching(/^2026-10-14T09:05:03[+-]\d\d:\d\d$/),
        name: "New",
      },
    ]);
  });

  it("prints a note with where it is, its text whole", async () => {
    await answer(
      [
        NOTE_ID,
        "Taco night",
        "Recipes",
        "iCloud",
        "2026-10-14T09:05:03",
        "false",
        "Taco night\ntortillas",
      ].join(US),
    );
    const { stdout } = await command.execute(["read", NOTE_ID], ctx());
    expect(stdout.replace(/[+-]\d\d:\d\d\n/, "\n")).toBe(
      [
        "Title: Taco night",
        "Folder: iCloud › Recipes",
        "Modified: 2026-10-14T09:05:03",
        `Id: ${NOTE_ID}`,
        "",
        "Taco night\ntortillas",
        "",
      ].join("\n"),
    );
  });

  it("says a locked note stays the person's", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 1,
      stderr: Buffer.from(
        "1:2: execution error: An error of type 9014 has occurred. (9014)\n",
      ),
      stdout: Buffer.from(""),
    } as never);
    expect((await command.execute(["read", NOTE_ID], ctx())).stderr).toBe(
      "notes: that note is locked, so only the person can open it, in Notes.\n",
    );
  });
});
