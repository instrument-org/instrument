import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { chatLayout } from "../../test/helpers/chat-layout";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { grantApp } from "../permissions/apps";
import { asksWritten, openAsks } from "../permissions/asks";
import { setDenied } from "../permissions/denials";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  CALENDAR_COMMAND,
  CONTACTS_COMMAND,
  createMacHelperCommand,
} from "./mac-helper";

vi.mock("execa");

const ctx = createCommandContext({
  cwd: "/Users/sam/chat",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
});

/** The chat's own shell, where a session is there to hear a card's answer. */
function asking(chatId: ChatId) {
  const layout = chatLayout(chatId);
  return {
    ...layout,
    rules: {
      ...layout.rules,
      asker: { chatId, sessionId: StoreId.newSessionId() },
    },
  };
}

// The mock workspace outlives a run, so each run's chats are its own.
const RUN = Math.random().toString(36).slice(2, 8);
let chats = 0;
/**
 * A chat of its own, so one test's grant or "not now" holds nowhere else,
 * in a build that carries the helper unless `helper` is false.
 */
function newChat(helper = true) {
  chats += 1;
  const chatId = createMockChatConfig(
    ChatIdSchema.parse(`mac-helper-${RUN}-${chats}`),
  );
  if (helper) {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
    });
  }
  return chatId;
}

const COMMANDS = {
  [CALENDAR_COMMAND.name]: CALENDAR_COMMAND,
  [CONTACTS_COMMAND.name]: CONTACTS_COMMAND,
};

async function helperAnswers() {
  const { execa } = await import("execa");
  vi.mocked(execa).mockResolvedValueOnce({ all: "[]", exitCode: 0 } as never);
  return vi.mocked(execa);
}

describe("mac helper commands", () => {
  const config = getWorkspaceConfig();

  afterEach(() => {
    setWorkspaceConfig(config);
    vi.resetAllMocks();
  });

  it("runs the bundled helper with the arguments as given", async () => {
    const chatId = newChat();
    await grantApp(chatId, "Calendar");
    const execa = await helperAnswers();

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      chatId,
      chatLayout(chatId),
    ).execute(["events", "--from", "tomorrow"], ctx);

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      "/app/bin/instrument-mac",
      ["events", "--from", "tomorrow"],
      expect.objectContaining({ stdin: "ignore" }),
    );
  });

  it("asks the helper for contacts under its own subcommand", async () => {
    const chatId = newChat();
    await grantApp(chatId, "Contacts");
    const execa = await helperAnswers();

    await createMacHelperCommand(
      CONTACTS_COMMAND,
      chatId,
      chatLayout(chatId),
    ).execute(["--search", "neil"], ctx);

    expect(execa).toHaveBeenCalledWith(
      "/app/bin/instrument-mac",
      ["contacts", "--search", "neil"],
      expect.anything(),
    );
  });

  // Each subcommand is held to the app it reads, so a chat's first look into
  // one asks the person once, by the name Settings lists it under.
  it.each([
    ["calendar", ["events"], "Calendar"],
    ["calendar", ["add-event", "--title", "Dinner"], "Calendar"],
    ["calendar", ["reminders"], "Reminders"],
    ["calendar", ["add-reminder", "--title", "Call Sam"], "Reminders"],
    ["contacts", ["--search", "neil"], "Contacts"],
  ] as const)(
    "%s %j asks for %s first, then runs once it is allowed",
    async (name, given, app) => {
      const command = COMMANDS[name];
      const args = [...given];
      const chatId = newChat();
      const { execa } = await import("execa");

      const asked = await createMacHelperCommand(
        command,
        chatId,
        asking(chatId),
      ).execute(args, ctx);
      await asksWritten();

      expect(asked.exitCode).toBe(1);
      expect(asked.stderr).toBe(
        `${command.name}: refused: Waiting on the person to allow ${app}. If the rest of the job needs it, end your turn here; you'll be woken with their answer. Run this again once they allow it.\n`,
      );
      expect(await openAsks(chatId)).toEqual([
        expect.objectContaining({ kind: "app", target: app }),
      ]);
      expect(vi.mocked(execa)).not.toHaveBeenCalled();

      await grantApp(chatId, app);
      await helperAnswers();
      const allowed = await createMacHelperCommand(
        command,
        chatId,
        asking(chatId),
      ).execute(args, ctx);
      expect(allowed.exitCode).toBe(0);
      expect(vi.mocked(execa)).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a not now for the chat, and raises no card again", async () => {
    const chatId = newChat();
    await setDenied(chatId, "app", "Contacts", true);
    const { execa } = await import("execa");

    const result = await createMacHelperCommand(
      CONTACTS_COMMAND,
      chatId,
      asking(chatId),
    ).execute(["--search", "neil"], ctx);
    await asksWritten();

    expect(result.stderr).toBe(
      "contacts: refused: the person said not now to Contacts in this chat. Don't look for another way to use it; say what you skipped without it.\n",
    );
    expect(await openAsks(chatId)).toEqual([]);
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("holds Calendar and Reminders apart", async () => {
    const chatId = newChat();
    await grantApp(chatId, "Calendar");

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      chatId,
      chatLayout(chatId),
    ).execute(["reminders"], ctx);

    expect(result.stderr).toContain("using Reminders needs the person's yes");
  });

  // The helper answers more than Calendar and Reminders; `calendar` passes
  // on only its own subcommands, so none of the rest gets past the gate.
  it.each([
    ["contacts", "--search", "neil"],
    ["icloud-folders"],
    ["access", "contacts"],
    [],
  ])("refuses calendar %j", async (...args) => {
    const chatId = newChat();
    await grantApp(chatId, "Calendar");
    await grantApp(chatId, "Reminders");
    const { execa } = await import("execa");

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      chatId,
      chatLayout(chatId),
    ).execute(args, ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "calendar: takes add-event, add-reminder, calendars, events, lists, reminders",
    );
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });

  it("says there is no other way in, in a build without the helper", async () => {
    const chatId = newChat(false);

    const result = await createMacHelperCommand(
      CALENDAR_COMMAND,
      chatId,
      chatLayout(chatId),
    ).execute(["events"], ctx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "calendar: not available in this build, which has no other way into Calendar and Reminders. Tell the person what you couldn't do.\n",
    );
  });
});
