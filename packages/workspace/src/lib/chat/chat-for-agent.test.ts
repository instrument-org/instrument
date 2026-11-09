import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import {
  chatDeveloperDetailsText,
  chatForAgentText,
  type ChatPlaces,
} from "./chat-for-agent";

const id = ChatIdSchema.parse("2026-11-08-help-desk-pricing");

/** The text with the platform's separator written as `/`, since each folder ends in `path.sep`. */
const posix = (text: string) => text.replaceAll("\\", "/");
const root = "/Users/mac-user/Instrument";

const filed: ChatPlaces = {
  chatFolder: `${root}/Chats/Help desk pricing`,
  id,
  instrumentFolder: root,
  project: { folder: `${root}/Projects/Pricing`, name: "Pricing" },
  recordsFolder: `${root}/.instrument/chats/${id}`,
  title: "Help desk pricing",
  workFolder: `/Users/mac-user/.instrument/work/Instrument/${id}`,
};

describe("chatForAgentText", () => {
  it("names every folder of a chat filed under a project", () => {
    expect(posix(chatForAgentText(filed))).toMatchInlineSnapshot(`
      "This is a chat from Instrument, a desktop app where a person works with an AI agent on their own computer. They copied it so you can pick up from what it did.

      Chat: Help desk pricing
      Project: Pricing

      Its folder: /Users/mac-user/Instrument/Chats/Help desk pricing/
        CHAT.md there is the whole conversation in Markdown. Read it first. Instrument rewrites it as the chat goes on, so changes to it won't last.
        Everything else there is what the chat made.

      Its project's folder: /Users/mac-user/Instrument/Projects/Pricing/
        AGENTS.md there has the standing instructions this chat followed. A chat filed under a project saves its lasting files here.

      Its work folder: /Users/mac-user/.instrument/work/Instrument/2026-11-08-help-desk-pricing/
        Scratch space on this computer: downloads, drafts and in-between files the chat didn't keep. It may not exist if the chat left nothing there.

      The person's Instrument folder is /Users/mac-user/Instrument/. Memory/ there has one Markdown file per thing Instrument remembers about them, and Skills/ has the skills its agent uses. Leave .instrument/ alone, since it has the app's own records."
    `);
  });

  it("leaves out what a chat in the app's own data has no folder for", () => {
    expect(
      posix(
        chatForAgentText({
          id,
          recordsFolder: filed.recordsFolder,
          title: "Help desk pricing",
          workFolder: filed.workFolder,
        }),
      ),
    ).toMatchInlineSnapshot(`
      "This is a chat from Instrument, a desktop app where a person works with an AI agent on their own computer. They copied it so you can pick up from what it did.

      Chat: Help desk pricing

      Its work folder: /Users/mac-user/.instrument/work/Instrument/2026-11-08-help-desk-pricing/
        Scratch space on this computer: downloads, drafts and in-between files the chat didn't keep. It may not exist if the chat left nothing there."
    `);
  });
});

describe("chatDeveloperDetailsText", () => {
  it("names each line for what it is", () => {
    expect(
      posix(
        chatDeveloperDetailsText(filed, {
          app: "2.0.0-beta.133 (packaged)",
          computer: "macOS 25.6.0 (arm64), named mac-user-mac",
          mainThread: "ses_01M6VW5654CWFMKTVCKZFNS5CX",
          startedWith: "2.0.0-beta.131",
        }),
      ),
    ).toMatchInlineSnapshot(`
      "Chat: Help desk pricing
      Chat ID: 2026-11-08-help-desk-pricing
      Chat folder: /Users/mac-user/Instrument/Chats/Help desk pricing/
      Work folder: /Users/mac-user/.instrument/work/Instrument/2026-11-08-help-desk-pricing/
      Records folder: /Users/mac-user/Instrument/.instrument/chats/2026-11-08-help-desk-pricing/
        One log per thread per computer, settings, and attachments.
      Project: Pricing
      Main thread: ses_01M6VW5654CWFMKTVCKZFNS5CX
        The chat's own conversation. Each task is a thread of its own beside it.
      App: 2.0.0-beta.133 (packaged), chat started on 2.0.0-beta.131
      Computer: macOS 25.6.0 (arm64), named mac-user-mac"
    `);
  });
});
