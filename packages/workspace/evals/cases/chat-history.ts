/**
 * Does the chat find what an earlier chat said or did, from that chat's
 * records, and link it?
 *
 * Every chat's records are open to the agent, read-only, at
 * `$INSTRUMENT_CHATS`: one JSONL log per session, tool calls and their output
 * included. Each case seeds an earlier chat whose answer sits somewhere a
 * summary of the conversation would leave out:
 *
 * - **In a command it ran.** The reply said what came of it; only the call
 *   says how.
 * - **In a task.** The chat relayed that the task was done; the task's own
 *   session holds the finding.
 * - **Nowhere the user points.** The new ask never mentions the earlier chat,
 *   which settled the terms the work needs.
 *
 * Each case also records whether the run read the records and whether the
 * reply linked the chat, as evidence rather than as a score.
 */
import { APP_NAME_SLUG } from "@instrument-org/shared";

import { addChildTask } from "../../src/lib/chat/children";
import { ensureChat } from "../../src/lib/chat/chat-records";
import { ChatWrites } from "../../src/lib/chat-writes";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type ChatId } from "../../src/schemas/chat-id";
import { StoreId } from "../../src/schemas/store-id";
import { type Assertion, defineEval } from "../harness";
import { fail, pass, said, treeSessions } from "./handoff";

type Context = Parameters<Assertion["check"]>[0];

const DAY = 86_400_000;

/** One seeded message, with a text part and whatever else it carries. */
async function seed(
  chatId: ChatId,
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  at: Date,
  text: string,
  extra: (messageId: StoreId.Message) => SessionMessagePart.Type[] = () => [],
) {
  const id = StoreId.newMessageId();
  const textPart = {
    metadata: {
      createdAt: at,
      id: StoreId.newPartId(),
      messageId: id,
      sessionId,
    },
    text,
    type: "text" as const,
  };
  const parts = [...extra(id), textPart];
  const message =
    role === "user"
      ? {
          id,
          metadata: { createdAt: at, sessionId },
          parts,
          role: "user" as const,
        }
      : {
          id,
          metadata: {
            createdAt: at,
            finishReason: "stop" as const,
            finishedAt: at,
            modelId: "seeded",
            providerId: "seeded",
            sessionId,
          },
          parts,
          role: "assistant" as const,
        };
  (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
  return id;
}

/** A finished bash call, as the records keep one. */
function bashCall(
  messageId: StoreId.Message,
  sessionId: StoreId.Session,
  at: Date,
  command: string,
  output: string,
): SessionMessagePart.Type {
  return {
    input: { command, explanation: "running it", yieldMs: 10_000 },
    metadata: {
      createdAt: at,
      endedAt: at,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 4000,
      exitCode: 0,
      omittedBytes: 0,
      output,
    },
    state: "output-available",
    toolCallId: `call-${StoreId.newPartId()}`,
    type: "tool-bash",
  };
}

/** The ids of the chats each case seeded, for the link check. */
const seeded = new Map<string, ChatId>();

function replies(ctx: Context): string {
  return said(ctx.sessions)
    .map((one) => one.text)
    .join("\n");
}

/** Whether the run read the records, and whether the reply linked the chat. Recorded, not scored. */
function foundBy(name: string): Assertion {
  return {
    check: async (ctx) => {
      const text = "how it found the chat (recorded, not scored)";
      const commands = (await treeSessions(ctx)).flatMap((session) =>
        session.messages.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "tool-bash" && typeof part.input?.command === "string"
              ? [part.input.command]
              : [],
          ),
        ),
      );
      const reads = commands.filter((command) =>
        /\bINSTRUMENT_CHATS\b|\.instrument\/chats\b/.test(command),
      );
      const id = seeded.get(name);
      const linked =
        id !== undefined &&
        replies(ctx).includes(`${APP_NAME_SLUG}://chat/${id}`);
      return pass(
        text,
        `${reads.length} command(s) read the records${reads[0] ? ` (first: ${reads[0].slice(0, 120)})` : ""}; ${linked ? "linked" : "did not link"} the chat`,
      );
    },
    text: "how it found the chat (recorded, not scored)",
  };
}

function repliedWith(text: string, patterns: RegExp[]): Assertion {
  return {
    check: (ctx) => {
      const reply = replies(ctx);
      const missing = patterns.filter((pattern) => !pattern.test(reply));
      return missing.length === 0
        ? pass(text, reply.slice(0, 200))
        : fail(
            text,
            `missing ${missing.map(String).join(", ")}; reply: ${reply.slice(0, 200)}`,
          );
    },
    text,
  };
}

// ---------------------------------------------------------------------------
// old-command: the answer is in a command an earlier chat ran
// ---------------------------------------------------------------------------

const SHRINK =
  'ffmpeg -i "Screen Recording 2026-09-24.mov" -vf scale=1280:-2 -c:v libx264 -crf 28 -preset slow -an "demo-small.mp4"';

