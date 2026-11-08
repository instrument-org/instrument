import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AIGatewayModelURI } from "@instrument-org/ai-gateway/schemas";

import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, RelativePathSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { sessionToShorthand } from "../../test/helpers/session-to-shorthand";
import { branchedFromModelNote } from "../branched-from-model-text";
import { chatAttachmentsDir } from "../chat-dir-utils";
import { ChatReads } from "../chat-reads";
import { chatModelURI, setChatModel } from "../chat-settings";
import { ChatWrites } from "../chat-writes";
import {
  readChatPermissions,
  updateChatPermissions,
} from "../permissions/rules";
import { chatDir, sessionOfChat } from "../record-folders";
import { branchChat, branchTitle } from "./branch-chat";
import { ensureChat } from "./chat-records";
import { chatById, renameChat, setChatProject } from "./chats";
import { createProject } from "./projects";

// Nothing runs in a test, which the chat list asks the machine about.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
  isWorking: () => false,
}));

let clock = Date.UTC(2026, 10, 8, 15, 0);
const nextMoment = () => new Date((clock += 1000));

/** A message of `role` with words, as the chat's own session holds one. */
function said(
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  text: string,
  /** A file the person sent with it, by its name in the chat's `attachments/`. */
  sent?: string,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = nextMoment();
  const part = () => ({
    createdAt,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  });
  const parts: SessionMessage.WithParts["parts"] = [
    { metadata: part(), state: "done", text, type: "text" },
    ...(sent === undefined
      ? []
      : [
          {
            data: {
              files: [
                {
                  filename: sent,
                  filePath: RelativePathSchema.parse(`attachments/${sent}`),
                  mimeType: "text/csv",
                  modifiedAt: 0,
                  size: 11,
                },
              ],
            },
            metadata: part(),
            type: "data-attachments" as const,
          },
        ]),
  ];
  return role === "user"
    ? { id, metadata: { createdAt, sessionId }, parts, role }
    : {
        id,
        metadata: {
          createdAt,
          finishReason: "stop",
          modelId: "m",
          providerId: "openai",
          sessionId,
        },
        parts,
        role,
      };
}

async function write(chatId: ChatId, message: SessionMessage.WithParts) {
  const written = await ChatWrites.saveMessageWithParts(message, chatId);
  if (written.isErr()) {
    throw written.error;
  }
  return message;
}

/** A chat named `title` with two exchanges, the first with a file the person sent. */
async function pricingChat(title: string) {
  const sessionId = StoreId.newSessionId();
  const chatId = await ensureChat(sessionId, title);
  await renameChat(chatId, title);
  const attachments = path.join(chatDir(chatId), "attachments");
  await fs.mkdir(attachments, { recursive: true });
  await fs.writeFile(path.join(attachments, "plans.csv"), "tier,price\n");
  await write(
    chatId,
    said(sessionId, "user", "Compare our pricing with Zendesk.", "plans.csv"),
  );
  const reply = await write(
    chatId,
    said(sessionId, "assistant", "At 10 agents we're 18% under Zendesk."),
  );
  await write(chatId, said(sessionId, "user", "Redo it for 25 agents."));
  await write(chatId, said(sessionId, "assistant", "At 25 the gap narrows."));
  return { chatId, reply, sessionId };
}

async function conversationOf(chatId: ChatId) {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error(`${chatId} has no session`);
  }
  return sessionToShorthand(
    await ChatReads.sessionWithMessages({ chatId, sessionId }),
  );
}

