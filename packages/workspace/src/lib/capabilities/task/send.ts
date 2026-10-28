import { z } from "zod";

import { recordHandOff } from "../../shell-commands/task-hand-off";
import { defineCapability } from "../define";
import { requireChild } from "./children";
import { deliver } from "./delivery";
import { TASKS_ARE_THE_CHATS } from "./roles";

export const taskSend = defineCapability({
  input: z.object({
    task: z.string({
      error: "a task id (t1) is required. See `instrument task list`.",
    }),
    message: z.string().default(""),
    now: z.boolean().default(false).meta({
      description:
        "Stop the step in flight and run the message as its next turn: for a correction that makes the current work wrong, or a task whose latest step has run for minutes without a tool call.",
    }),
  }),
  name: "task.send",
  output: z.object({
    id: z.string(),
    /** Whether it was working when the message reached it. */
    running: z.boolean(),
    now: z.boolean(),
  }),
  async run({ message, now, task: named }, ctx) {
    const task = await requireChild(named, ctx);
    const prompt = message.trim();
    if (!prompt) {
      throw new Error(
        "send: a message is required, on stdin through a quoted heredoc.",
      );
    }
    const { running } = await deliver({
      command: "send",
      context: ctx,
      interrupt: now,
      prompt,
      task,
    });
    recordHandOff({ kind: "sent", sessionId: task.id });
    return { id: task.handle, now, running };
  },
  summary:
    "Deliver a message into a task: it runs now if idle; if busy, the task hears it at its next step. Follow-ups, corrections, answers to its questions.",
  surfaces: {
    cli: {
      help: "Same heredoc as `new`.",
      positional: ["task", "message"],
      rest: true,
      stdin: "message",
      words: ["task", "send"],
    },
  },
  text: ({ id, now, running }) =>
    running
      ? now
        ? `Sent to ${id}. Its step in flight was stopped, and it takes this up as its next turn; you will be told when that turn finishes.`
        : `Sent to ${id}. It is busy and will hear this at its next step; you will be told when its turn finishes. If its latest step has run for minutes without a tool call, \`send --now\` interrupts it.`
      : `Sent to ${id}. It is running now; you will be told when it finishes.`,
  where: TASKS_ARE_THE_CHATS,
});
