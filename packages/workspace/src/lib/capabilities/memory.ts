import { findSecrets } from "@instrument-org/shared/secrets";
import { z } from "zod";

import {
  forgetMemory,
  listMemories,
  type Memory,
  memoryDir,
  memoryHeadline,
  MemoryNameSchema,
  readMemory,
  saveMemory,
} from "../memory/store";
import { learnedIn } from "../memory/learned-in";
import { recordSetupTouch } from "../setup-changes";
import { APP_COMMAND } from "../shell-commands/app-command";
import { MEMORY_COMMAND } from "../shell-commands/memory-command";
import { type ChatId } from "../../schemas/chat-id";
import { defineCapability } from "./define";

const NAME = MEMORY_COMMAND.name;

/**
 * Why a task's `memory save` and `memory forget` change nothing: what is kept
 * for every chat is the chat's to decide, from what the task reports.
 */
const MEMORY_IS_THE_CHATS =
  "only the chat saves and forgets memories. Say in your report what the chat should remember or forget.";

/** One memory as a list or a read gives it back. */
const MemoryOutput = z.object({
  name: z.string(),
  /** The day it was saved or last corrected, YYYY-MM-DD. */
  day: z.string(),
  /** The title of the chat it was learned in, as that chat is titled now. */
  learned_in: z.string().optional(),
  /** Its first line, which is the fact when the rest is detail. */
  headline: z.string(),
});

const ShownMemory = MemoryOutput.extend({ text: z.string() });

const Said = z.string();

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function described(
  memory: Memory,
  titles: ReadonlyMap<ChatId, string>,
): z.output<typeof MemoryOutput> {
  const title = memory.chat && titles.get(memory.chat);
  return {
    day: day(memory.at),
    headline: memoryHeadline(memory.text),
    ...(title ? { learned_in: title } : {}),
    name: memory.name,
  };
}

/** Where a memory was learned, by the chat's title as it is now, and when. */
function origin(memory: z.output<typeof MemoryOutput>): string {
  return memory.learned_in
    ? `from "${memory.learned_in}" · ${memory.day}`
    : memory.day;
}

/** A field naming one memory, with what to do when it is left out. */
function memoryName(verb: string) {
  return z.string({
    error: `${verb}: which memory? ${NAME} list names them.`,
  });
}

function noMemory(name: string): Error {
  return new Error(`no memory named "${name}". ${NAME} list names them.`);
}

export const memoryList = defineCapability({
  input: z.object({}),
  name: "memory.list",
  output: z.array(MemoryOutput),
  async run() {
    const memories = await listMemories(memoryDir());
    const titles = await learnedIn(memories);
    return memories.map((memory) => described(memory, titles));
  },
  summary:
    "Everything you remember about the user, newest first: its name, the chat it came from, when, and the memory's first line.",
  surfaces: {
    cli: { help: "", words: ["memory", "list"] },
    script: {},
  },
  text: (memories) =>
    memories.length === 0
      ? `Nothing remembered yet. ${NAME} save <name> keeps something.`
      : `${memories.length} ${memories.length === 1 ? "memory" : "memories"}, newest first (${NAME} show <name> for one whole):\n${memories
          .map(
            (memory) =>
              `  ${memory.name}  ${origin(memory)}\n    ${memory.headline}`,
          )
          .join("\n")}`,
});

export const memoryShow = defineCapability({
  input: z.object({ name: memoryName("show") }),
  name: "memory.show",
  output: ShownMemory,
  async run({ name }) {
    const memory = await readMemory(memoryDir(), name);
    if (!memory) {
      throw noMemory(name);
    }
    return {
      ...described(memory, await learnedIn([memory])),
      text: memory.text,
    };
  },
  summary: "One memory, whole.",
  surfaces: {
    cli: { help: "", positional: ["name"], words: ["memory", "show"] },
    script: { positional: ["name"] },
  },
  text: (memory) => `${memory.name}  ${origin(memory)}\n\n${memory.text}`,
});

export const memorySave = defineCapability({
  input: z.object({
    name: z.string({ error: "save: a name is required." }),
    text: z.string().default(""),
  }),
  name: "memory.save",
  output: Said,
  async run({ name, text }, ctx) {
    const parsedName = MemoryNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error(
        `save: "${name}" is not a name a memory can have. ${parsedName.error.issues[0]?.message ?? ""}`.trim(),
      );
    }
    const body = text.trim();
    if (!body) {
      throw new Error(
        "save: the memory is required, on stdin through a quoted heredoc.",
      );
    }
    const secrets = [...new Set(findSecrets(body).map(({ label }) => label))];
    if (secrets.length > 0) {
      throw new Error(
        `save: not saved, it has a secret in it (${secrets.join(", ")}). A memory never keeps a key or password: save the fact without it. A service's key belongs to its app (\`${APP_COMMAND.name} new\`).`,
      );
    }
    const { memory, replaced } = await saveMemory(memoryDir(), {
      chat: ctx.chatId,
      name: parsedName.data,
      text: body,
    });
    recordSetupTouch({
      existedBefore: replaced,
      kind: "memory",
      name: memory.name,
    });
    return `${replaced ? "Replaced" : "Saved"} "${memory.name}": ${memoryHeadline(memory.text)}`;
  },
  summary: "Keep something for every chat to come.",
  surfaces: {
    cli: {
      help: `The name is a slug saying what it is about (pacific-time, no-stevia); saving
to a name that exists replaces what it held, which is how a memory is
corrected. Write the memory to the user in a sentence ("You are on Pacific
time and mornings are best for calls"), on stdin through a quoted heredoc
so the shell leaves it alone, or as one quoted argument.`,
      positional: ["name", "text"],
      rest: true,
      stdin: "text",
      words: ["memory", "save"],
    },
  },
  text: (said) => said,
  where: { roleRefusal: MEMORY_IS_THE_CHATS, roles: ["chat"] },
});

export const memoryForget = defineCapability({
  input: z.object({ name: memoryName("forget") }),
  name: "memory.forget",
  output: Said,
  async run({ name }) {
    const memory = await forgetMemory(memoryDir(), name);
    if (!memory) {
      throw noMemory(name);
    }
    recordSetupTouch({
      existedBefore: true,
      kind: "memory",
      name: memory.name,
    });
    return `Forgot "${memory.name}": ${memoryHeadline(memory.text)}`;
  },
  summary: "Drop it.",
  surfaces: {
    cli: { help: "", positional: ["name"], words: ["memory", "forget"] },
  },
  text: (said) => said,
  where: { roleRefusal: MEMORY_IS_THE_CHATS, roles: ["chat"] },
});
