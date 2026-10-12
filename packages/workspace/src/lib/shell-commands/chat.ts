import { defineCommand } from "just-bash";
import { alphabetical } from "radashi";

import { type Chat, listChats, setChatTopics } from "../chat/chats";
import { listTopics, type Topic, topicByName } from "../chat/topics";
import { Store } from "../store";
import { CHAT_COMMAND } from "./chat-command";
import {
  defineSubcommands,
  type SubcommandInput,
  subcommand,
} from "./subcommands";

export { CHAT_COMMAND } from "./chat-command";

const CHAT_NAME = CHAT_COMMAND.name;

/** How much of a message a listing shows before it is cut. */
const LINE_MAX = 240;
const DEFAULT_TAIL = 20;
const DEFAULT_CHATS = 20;
const SEARCH_MAX = 20;

/**
 * The conversation's way of reading itself.
 *
 * A chat is a session with an agent of its own, handed nothing from
 * the others. These read the rest on demand, which is what keeps a reply in
 * one chat able to answer about another without every chat riding along
 * in the prompt.
 */
export function createChatCommand() {
  return defineCommand(CHAT_COMMAND.name, (args, ctx) =>
    runChat(args, undefined, ctx),
  );
}

const runChat = defineSubcommands<undefined>({
  errorPrefix: "subcommand",
  name: CHAT_NAME,
  subcommands: {
    list: subcommand({ flags: ["n", "topic"], positional: 0, run: runList }),
    read: subcommand({ flags: ["tail"], run: runRead }),
    search: subcommand({ run: ({ positional }) => runSearch(positional) }),
    tag: subcommand({ run: ({ positional }) => runTag(positional) }),
    topics: subcommand({ positional: 0, run: () => runTopics() }),
  },
  usage: `${CHAT_COMMAND.description}\n`,
});

/** One chat as a listing prints it. */
function chatRow(chat: Chat, names: Map<string, string>): string {
  const topics = chat.topics
    .flatMap((id) => {
      const name = names.get(id);
      return name ? [`#${name}`] : [];
    })
    .join(" ");
  const columns = [
    // Whole, never cut: a chat's id opens with its day, so the first
    // characters of every chat from the same day are the same ones, and an
    // id printed short here is one that names nothing when it comes back,
    // in a reference or in a link a reply writes.
    chat.id,
    chat.state,
    `"${chat.title}"`,
    ...(topics ? [topics] : []),
    chat.latest ? cut(chat.latest.text, 120) : "nothing yet",
    ...(chat.runningTasks.length > 0
      ? [`running: ${chat.runningTasks.map((task) => task.title).join(", ")}`]
      : []),
  ];
  return columns.join("  ");
}

function cut(text: string, max = LINE_MAX): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * The chat a reference names: its id or the start of one, or words from the
 * title. A chat's session, or the start of one, names it too, since older
 * transcripts and their links name chats that way. One match is the chat;
 * several are listed for the agent to pick from, since guessing between them
 * answers about the wrong one.
 */
function findChat(
  chats: Chat[],
  words: string[],
): { chat: Chat } | { error: string } {
  const reference = words.join(" ").trim();
  if (!reference) {
    return { error: `which chat? ${CHAT_NAME} list lists them.` };
  }
  const start = reference.toLowerCase();
  // A whole id is that chat, even when a later chat's id begins with it
  // (`...-page-for` and `...-page-for-2`).
  const exact = chats.find((chat) => chat.id === start);
  if (exact) {
    return { chat: exact };
  }
  const byId = chats.filter(
    (chat) =>
      chat.id.startsWith(start) ||
      (start.startsWith("ses_") &&
        chat.sessionId.toLowerCase().startsWith(start)),
  );
  if (byId.length === 1 && byId[0]) {
    return { chat: byId[0] };
  }
  const needles = reference.toLowerCase().split(/\s+/);
  const byTitle = chats.filter((chat) => {
    const title = chat.title.toLowerCase();
    return needles.every((needle) => title.includes(needle));
  });
  const matches = byId.length > 0 ? byId : byTitle;
  if (matches.length === 1 && matches[0]) {
    return { chat: matches[0] };
  }
  if (matches.length === 0) {
    return {
      error: `no chat matches "${reference}". ${CHAT_NAME} list lists them.`,
    };
  }
  return {
    error: `"${reference}" matches ${matches.length} chats; say which:\n${matches.map((chat) => `  ${chat.id}  ${chat.title}`).join("\n")}`,
  };
}

