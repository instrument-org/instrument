import { defineCommand } from "just-bash";
import { alphabetical } from "radashi";

import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import {
  listThreads,
  setThreadTopics,
  type Thread,
} from "../orchestrator/threads";
import { listTopics, type Topic, topicByName } from "../orchestrator/topics";
import { Store } from "../store";
import { CHAT_COMMAND } from "./chat-command";

export { CHAT_COMMAND } from "./chat-command";

const CHAT_NAME = CHAT_COMMAND.name;

/** How much of a message a listing shows before it is cut. */
const LINE_MAX = 240;
const DEFAULT_TAIL = 20;
const DEFAULT_THREADS = 20;
const SEARCH_MAX = 20;

/**
 * The conversation's way of reading itself.
 *
 * A thread is a session with an orchestrator of its own, handed nothing from
 * the others. These read the rest on demand, which is what keeps a reply in
 * one thread able to answer about another without every thread riding along
 * in the prompt.
 */
export function createChatCommand({
  orchestratorTaskId,
}: {
  orchestratorTaskId: TaskId;
}) {
  return defineCommand(CHAT_COMMAND.name, async (args) => {
    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "read": {
        return await runRead(orchestratorTaskId, rest);
      }
      case "search": {
        return await runSearch(orchestratorTaskId, rest);
      }
      case "tag": {
        return await runTag(orchestratorTaskId, rest);
      }
      case "threads": {
        return await runThreads(orchestratorTaskId, rest);
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

function cut(text: string, max = LINE_MAX): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function failure(text: string) {
  return { exitCode: 1, stderr: `${text}\n`, stdout: "" };
}

/**
 * The thread a reference names: a session id or the start of one, or words
 * from the title. One match is the thread; several are listed for the agent
 * to pick from, since guessing between them answers about the wrong one.
 */
function findThread(
  threads: Thread[],
  words: string[],
): { error: string } | { thread: Thread } {
  const reference = words.join(" ").trim();
  if (!reference) {
    return { error: `which thread? ${CHAT_NAME} threads lists them.` };
  }
  const byId = threads.filter((thread) =>
    thread.id.toLowerCase().startsWith(reference.toLowerCase()),
  );
  if (byId.length === 1 && byId[0]) {
    return { thread: byId[0] };
  }
  const needles = reference.toLowerCase().split(/\s+/);
  const byTitle = threads.filter((thread) => {
    const title = thread.title.toLowerCase();
    return needles.every((needle) => title.includes(needle));
  });
  const matches = byId.length > 0 ? byId : byTitle;
  if (matches.length === 1 && matches[0]) {
    return { thread: matches[0] };
  }
  if (matches.length === 0) {
    return {
      error: `no thread matches "${reference}". ${CHAT_NAME} threads lists them.`,
    };
  }
  return {
    error: `"${reference}" matches ${matches.length} threads; say which:\n${matches.map((thread) => `  ${thread.id}  ${thread.title}`).join("\n")}`,
  };
}

/** A thread's messages as `who: what` lines, oldest first. */
async function lines(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<string[]> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
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

async function runRead(taskId: TaskId, args: string[]) {
  const tailIndex = args.indexOf("--tail");
  const words = tailIndex === -1 ? args : args.slice(0, tailIndex);
  const found = findThread(await listThreads(taskId), words);
  if ("error" in found) {
    return failure(`${CHAT_NAME} read: ${found.error}`);
  }
  const tail = Number(option(args, "--tail") ?? DEFAULT_TAIL);
  const said = await lines(taskId, found.thread.id);
  const shown = said.slice(
    -(Number.isFinite(tail) && tail > 0 ? tail : DEFAULT_TAIL),
  );
  return {
    exitCode: 0,
    stderr: "",
    stdout: `${found.thread.id}  "${found.thread.title}"\n${shown.join("\n")}\n`,
  };
}

async function runSearch(taskId: TaskId, args: string[]) {
  const words = args.join(" ").trim().toLowerCase();
  if (!words) {
    return failure(`${CHAT_NAME} search: what words?`);
  }
  const threads = await listThreads(taskId);
  const hits: string[] = [];
  for (const thread of threads) {
    for (const line of await lines(taskId, thread.id)) {
      if (line.toLowerCase().includes(words)) {
        hits.push(`${thread.id}  "${thread.title}"  ${line}`);
      }
    }
  }
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      hits.length > 0
        ? `${hits.slice(0, SEARCH_MAX).join("\n")}\n`
        : `Nothing in any thread matches "${words}".\n`,
  };
}

async function runTag(taskId: TaskId, args: string[]) {
  const topicWord = args.at(-1);
  const threadWords = args.slice(0, -1);
  if (!topicWord || threadWords.length === 0) {
    return failure(
      `${CHAT_NAME} tag: which thread, and which topic? ${CHAT_NAME} tag <thread> <topic>.`,
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
  const found = findThread(await listThreads(taskId), threadWords);
  if ("error" in found) {
    return failure(`${CHAT_NAME} tag: ${found.error}`);
  }
  if (found.thread.topics.includes(topic.id)) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: `"${found.thread.title}" is already under #${topic.name}.\n`,
    };
  }
  const written = await setThreadTopics(taskId, found.thread.id, [
    ...found.thread.topics,
    topic.id,
  ]);
  if (!written) {
    return failure(`${CHAT_NAME} tag: could not write the thread's topics.`);
  }
  return {
    exitCode: 0,
    stderr: "",
    stdout: `Filed "${found.thread.title}" under #${topic.name}.\n`,
  };
}

async function runThreads(taskId: TaskId, args: string[]) {
  const topicWord = option(args, "--topic");
  const count = Number(option(args, "-n") ?? DEFAULT_THREADS);
  const topics = await listTopics();
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  let threads = await listThreads(taskId);
  if (topicWord !== undefined) {
    const topic = await topicByName(topicWord);
    if (!topic) {
      return failure(
        `${CHAT_NAME} threads: no topic called "${topicWord}". ${CHAT_NAME} topics names them.`,
      );
    }
    threads = threads.filter((thread) => thread.topics.includes(topic.id));
  }
  // Newest last, so the end of the listing is where the user is.
  const shown = threads.slice(
    -(Number.isFinite(count) && count > 0 ? count : DEFAULT_THREADS),
  );
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      shown.length > 0
        ? `${shown.map((thread) => threadRow(thread, names)).join("\n")}\n`
        : `${topicWord === undefined ? "No threads yet." : `No threads under #${topicWord}.`}\n`,
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

/** One thread as a listing prints it. */
function threadRow(thread: Thread, names: Map<string, string>): string {
  const topics = thread.topics
    .flatMap((id) => {
      const name = names.get(id);
      return name ? [`#${name}`] : [];
    })
    .join(" ");
  const columns = [
    // Whole, never cut: a session id opens with its time, so the first
    // characters of every thread from the same fortnight are the same ones,
    // and an id printed short here is one that names nothing when it comes
    // back, in a reference or in a link a reply writes.
    thread.id,
    thread.state,
    `"${thread.title}"`,
    ...(topics ? [topics] : []),
    thread.latest ? cut(thread.latest.text, 120) : "nothing yet",
    ...(thread.runningTasks.length > 0
      ? [`running: ${thread.runningTasks.map((task) => task.title).join(", ")}`]
      : []),
  ];
  return columns.join("  ");
}

function topicRow(topic: Topic): string {
  return `#${topic.name}${topic.emoji ? `  ${topic.emoji}` : ""}${topic.about ? `  ${topic.about}` : ""}`;
}
