import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { disposeSessionsStoreStorage } from "../lib/session-store-storage";
import { Store } from "../lib/store";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { runTool } from "../test/helpers/run-tool";
import { BashTool } from "./bash";

const model = createMockAIGatewayModel();
const createdAt = new Date("2026-01-01T00:00:00.000Z");

/**
 * The first `agent-browser` command a session runs brings the skill with it,
 * and the instructions come back whenever the model's view of the session no
 * longer holds them. `--help` stands in for a browser command: it is answered
 * by the wrapper without a browser, and it is still the command having run.
 */
describe("bash attaches the agent-browser skill", () => {
  let root: string;
  let taskId: ChatId;
  let sessionId: StoreId.Session;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bash-browser-skill-"));
    const taskDirPath = path.join(root, "tasks", `01k${"abs".padEnd(23, "0")}`);
    await fs.mkdir(path.join(taskDirPath, "work"), { recursive: true });
    taskId = createMockChatConfigForDir(taskDirPath, { model });
    sessionId = StoreId.newSessionId();
  });

  afterEach(async () => {
    await disposeSessionsStoreStorage(taskId);
    await fs.rm(root, { force: true, recursive: true });
  });

  async function bash(command: string) {
    const result = await runTool(BashTool, {
      input: { command, yieldMs: 30_000 },
      model,
      sessionId,
      signal: new AbortController().signal,
      taskId,
      taskState: { browserTabs: [] },
    });
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  /** Records a finished bash call the way a run does, so later calls see it. */
  async function record(
    output: Awaited<ReturnType<typeof bash>>,
  ): Promise<SessionMessage.Assistant> {
    const message: SessionMessage.Assistant = {
      id: StoreId.newMessageId(),
      metadata: {
        createdAt,
        finishReason: "tool-calls",
        modelId: "test-model",
        providerId: "test",
        sessionId,
      },
      role: "assistant",
    };
    (await Store.saveMessage(message, taskId))._unsafeUnwrap();
    (
      await Store.savePart(
        {
          input: { command: output.command, yieldMs: 30_000 },
          metadata: {
            createdAt,
            endedAt: createdAt,
            id: StoreId.newPartId(),
            messageId: message.id,
            sessionId,
          },
          output,
          state: "output-available",
          toolCallId: "call-1",
          type: "tool-bash",
        },
        taskId,
        { publish: false },
      )
    )._unsafeUnwrap();
    return message;
  }

  async function saveSession(rolledOverAfterMessageId?: StoreId.Message) {
    (
      await Store.saveSession(
        {
          createdAt,
          id: sessionId,
          rolledOverAfterMessageId,
          title: "Browsing",
        },
        taskId,
      )
    )._unsafeUnwrap();
  }

  it("attaches nothing to a command that is not agent-browser", async () => {
    expect((await bash("echo hi")).browserSkill).toBeUndefined();
  });

  it("attaches the skill to the first agent-browser command only", async () => {
    await saveSession();
    const first = await bash("agent-browser --help");
    expect(first.browserSkill).toMatchObject({
      content: expect.stringContaining("# agent-browser in Instrument"),
      origin: "instrument",
    });
    await record(first);

    expect((await bash("agent-browser --help")).browserSkill).toBeUndefined();
  });

  it("attaches it again once a rollover drops the turn that carried it", async () => {
    const earlier = await record(await bash("echo earlier"));
    const carried = await record(await bash("agent-browser --help"));
    await saveSession(earlier.id);
    expect((await bash("agent-browser --help")).browserSkill).toBeUndefined();

    await saveSession(carried.id);
    expect((await bash("agent-browser --help")).browserSkill).toBeDefined();
  });

  it("renders the skill last, after the command output", async () => {
    const output = await bash("agent-browser --help");
    const rendered = BashTool.toModelOutput({
      input: { command: output.command, yieldMs: 30_000 },
      output: {
        ...output,
        // A short guide, so the snapshot shows the frame around it.
        browserSkill: {
          content: "# Browser\n\nOpen, then act on refs.",
          contentTruncated: false,
          name: "agent-browser",
          origin: "instrument",
        },
        durationMs: 5,
        output: "help text\n",
      },
      toolCallId: "call-1",
    });
    if (rendered.type !== "text") {
      throw new TypeError(`Expected text output, got ${rendered.type}`);
    }
    expect(rendered.value).toMatchInlineSnapshot(`
      "Exit code: 0

      Command output:

      help text

      Duration: 5 ms

      <instrument-system-note>
      This is your first \`agent-browser\` command in this session, so its guide comes with the output below. Follow it for the rest of your browser work; there is no need to load it. \`agent-browser skills get core --full\` prints the references it links to.
      </instrument-system-note>

      Everything below is the text of the skill "agent-browser".

      # Browser

      Open, then act on refs."
    `);
  });
});