async function seedOldCommand() {
  const start = Date.now() - 23 * DAY;
  const sessionId = StoreId.newSessionId();
  const ask =
    "My screen recording for the demo is 240 MB, way too big to email. Can you make it smaller? It's in Downloads.";
  const chatId = await ensureChat(sessionId, ask);
  seeded.set("chat-history-old-command", chatId);
  await seed(chatId, sessionId, "user", new Date(start), ask);
  await seed(
    chatId,
    sessionId,
    "assistant",
    new Date(start + 60_000),
    "Done: demo-small.mp4 is 11 MB, sharp enough to read the text, and the audio is gone since there wasn't any.",
    (messageId) => [
      bashCall(
        messageId,
        sessionId,
        new Date(start + 30_000),
        SHRINK,
        "frame= 5412 fps=180 q=-1.0 Lsize=   11204kB time=00:03:00.40 bitrate= 508.7kbits/s speed=5.99x",
      ),
    ],
  );
  await seed(
    chatId,
    sessionId,
    "user",
    new Date(start + 120_000),
    "perfect, thanks",
  );
}

// ---------------------------------------------------------------------------
// in-a-task: the answer is in a task's session
// ---------------------------------------------------------------------------

async function seedInATask() {
  const start = Date.now() - 16 * DAY;
  const sessionId = StoreId.newSessionId();
  const ask =
    "Find me a warm white for the hallway. North-facing, so nothing that goes gray.";
  const chatId = await ensureChat(sessionId, ask);
  seeded.set("chat-history-in-a-task", chatId);
  const asked = await seed(chatId, sessionId, "user", new Date(start), ask);
  await seed(
    chatId,
    sessionId,
    "assistant",
    new Date(start + 5000),
    "Looking into warm whites that hold up in north light.",
  );
  const task = await addChildTask(chatId, {
    createdAt: new Date(start + 6000),
    forkedAtMessageId: asked,
    id: StoreId.newSessionId(),
    title: "Warm white for a north-facing hallway",
    updatedAt: new Date(start + 300_000),
  });
  await seed(
    chatId,
    task.id,
    "assistant",
    new Date(start + 290_000),
    "Best match: Benjamin Moore White Dove (OC-17). Warm without going yellow, LRV 85, and reviewers with north-facing rooms say it stays creamy rather than gray. Runners-up: Swiss Coffee (OC-45), a touch more yellow, and Alabaster (SW 7008) from Sherwin-Williams.",
  );
  await seed(
    chatId,
    sessionId,
    "assistant",
    new Date(start + 310_000),
    "Found one that should work, plus two backups. The first pick is the one I'd go with.",
  );
  await seed(
    chatId,
    sessionId,
    "user",
    new Date(start + 400_000),
    "great, going with the first",
  );
}

// ---------------------------------------------------------------------------
// unprompted: an earlier chat settled what the work needs
// ---------------------------------------------------------------------------

async function seedUnprompted() {
  const start = Date.now() - 34 * DAY;
  const sessionId = StoreId.newSessionId();
  const ask =
    "Northwind signed! I'm billing them $165 an hour, net 15, and invoices go to ap@northwind.example with their PO number NW-4471 on every one.";
  const chatId = await ensureChat(sessionId, ask);
  seeded.set("chat-history-unprompted", chatId);
  await seed(chatId, sessionId, "user", new Date(start), ask);
  await seed(
    chatId,
    sessionId,
    "assistant",
    new Date(start + 20_000),
    "Congrats on Northwind. Got it: $165/hour, net 15, to ap@northwind.example, with PO NW-4471.",
  );
}

export const CHAT_HISTORY_EVALS = [
  defineEval({
    assertions: [
      repliedWith("gave the command the earlier chat ran", [
        /-crf 28/,
        /scale=1280/,
      ]),
      foundBy("chat-history-old-command"),
    ],
    kind: "chat",
    name: "chat-history-old-command",
    prompt:
      "What was the ffmpeg command you used to shrink my screen recording a few weeks back? I want to run it myself on another one.",
    setup: seedOldCommand,
  }),
  defineEval({
    assertions: [
      repliedWith("named the paint the task found", [/White Dove|OC-17/i]),
      foundBy("chat-history-in-a-task"),
    ],
    kind: "chat",
    name: "chat-history-in-a-task",
    prompt:
      "What paint did we end up picking for the hallway? I need the code for the store.",
    setup: seedInATask,
  }),
  defineEval({
    assertions: [
      repliedWith("used the terms the earlier chat settled", [
        /165/,
        /net[ -]?15/i,
        /NW-4471/,
      ]),
      foundBy("chat-history-unprompted"),
    ],
    kind: "chat",
    name: "chat-history-unprompted",
    prompt:
      "Draft the Northwind invoice for this month, 12 hours on their docs site. Just show it to me here.",
    setup: seedUnprompted,
  }),
];