/** A chat's messages as `who: what` lines, oldest first. */
async function lines(chat: Chat): Promise<string[]> {
  const messages = await Store.getMessagesWithParts({
    sessionId: chat.sessionId,
    chatId: chat.id,
  });
  if (messages.isErr()) {
    return [];
  }
  return alphabetical(messages.value, (message) => message.id).flatMap(
    (message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return [];
      }
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(" ")
        .trim();
      if (!text) {
        return [];
      }
      return [`${message.role === "user" ? "user" : "you"}: ${cut(text)}`];
    },
  );
}

async function runList(input: SubcommandInput) {
  const topicWord = input.value("topic");
  const count = Number(input.value("n") ?? DEFAULT_CHATS);
  const topics = await listTopics();
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  let chats = await listChats();
  if (topicWord !== undefined) {
    const topic = await topicByName(topicWord);
    if (!topic) {
      throw new Error(
        `no topic called "${topicWord}". ${CHAT_NAME} topics names them.`,
      );
    }
    chats = chats.filter((chat) => chat.topics.includes(topic.id));
  }
  // Newest last, so the end of the listing is where the user is.
  const shown = chats.slice(
    -(Number.isFinite(count) && count > 0 ? count : DEFAULT_CHATS),
  );
  return shown.length > 0
    ? `${shown.map((chat) => chatRow(chat, names)).join("\n")}\n`
    : `${topicWord === undefined ? "No chats yet." : `No chats under #${topicWord}.`}\n`;
}

async function runRead(input: SubcommandInput) {
  const found = findChat(await listChats(), input.positional);
  if ("error" in found) {
    throw new Error(found.error);
  }
  const tail = Number(input.value("tail") ?? DEFAULT_TAIL);
  const said = await lines(found.chat);
  const shown = said.slice(
    -(Number.isFinite(tail) && tail > 0 ? tail : DEFAULT_TAIL),
  );
  return `${found.chat.id}  "${found.chat.title}"\n${shown.join("\n")}\n`;
}

async function runSearch(args: string[]) {
  const words = args.join(" ").trim().toLowerCase();
  if (!words) {
    throw new Error("what words?");
  }
  const chats = await listChats();
  const hits: string[] = [];
  for (const chat of chats) {
    for (const line of await lines(chat)) {
      if (line.toLowerCase().includes(words)) {
        hits.push(`${chat.id}  "${chat.title}"  ${line}`);
      }
    }
  }
  return hits.length > 0
    ? `${hits.slice(0, SEARCH_MAX).join("\n")}\n`
    : `Nothing in any chat matches "${words}".\n`;
}

async function runTag(args: string[]) {
  const topicWord = args.at(-1);
  const chatWords = args.slice(0, -1);
  if (!topicWord || chatWords.length === 0) {
    throw new Error(
      `which chat, and which topic? ${CHAT_NAME} tag <chat> <topic>.`,
    );
  }
  const topic = await topicByName(topicWord);
  if (!topic) {
    const topics = await listTopics();
    const known = topics.filter((entry) => !entry.retired);
    throw new Error(
      `no topic called "${topicWord}". ${known.length > 0 ? `The topics: ${known.map((entry) => `#${entry.name}`).join(", ")}.` : "There are no topics yet; the user makes them."}`,
    );
  }
  const found = findChat(await listChats(), chatWords);
  if ("error" in found) {
    throw new Error(found.error);
  }
  if (found.chat.topics.includes(topic.id)) {
    return `"${found.chat.title}" is already under #${topic.name}.\n`;
  }
  const written = await setChatTopics(found.chat.id, [
    ...found.chat.topics,
    topic.id,
  ]);
  if (!written) {
    throw new Error("could not write the chat's topics.");
  }
  return `Filed "${found.chat.title}" under #${topic.name}.\n`;
}

async function runTopics() {
  const every = await listTopics();
  const topics = every.filter((topic) => !topic.retired);
  return topics.length > 0
    ? `${topics.map(topicRow).join("\n")}\n`
    : "No topics yet; the user makes them.\n";
}

function topicRow(topic: Topic): string {
  return `#${topic.name}${topic.emoji ? `  ${topic.emoji}` : ""}${topic.about ? `  ${topic.about}` : ""}`;
}
