import { defineCommand } from "just-bash";
import { alphabetical } from "radashi";

import { type Chat, listChats, setChatTopics } from "../chat/chats";
import { listTopics, type Topic, topicByName } from "../chat/topics";
import { Store } from "../store";
import { CHAT_COMMAND } from "./chat-command";

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
  return defineCommand(CHAT_COMMAND.name, async (args) => {
    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "list": {
        return await runList(rest);
      }
      case "read": {
        return await runRead(rest);
      }
      case "search": {
        return await runSearch(rest);
      }
      case "tag": {
        return await runTag(rest);
      }
      case "topics": {
        return await runTopics();
      }
      default: {
        return {
          exitCode: 1,
          stderr: `${CHAT_NAME}: ${subcommand ? `unknown subcommand "${subcommand}"` : "no subcommand"}. ${CHAT_COMMAND.description}\n`,
          stdout: "",
        };
      }
    }
  });
}

/** One chat as a listing prints it. */
function chatRow(chat: Chat, names: Map<string, string>): string {
  const topics = chat.topics
    .flatMap((id) => {
      const name = names.get(id);
      return name ? [`#${name}`] : [];
    })
    .join(" ");
  const columns = [
    // Whole, never cut: a session id opens with its time, so the first
    // characters of every chat from the same fortnight are the same ones,
    // and an id printed short here is one that names nothing when it comes
    // back, in a reference or in a link a reply writes.
    chat.sessionId,
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

function failure(text: string) {
  return { exitCode: 1, stderr: `${text}\n`, stdout: "" };
}

/**
 * The chat a reference names: a session id or the start of one, or words
 * from the title. One match is the chat; several are listed for the agent
 * to pick from, since guessing between them answers about the wrong one.
 */
function findChat(
  chats: Chat[],
  words: string[],
): { chat: Chat } | { error: string } {
  const reference = words.join(" ").trim();
  if (!reference) {
    return { error: `which chat? ${CHAT_NAME} list lists them.` };
  }
  const byId = chats.filter((chat) =>
    chat.sessionId.toLowerCase().startsWith(reference.toLowerCase()),
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
    error: `"${reference}" matches ${matches.length} chats; say which:\n${matches.map((chat) => `  ${chat.sessionId}  ${chat.title}`).join("\n")}`,
  };
}

/** A chat's messages as `who: what` lines, oldest first. */
async function lines(chat: Chat): Promise<string[]> {
  const messages = await Store.getMessagesWithParts({
    sessionId: chat.sessionId,
    taskId: chat.id,
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

/** The value after a flag, or none when the flag is absent or has no value. */
function option(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function runList(args: string[]) {
  const topicWord = option(args, "--topic");
  const count = Number(option(args, "-n") ?? DEFAULT_CHATS);
  const topics = await listTopics();
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  let chats = await listChats();
  if (topicWord !== undefined) {
    const topic = await topicByName(topicWord);
    if (!topic) {
      return failure(
        `${CHAT_NAME} list: no topic called "${topicWord}". ${CHAT_NAME} topics names them.`,
      );
    }
    chats = chats.filter((chat) => chat.topics.includes(topic.id));
  }
  // Newest last, so the end of the listing is where the user is.
  const shown = chats.slice(
    -(Number.isFinite(count) && count > 0 ? count : DEFAULT_CHATS),
  );
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      shown.length > 0
        ? `${shown.map((chat) => chatRow(chat, names)).join("\n")}\n`
        : `${topicWord === undefined ? "No chats yet." : `No chats under #${topicWord}.`}\n`,
  };
}

async function runRead(args: string[]) {
  const tailIndex = args.indexOf("--tail");
  const words = tailIndex === -1 ? args : args.slice(0, tailIndex);
  const found = findChat(await listChats(), words);
  if ("error" in found) {
    return failure(`${CHAT_NAME} read: ${found.error}`);
  }
  const tail = Number(option(args, "--tail") ?? DEFAULT_TAIL);
  const said = await lines(found.chat);
  const shown = said.slice(
    -(Number.isFinite(tail) && tail > 0 ? tail : DEFAULT_TAIL),
  );
  return {
    exitCode: 0,
    stderr: "",
    stdout: `${found.chat.sessionId}  "${found.chat.title}"\n${shown.join("\n")}\n`,
  };
}

async function runSearch(args: string[]) {
  const words = args.join(" ").trim().toLowerCase();
  if (!words) {
    return failure(`${CHAT_NAME} search: what words?`);
  }
  const chats = await listChats();
  const hits: string[] = [];
  for (const chat of chats) {
    for (const line of await lines(chat)) {
      if (line.toLowerCase().includes(words)) {
        hits.push(`${chat.sessionId}  "${chat.title}"  ${line}`);
      }
    }
  }
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      hits.length > 0
        ? `${hits.slice(0, SEARCH_MAX).join("\n")}\n`
        : `Nothing in any chat matches "${words}".\n`,
  };
}

async function runTag(args: string[]) {
  const topicWord = args.at(-1);
  const chatWords = args.slice(0, -1);
  if (!topicWord || chatWords.length === 0) {
    return failure(
      `${CHAT_NAME} tag: which chat, and which topic? ${CHAT_NAME} tag <chat> <topic>.`,
    );
  }
  const topic = await topicByName(topicWord);
  if (!topic) {
    const topics = await listTopics();
    const known = topics.filter((entry) => !entry.retired);
    return failure(
      `${CHAT_NAME} tag: no topic called "${topicWord}". ${known.length > 0 ? `The topics: ${known.map((entry) => `#${entry.name}`).join(", ")}.` : "There are no topics yet; the user makes them."}`,
    );
  }
  const found = findChat(await listChats(), chatWords);
  if ("error" in found) {
    return failure(`${CHAT_NAME} tag: ${found.error}`);
  }
  if (found.chat.topics.includes(topic.id)) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: `"${found.chat.title}" is already under #${topic.name}.\n`,
    };
  }
  const written = await setChatTopics(found.chat.id, [
    ...found.chat.topics,
    topic.id,
  ]);
  if (!written) {
    return failure(`${CHAT_NAME} tag: could not write the chat's topics.`);
  }
  return {
    exitCode: 0,
    stderr: "",
    stdout: `Filed "${found.chat.title}" under #${topic.name}.\n`,
  };
}

async function runTopics() {
  const every = await listTopics();
  const topics = every.filter((topic) => !topic.retired);
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      topics.length > 0
        ? `${topics.map(topicRow).join("\n")}\n`
        : "No topics yet; the user makes them.\n",
  };
}

function topicRow(topic: Topic): string {
  return `#${topic.name}${topic.emoji ? `  ${topic.emoji}` : ""}${topic.about ? `  ${topic.about}` : ""}`;
}
