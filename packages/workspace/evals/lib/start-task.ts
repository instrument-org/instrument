import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { encodeUtf8ToBytes, InMemoryFs } from "just-bash";

import { cliSubcommands, runSubcommand } from "../../src/lib/capabilities/cli";
import { ChatWrites } from "../../src/lib/chat-writes";
import { type ChatId } from "../../src/schemas/chat-id";
import { StoreId } from "../../src/schemas/store-id";

/** What the chat's stand-in first step hands its task, as `task new` takes it. */
export interface StartsTask {
  /** What stdin tells the task to do. */
  brief: string;
  name: string;
  /** Tabs of the user's to hand it, as `--tab` names them. */
  tabs?: string[];
}

const TASK_NEW = cliSubcommands("task").subcommands.new;

/**
 * Starts t1 as the chat's first reply would, through the `task new` command
 * itself, and writes that reply into the chat: a step whose one call ran the
 * command, with what it printed. The chat's own first turn never runs, so a
 * case scoring the task plumbing gets its task on every model, whatever that
 * model would have chosen; the user's message is the task's fork point.
 */
export async function startTaskForChat(
  chatId: ChatId,
  sessionId: StoreId.Session,
  { brief, name, tabs = [] }: StartsTask,
  /** The chat's model, which the step is recorded as answering from. */
  model: AIGatewayModel.Type,
): Promise<void> {
  if (!TASK_NEW) {
    throw new Error("no instrument task new");
  }
  const tabArgs = tabs.flatMap((tab) => ["--tab", tab]);
  const command = `instrument task new --name '${name}'${tabArgs.map((arg) => ` ${arg}`).join("")} <<'EOF'\n${brief}\nEOF`;
  const startedAt = new Date();
  const result = await runSubcommand(
    TASK_NEW,
    ["--name", name, ...tabArgs],
    {
      chatId,
      remainingYieldMs: () => Number.POSITIVE_INFINITY,
      role: "chat",
      sessionId,
    },
    { cwd: "/", fs: new InMemoryFs(), stdin: encodeUtf8ToBytes(`${brief}\n`) },
    { name: "instrument task new" },
  );
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    throw new Error(`startsTask: ${output}`);
  }
  const endedAt = new Date();
  const messageId = StoreId.newMessageId();
  const meta = () => ({
    createdAt: startedAt,
    id: StoreId.newPartId(),
    messageId,
    sessionId,
  });
  (
    await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: {
          createdAt: startedAt,
          finishedAt: endedAt,
          // As the chat's own model's step, so its next turn is not told
          // the model changed.
          aiGatewayModel: model,
          finishReason: "stop",
          modelId: model.canonicalId,
          providerId: model.providerId,
          sessionId,
        },
        parts: [
          {
            input: {
              command,
              explanation: `Starting a task: ${name}`,
              yieldMs: 10_000,
            },
            metadata: { ...meta(), endedAt },
            output: {
              command,
              commands: ["instrument"],
              durationMs: endedAt.getTime() - startedAt.getTime(),
              exitCode: 0,
              omittedBytes: 0,
              output,
            },
            state: "output-available",
            toolCallId: `stand-in-${messageId}`,
            type: "tool-bash",
          },
          { metadata: meta(), state: "done", text: "On it.", type: "text" },
        ],
        role: "assistant",
      },
      chatId,
    )
  )._unsafeUnwrap();
}
