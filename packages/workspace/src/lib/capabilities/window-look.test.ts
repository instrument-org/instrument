import { mkdir } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { createLocalBashEnv } from "../create-bash-env";
import { chatDir } from "../record-folders";

const chatId = ChatIdSchema.parse("window-look");

beforeAll(async () => {
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
});

async function look(role: "chat" | "task", command = "instrument window look") {
  const bash = await createLocalBashEnv({
    chatId,
    role,
    sessionId: StoreId.newSessionId(),
  });
  return bash.exec(command);
}

describe("instrument window look", () => {
  it("is refused to a task, saying what to do instead", async () => {
    const result = await look("task");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument window: only the chat looks at the user's window, while it answers them. Say in your report what you would need to know about it.
      "
    `);
  });

  it("is refused to a chat turn no message from the window started", async () => {
    const result = await look("chat");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument window: you can look at the user's window only while answering a message they just sent from it. Ask them what they see.
      "
    `);
  });

  it("is not in a script's reach", async () => {
    const result = await look(
      "chat",
      `node --input-type=module -e 'try { await instrument.window.look({}); } catch (error) { console.log(error.message); }'`,
    );
    expect(result.stdout).toMatchInlineSnapshot(`
      "there is no capability "window.look".
      "
    `);
  });
});
