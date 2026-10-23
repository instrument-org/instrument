import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { brokenLinksIn } from "./broken-links";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";

const REFERENCE = `# Instrument reference

## Settings

### General (\`general\`)

- **Theme** (\`theme\`): Choose your preferred color scheme.

## Screens

- **Release notes** (\`release-notes\`): What changed in each version.

## Keyboard shortcuts
`;

describe("brokenLinksIn", () => {
  let root: string;
  let chatRoot: string;
  let chatId: ChatId;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "broken-links-"));
    chatRoot = path.join(root, "work", "links-chat");
    chatId = createMockChatConfigForDir(chatRoot);
    const systemSkills = path.join(root, "system-skills");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      appsDir: AbsolutePathSchema.parse(path.join(root, "Apps")),
      registryDir: AbsolutePathSchema.parse(path.join(root, "registry")),
      rootDir: WorkspaceDirSchema.parse(root),
      systemSkillsDir: AbsolutePathSchema.parse(systemSkills),
    });
    await fs.mkdir(path.join(chatRoot, "sales"), { recursive: true });
    await fs.writeFile(path.join(chatRoot, "sales", "report.md"), "# Sales");
    await fs.mkdir(path.join(chatRoot, "Drafts (2026)"));
    await fs.writeFile(path.join(chatRoot, "Drafts (2026)", "a b.txt"), "a");
    await fs.mkdir(path.join(root, "Memory"));
    await fs.writeFile(path.join(root, "Memory", "no-stevia.md"), "No stevia.");
    await fs.mkdir(path.join(systemSkills, "instrument-guide"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(systemSkills, "instrument-guide", "reference.md"),
      REFERENCE,
    );
    await fs.writeFile(
      path.join(systemSkills, "instrument-guide", "SKILL.md"),
      "---\nname: instrument-guide\ndescription: How to use the app.\n---\nRead reference.md.\n",
    );
  });

  afterEach(async () => {
    await removeChatsDir(root);
  });

  const check = (text: string) => brokenLinksIn({ chatId, text });

  it.each([
    ["a fence line naming a file", "```files\nsales/report.md\n```"],
    ["a folder with a trailing slash", "```files\nsales/\n```"],
    ["a file link", "See [the report](sales/report.md)."],
    [
      "a file link by the app's address",
      "[r](instrument://file/CHATROOT/sales/report.md)",
    ],
    ["a path in angle brackets", "[f](<Drafts (2026)/a b.txt>)"],
    ["a path with parentheses", "[f](Drafts%20(2026)/a%20b.txt)"],
    ["a file: URL", "[r](REPORTURL)"],
    ["a reference link", "See [the report][r].\n\n[r]: sales/report.md"],
    ["link text with brackets", "[Q3 [v2] report](sales/report.md)"],
    ["a memory", "[no stevia](instrument://memory/no-stevia)"],
    ["a skill", "[the guide](instrument://skill/instrument-guide)"],
    [
      "a setting page and row",
      "[General](instrument://settings/general) [Theme](instrument://settings/theme)",
    ],
    ["a screen", "[notes](instrument://screen/release-notes)"],
    ["an app the directory knows", "[GitHub](instrument://app/github)"],
    ["a chat that exists", `[it](instrument://chat/${"CHAT"})`],
    ["a web address", "[docs](https://example.com/nothing-here)"],
    ["a task, which this cannot look up", "[t](instrument://task/t9)"],
    ["a chat by a prefix", "[it](instrument://chat/abc_)"],
    [
      "a link inside code",
      "Write `[x](missing.md)` and\n```md\n[y](gone.md)\n```",
    ],
  ])("passes %s", async (_label, text) => {
    // A path in a link is the shell's spelling of it, as the agent writes
    // it, and a file: URL is the file's own.
    expect(
      await check(
        text
          .replace("CHATROOT", shellPath(chatRoot))
          .replace(
            "REPORTURL",
            pathToFileURL(path.join(chatRoot, "sales", "report.md")).href,
          )
          .replace("CHAT", chatId),
      ),
    ).toEqual([]);
  });

  it("says when a link opens nothing for its shape rather than its file", async () => {
    expect(
      await check(
        [
          "[up](sales/../sales/report.md)",
          "[heading](sales/report.md#totals)",
          "[line](sales/report.md:12)",
          "[query](sales/report.md?v=2)",
          "[neither](sales/missing.md#totals)",
        ].join("\n"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "link": "sales/../sales/report.md",
          "reason": "the app opens no link through \`..\`: write the path without it",
        },
        {
          "link": "sales/report.md#totals",
          "reason": "the app opens no link ending in \`#totals\`: link the file alone",
        },
        {
          "link": "sales/report.md:12",
          "reason": "the app opens no link ending in \`:12\`: link the file alone",
        },
        {
          "link": "sales/report.md?v=2",
          "reason": "the app opens no link ending in \`?v=2\`: link the file alone",
        },
        {
          "link": "sales/missing.md#totals",
          "reason": "no file there",
        },
      ]
    `);
  });

  it("names every link that opens nothing, once each", async () => {
    expect(
      await check(
        [
          "Made [the CSV](squares.csv) and [again](squares.csv).",
          "[nope](instrument://memory/no-sugar)",
          "[skill](instrument://skill/weekly-status)",
          "[s](instrument://settings/not-a-setting)",
          "[s](instrument://screen/nowhere)",
          "[app](instrument://app/no-such-service-xyz)",
          "[chat](instrument://chat/nosuchchat)",
          "[Q3 plan [v2].txt](q3-plan.txt)",
          "[gone](file:///nowhere/gone.md)",
          "[by ref][gone]",
          "[two CSVs](instrument://chat/Make%20me%20two%20CSVs)",
          "[deep](instrument://skill/a/b)",
          "[odd](instrument://nowhere/x)",
          "[bare](instrument://settings)",
          "",
          "[gone]: missing/notes.md",
          "```files",
          "squares.csv",
          "sales/report.md/",
          "~/Desktop/out.png",
          "```",
        ].join("\n"),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "link": "squares.csv",
          "reason": "no file there",
        },
        {
          "link": "sales/report.md/",
          "reason": "no folder there",
        },
        {
          "link": "~/Desktop/out.png",
          "reason": "no file there",
        },
        {
          "link": "q3-plan.txt",
          "reason": "no file there",
        },
        {
          "link": "file:///nowhere/gone.md",
          "reason": "no file there",
        },
        {
          "link": "missing/notes.md",
          "reason": "no file there",
        },
        {
          "link": "instrument://chat/Make%20me%20two%20CSVs",
          "reason": "not an address the app opens",
        },
        {
          "link": "instrument://skill/a/b",
          "reason": "not an address the app opens",
        },
        {
          "link": "instrument://nowhere/x",
          "reason": "not an address the app opens",
        },
        {
          "link": "instrument://settings",
          "reason": "not an address the app opens",
        },
        {
          "link": "instrument://memory/no-sugar",
          "reason": "no memory by that name",
        },
        {
          "link": "instrument://skill/weekly-status",
          "reason": "no skill by that name",
        },
        {
          "link": "instrument://settings/not-a-setting",
          "reason": "no setting by that name",
        },
        {
          "link": "instrument://screen/nowhere",
          "reason": "no screen by that name",
        },
        {
          "link": "instrument://app/no-such-service-xyz",
          "reason": "no app by that name",
        },
        {
          "link": "instrument://chat/nosuchchat",
          "reason": "no chat by that id",
        },
      ]
    `);
  });
});
