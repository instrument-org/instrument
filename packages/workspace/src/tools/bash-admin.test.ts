import { describe, expect, it, vi } from "vitest";

import { openAsks } from "../lib/chat/open-asks";
import { sessionOfChat } from "../lib/record-folders";
import { chatFor } from "../test/helpers/chat-record";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { runTool } from "../test/helpers/run-tool";
import {
  ADMIN_NEEDS_REASON,
  ADMIN_NO_SUDO,
} from "../model-text/notes/admin-command-model-text";
import { BashTool } from "./bash";

const model = createMockAIGatewayModel();
const TIME_ZONE = "systemsetup -settimezone America/New_York";

async function adminCall(input: { command: string; reason?: string }) {
  const chatId = await chatFor();
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error("expected the chat's session");
  }
  const result = await runTool(BashTool, {
    chatId,
    input: { admin: true, yieldMs: 1000, ...input },
    model,
    sessionId,
    signal: new AbortController().signal,
  });
  const output = result._unsafeUnwrap();
  return {
    chatId,
    model: BashTool.toModelOutput({
      input: { admin: true, yieldMs: 1000, ...input },
      output,
      toolCallId: "1",
    }),
    output,
  };
}

describe.runIf(process.platform !== "linux")("bash with admin", () => {
  it("puts the exact command on a card and runs nothing", async () => {
    const command = `${TIME_ZONE}; echo "it's $HOME"`;
    const {
      chatId,
      model: told,
      output,
    } = await adminCall({
      command,
      reason: "Changes the time zone to Eastern Time.",
    });
    expect(output).toMatchObject({ admin: "asked", output: "" });
    expect(output.asks).toHaveLength(1);
    expect(await openAsks(chatId)).toEqual([
      expect.objectContaining({
        askers: [
          expect.objectContaining({
            reason: "Changes the time zone to Eastern Time.",
          }),
        ],
        kind: "admin",
        status: "open",
        target: command,
      }),
    ]);
    expect(told).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "The user now sees a card above the reply box with this command. Their answer reaches you as a message of its own.",
      }
    `);
  });

  it.each([
    [
      "sudo in it",
      { command: `sudo ${TIME_ZONE}`, reason: "Time zone." },
      ADMIN_NO_SUDO,
    ],
    [
      "sudo after a semicolon",
      { command: "cd /; sudo ls", reason: "List." },
      ADMIN_NO_SUDO,
    ],
    ["no reason", { command: TIME_ZONE }, ADMIN_NEEDS_REASON],
    [
      "a blank reason",
      { command: TIME_ZONE, reason: "  " },
      ADMIN_NEEDS_REASON,
    ],
    [
      "too long a command",
      { command: "x".repeat(8001), reason: "Long." },
      "Nothing ran: the command is 8001 characters, and one run as an administrator takes at most 8000. Split it into smaller steps.",
    ],
  ])("refuses %s, raising no card", async (_, input, said) => {
    const { chatId, model: told, output } = await adminCall(input);
    expect(output.admin).toBe("refused");
    expect(told).toEqual({ type: "error-text", value: said });
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("leaves a word that only contains sudo alone", async () => {
    const { output } = await adminCall({
      command: "echo pseudocode; ls /var/db/sudo_lecture",
      reason: "List.",
    });
    expect(output.admin).toBe("asked");
  });
});

describe("bash with admin on Linux", () => {
  it("refuses, telling the agent to give the steps in words", async () => {
    const platform = vi.spyOn(process, "platform", "get");
    platform.mockReturnValue("linux");
    try {
      const { chatId, model: told } = await adminCall({
        command: TIME_ZONE,
        reason: "Time zone.",
      });
      expect(told).toMatchInlineSnapshot(`
        {
          "type": "error-text",
          "value": "Nothing ran: this computer has no way to run a command as an administrator. Give the user the steps in words, with the command to run themselves if one does it.",
        }
      `);
      expect(await openAsks(chatId)).toEqual([]);
    } finally {
      platform.mockRestore();
    }
  });
});
