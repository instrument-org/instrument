import { findSecrets } from "@instrument-org/shared/secrets";
import { type ByteString, defineCommand } from "just-bash";

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
import { APP_COMMAND } from "./app-command";
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
  /** The chat the call runs in, named on what it saves. */
  chatId: ChatId;
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
      run: ({ positional }) => runForget(positional),
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

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** What a subcommand prints, ending in a line break whether or not it was written with one. */
function ok(text: string) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Where a memory was learned, by the chat's title as it is now, and when. */
function origin(memory: Memory, titles: ReadonlyMap<ChatId, string>): string {
  const title = memory.chat && titles.get(memory.chat);
  return title ? `from "${title}" · ${day(memory.at)}` : day(memory.at);
}

async function runForget(args: string[]) {
  const name = args[0];
  if (!name) {
    throw new Error(`forget: which memory? ${NAME} list names them.`);
  }
  const memory = await forgetMemory(memoryDir(), name);
  if (!memory) {
    throw new Error(`no memory named "${name}". ${NAME} list names them.`);
  }
  recordSetupTouch({ existedBefore: true, kind: "memory", name: memory.name });
  return ok(`Forgot "${memory.name}": ${memoryHeadline(memory.text)}`);
}

async function runList() {
  const memories = await listMemories(memoryDir());
  if (memories.length === 0) {
    return ok(`Nothing remembered yet. ${NAME} save <name> keeps something.`);
  }
  const titles = await learnedIn(memories);
  const rows = memories.map(
    (memory) =>
      `  ${memory.name}  ${origin(memory, titles)}\n    ${memoryHeadline(memory.text)}`,
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
  const secrets = [...new Set(findSecrets(text).map(({ label }) => label))];
  if (secrets.length > 0) {
    throw new Error(
      `save: not saved, it has a secret in it (${secrets.join(", ")}). A memory never keeps a key or password: save the fact without it. A service's key belongs to its app (\`${APP_COMMAND.name} new\`).`,
    );
  }
  const { memory, replaced } = await saveMemory(memoryDir(), {
    chat: context.chatId,
    name: parsedName.data,
    text,
  });
  recordSetupTouch({
    existedBefore: replaced,
    kind: "memory",
    name: memory.name,
  });
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
  const titles = await learnedIn([memory]);
  return ok(`${memory.name}  ${origin(memory, titles)}\n\n${memory.text}`);
}