describe("branchChat", () => {
  it("copies the conversation up to the reply and ends it with the note", async () => {
    const { chatId, reply } = await pricingChat("Help desk pricing");

    const branch = await branchChat({ chatId, upTo: reply.id });

    expect((await chatById(branch))?.title).toBe("Help desk pricing 2");
    expect((await conversationOf(branch)).replaceAll(chatId, "<original>"))
      .toMatchInlineSnapshot(`
        "<session title="Help desk pricing 2" count="3">
          <user>
            <text state="done">Compare our pricing with Zendesk.</text>
            <data-attachments>
              <file filename="plans.csv" mimeType="text/csv" size="11" />
            </data-attachments>
          </user>
          <assistant finishReason="stop" model="m" provider="openai">
            <text state="done">At 10 agents we're 18% under Zendesk.</text>
          </assistant>
          <user>
            <data-branchedFrom chat="<original>">Help desk pricing</data-branchedFrom>
          </user>
        </session>"
      `);
  });

  it("leaves the chat it came from as it was", async () => {
    const { chatId, reply } = await pricingChat("Quiet dishwashers");
    const before = await conversationOf(chatId);

    await branchChat({ chatId, upTo: reply.id });

    expect(await conversationOf(chatId)).toBe(before);
  });

  it("keeps the chat's project, model and what it was allowed into, and the file the person sent", async () => {
    const { chatId, reply } = await pricingChat("Board deck");
    const project = await createProject({ name: "Board" });
    await setChatProject(chatId, project.id);
    const model = AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    );
    const set = await setChatModel(chatId, model);
    expect(set.isOk()).toBe(true);
    const grant = {
      grantedAt: new Date(Date.UTC(2026, 10, 8)),
      path: AbsolutePathSchema.parse("/Users/mac-user/Decks"),
      source: "card" as const,
    };
    await updateChatPermissions(chatId, (held) => ({
      ...held,
      grants: [grant],
    }));

    const branch = await branchChat({ chatId, upTo: reply.id });

    expect((await chatById(branch))?.project).toBe(project.id);
    expect(await chatModelURI(branch)).toBe(model);
    expect((await readChatPermissions(branch)).grants).toEqual([grant]);
    await expect(
      fs.readFile(
        path.join(chatAttachmentsDir(chatDir(branch)), "plans.csv"),
        "utf8",
      ),
    ).resolves.toBe("tier,price\n");
  });

  it("refuses a message the chat doesn't have", async () => {
    const { chatId } = await pricingChat("Renewals");

    await expect(
      branchChat({ chatId, upTo: StoreId.newMessageId() }),
    ).rejects.toThrow(/has no message/);
  });
});

describe("branchTitle", () => {
  it.each([
    { taken: [], title: "Pricing", want: "Pricing 2" },
    { taken: ["Pricing 2"], title: "Pricing", want: "Pricing 3" },
    { taken: ["Pricing", "Pricing 2"], title: "Pricing 2", want: "Pricing 3" },
    { taken: [], title: "Q3 report 2024", want: "Q3 report 2024 2" },
  ])("names a branch of $title $want", ({ taken, title, want }) => {
    expect(branchTitle(title, new Set([title, ...taken]))).toBe(want);
  });
});

describe("branchedFromModelNote", () => {
  it("names the chat and each of its folders", () => {
    expect(
      branchedFromModelNote({
        chat: "2026-11-08-help-desk-pricing-7k3q",
        folder: "/Users/mac-user/Instrument/Chats/Help desk pricing",
        records:
          "/Users/mac-user/Instrument/.instrument/chats/2026-11-08-help-desk-pricing-7k3q",
        title: "Help desk pricing",
        work: "/Users/mac-user/.instrument/work/Instrument/2026-11-08-help-desk-pricing-7k3q",
      }),
    ).toMatchInlineSnapshot(`
      "This chat is a branch of "Help desk pricing", copied up to the reply above. That chat is still there and goes on separately.

      Its folder: /Users/mac-user/Instrument/Chats/Help desk pricing/
      Its work folder: /Users/mac-user/.instrument/work/Instrument/2026-11-08-help-desk-pricing-7k3q/
      Its records: /Users/mac-user/Instrument/.instrument/chats/2026-11-08-help-desk-pricing-7k3q/

      Read from them when you need a file it made. Put new work in this chat's own folders."
    `);
  });
});
