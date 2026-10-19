import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import { errAsync } from "neverthrow";
import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { chatFolderNames } from "../../lib/chat-folders/own-folder";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { message } from "./message";

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
}));

// Titling a chat asks a model, which this test has none of.
vi.mock(import("../../lib/generate-title-from-user-message"), () => ({
  generateTitleFromUserMessage: () =>
    errAsync({ message: "no model here", originalError: undefined }),
}));

const context = () => ({
  workspaceConfig: getWorkspaceConfig(),
  // The send only hands the session its message, so the cast spares the
  // test a workspace machine.
  workspaceRef: { send: () => undefined } as unknown as WorkspaceActorRef,
});

it("writes the chat's CHAT.md with the message the person sent", async () => {
  const chatId = await chatFor(StoreId.newSessionId());

  await call(
    message.create,
    {
      id: chatId,
      modelURI: AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
      prompt: "Which dishwasher is quietest?",
    },
    { context: context() },
  );

  const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
  await vi.waitFor(() => {
    const folder = chatFolderNames(workspaceMachineDir).get(chatId);
    expect(folder).toBeDefined();
    expect(
      fs.readFileSync(
        path.join(rootDir, CHATS_FOLDER_NAME, folder ?? "", CHAT_FILE_NAME),
        "utf8",
      ),
    ).toContain("Which dishwasher is quietest?");
  });
});
