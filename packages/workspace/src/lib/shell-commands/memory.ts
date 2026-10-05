import { type ByteString, defineCommand } from "just-bash";

import { type StoreId } from "../../schemas/store-id";
import { recordMemoryReported } from "../create-memory-part";
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
import { Store } from "../store";
import { MEMORY_COMMAND } from "./memory-command";
import { defineSubcommands, subcommand } from "./subcommands";
import { subprocessStdin } from "./utils";
import { type ChatId } from "../../schemas/chat-id";

export { MEMORY_COMMAND } from "./memory-command";

const NAME = MEMORY_COMMAND.name;

const USAGE = `Usage: ${NAME} <subcommand> ...

  ${NAME} list
      Everything you remember about the user, newest first: its name, the
      chat it came from, when, and the memory's first line.
  ${NAME} save <name> <<'EOF'
  <the memory>
  EOF
      Keep something for every chat to come. The name is a slug saying what
      it is about (pacific-time, no-stevia); saving to a name that exists
      replaces what it held, which is how a memory is corrected. Write the
      memory to the user in a sentence ("You are on Pacific time and mornings
      are best for calls"), on stdin through a quoted heredoc so the shell
      leaves it alone, or as one quoted argument.
  ${NAME} show <name>
      One memory, whole.
  ${NAME} forget <name>
      Drop it.
`;

/** What `memory` needs from the `bash` call it runs inside. */
export interface MemoryCommandContext {
  chatId: ChatId;
  /** The chat the call runs in: named on what it saves, and spared the note about its own change. */
  sessionId: StoreId.Session;
}

/**
 * The conversation's way of keeping what it learns about the user. A command
 * rather than a file the agent edits, because this agent has no tool that
 * writes a file's contents, on purpose, and a memory is the one thing it
 * should be able to keep without starting a task.
 */
export function createMemoryCommand(context: MemoryCommandContext) {
  return defineCommand(NAME, (args, ctx) => runMemory(args, context, ctx));
}

const runMemory = defineSubcommands<MemoryCommandContext>({
  bare: "list",
  name: NAME,
  subcommands: {
    forget: subcommand({
      positional: 1,
      run: ({ positional }, context) => runForget(positional, context),
    }),
    list: subcommand({ positional: 0, run: () => runList() }),
    save: subcommand({
      run: ({ positional }, context, { stdin }) =>
        runSave(positional, stdin, context),
    }),
    show: subcommand({
      positional: 1,
      run: ({ positional }) => runShow(positional),
    }),
  },
  usage: USAGE,
});

/** The chat a memory is learned in, by title, so a reader knows where it came from. */
async function chatOf({
  chatId,
  sessionId,
}: MemoryCommandContext): Promise<Memory["from"]> {
  const session = await Store.getSession(sessionId, chatId);
  if (session.isErr() || !session.value.title.trim()) {
    return undefined;
  }
  return { sessionId, title: session.value.title.trim() };
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** What a subcommand prints, ending in a line break whether or not it was written with one. */
function ok(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function origin(memory: Memory): string {
  return memory.from
    ? `from "${memory.from.title}" · ${day(memory.at)}`
    : day(memory.at);
}

/**
 * Where the chat stands after the agent changed memory itself: the change
 * is in front of it, so the next message's note has nothing to add.
 */
async function rememberTold({ chatId, sessionId }: MemoryCommandContext) {
  await recordMemoryReported({
    memories: await listMemories(memoryDir()),
    sessionId,
    taskId: chatId,
  });
}

async function runForget(args: string[], context: MemoryCommandContext) {
  const name = args[0];
  if (!name) {
    throw new Error(`forget: which memory? ${NAME} list names them.`);
  }
  const memory = await forgetMemory(memoryDir(), name);
  if (!memory) {
    throw new Error(`no memory named "${name}". ${NAME} list names them.`);
  }
  await rememberTold(context);
  return ok(`Forgot "${memory.name}": ${memoryHeadline(memory.text)}`);
}

async function runList() {
  const memories = await listMemories(memoryDir());
  if (memories.length === 0) {
    return ok(`Nothing remembered yet. ${NAME} save <name> keeps something.`);
  }
  const rows = memories.map(
    (memory) =>
      `  ${memory.name}  ${origin(memory)}\n    ${memoryHeadline(memory.text)}`,
  );
  return ok(
    `${memories.length} ${memories.length === 1 ? "memory" : "memories"}, newest first (${NAME} show <name> for one whole):\n${rows.join("\n")}`,
  );
}

async function runSave(
  args: string[],
  stdin: ByteString,
  context: MemoryCommandContext,
) {
  const [name, ...inline] = args;
  if (!name) {
    throw new Error(`save: a name is required.\n\n${USAGE}`);
  }
  const parsedName = MemoryNameSchema.safeParse(name);
  if (!parsedName.success) {
    throw new Error(
      `save: "${name}" is not a name a memory can have. ${parsedName.error.issues[0]?.message ?? ""}`.trim(),
    );
  }
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  const text = piped || inline.join(" ").trim();
  if (!text) {
    throw new Error(
      `save: the memory is required, on stdin through a quoted heredoc.\n\n${USAGE}`,
    );
  }
  const { memory, replaced } = await saveMemory(memoryDir(), {
    from: await chatOf(context),
    name: parsedName.data,
    text,
  });
  await rememberTold(context);
  return ok(
    `${replaced ? "Replaced" : "Saved"} "${memory.name}": ${memoryHeadline(memory.text)}`,
  );
}

async function runShow(args: string[]) {
  const name = args[0];
  if (!name) {
    throw new Error(`show: which memory? ${NAME} list names them.`);
  }
  const memory = await readMemory(memoryDir(), name);
  if (!memory) {
    throw new Error(`no memory named "${name}". ${NAME} list names them.`);
  }
  return ok(`${memory.name}  ${origin(memory)}\n\n${memory.text}`);
}
