import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { chatFor } from "../test/helpers/chat-record";
import { chatModelURI, setChatModel } from "./chat-settings";
import { ChatWrites } from "./chat-writes";
import { chatDir, sessionOfChat } from "./record-folders";
import { parseRecordFileName } from "./records/file-names";

const GLM = AIGatewayModelURI.Schema.parse(
  "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
);
const OPUS = AIGatewayModelURI.Schema.parse(
  "anthropic/claude-opus-5.5?provider=openrouter&providerConfigId=mock-provider-config-id",
);

/** Every line of the chat's settings files. */
async function settingsLines(chatId: Parameters<typeof chatDir>[0]) {
  const names = (await fs.readdir(chatDir(chatId))).filter(
    (name) => parseRecordFileName(name)?.kind === "settings",
  );
  const texts = await Promise.all(
    names.map((name) => fs.readFile(path.join(chatDir(chatId), name), "utf8")),
  );
  return texts.flatMap((text) => text.trimEnd().split("\n"));
}

describe("the chat's model", () => {
  it("is none until the composer sends with one", async () => {
    expect(await chatModelURI(await chatFor())).toBeUndefined();
  });

  it("is the newest pick, and the same pick again writes nothing", async () => {
    const chatId = await chatFor();

    (await setChatModel(chatId, GLM))._unsafeUnwrap();
    (await setChatModel(chatId, OPUS))._unsafeUnwrap();
    (await setChatModel(chatId, OPUS))._unsafeUnwrap();

    expect(await chatModelURI(chatId)).toBe(OPUS);
    expect(await settingsLines(chatId)).toHaveLength(2);
  });

  it("reads a model this build cannot parse as none", async () => {
    const chatId = await chatFor();
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("expected the chat's session");
    }

    (
      await ChatWrites.setting(chatId, sessionId, {
        field: "model",
        value: "retired/provider-model",
      })
    )._unsafeUnwrap();

    expect(await chatModelURI(chatId)).toBeUndefined();
  });
});
