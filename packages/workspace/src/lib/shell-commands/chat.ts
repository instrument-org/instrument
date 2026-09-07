import { defineCommand } from "just-bash";

import { type StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import {
  channelByName,
  channelName,
  listChannels,
} from "../orchestrator/channels";
import { Store } from "../store";

const CHAT_NAME = "chat";

export const CHAT_COMMAND = {
  description: `Read the user's other channels: \`${CHAT_NAME} list\` names them, \`${CHAT_NAME} read <channel> [--tail <n>]\` reads the end of one, \`${CHAT_NAME} search <words>\` finds a line across all of them. The channel you are in arrives with the message; these are for the others.`,
  name: CHAT_NAME,
} as const;

/** How much of a message a listing shows before it is cut. */
const LINE_MAX = 240;
const DEFAULT_TAIL = 20;
const SEARCH_MAX = 20;

/**
 * The conversation's way of reading itself.
 *
 * A channel is a session of the same conversation, so the agent is in all of
 * them but is only handed the one the message came from. These read the rest
 * on demand, which is what keeps a reply in one channel able to answer about
 * another without every channel riding along in the prompt.
 */
export function createChatCommand({
  orchestratorTaskId,
}: {
  orchestratorTaskId: TaskId;
}) {
  return defineCommand(CHAT_COMMAND.name, async (args) => {
    const [subcommand, ...rest] = args;
    switch (subcommand) {
      case "list": {
        return await runList(orchestratorTaskId);
      }
      case "read": {
        return await runRead(orchestratorTaskId, rest);
      }
      case "search": {
        return await runSearch(orchestratorTaskId, rest);
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

function cut(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX)}…` : line;
}

/** A channel's messages as `who: what` lines, oldest first. */
async function lines(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<string[]> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return [];
  }
  return messages.value.flatMap((message) => {
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(" ")
      .trim();
    if (!text) {
      return [];
    }
    return [`${message.role === "user" ? "user" : "you"}: ${cut(text)}`];
  });
}

async function runList(taskId: TaskId) {
  const channels = await listChannels(taskId);
  const rows = await Promise.all(
    channels.map(async (channel) => {
      const said = await lines(taskId, channel.id);
      return `#${channel.name}  ${said.length} messages  ${said.at(-1) ?? "nothing yet"}`;
    }),
  );
  return { exitCode: 0, stderr: "", stdout: `${rows.join("\n")}\n` };
}

async function runRead(taskId: TaskId, args: string[]) {
  const name = args[0];
  if (!name) {
    return {
      exitCode: 1,
      stderr: `${CHAT_NAME} read: which channel? ${CHAT_NAME} list names them.\n`,
      stdout: "",
    };
  }
  const channel = await channelByName(taskId, name);
  if (!channel) {
    return {
      exitCode: 1,
      stderr: `${CHAT_NAME} read: no channel called "${channelName(name)}".\n`,
      stdout: "",
    };
  }
  const tailIndex = args.indexOf("--tail");
  const tail =
    tailIndex === -1 ? DEFAULT_TAIL : Number(args[tailIndex + 1] ?? DEFAULT_TAIL);
  const said = await lines(taskId, channel.id);
  const shown = said.slice(-(Number.isFinite(tail) ? tail : DEFAULT_TAIL));
  return {
    exitCode: 0,
    stderr: "",
    stdout: `#${channel.name}\n${shown.join("\n")}\n`,
  };
}

async function runSearch(taskId: TaskId, args: string[]) {
  const words = args.join(" ").trim().toLowerCase();
  if (!words) {
    return {
      exitCode: 1,
      stderr: `${CHAT_NAME} search: what words?\n`,
      stdout: "",
    };
  }
  const channels = await listChannels(taskId);
  const hits: string[] = [];
  for (const channel of channels) {
    for (const line of await lines(taskId, channel.id)) {
      if (line.toLowerCase().includes(words)) {
        hits.push(`#${channel.name}  ${line}`);
      }
    }
  }
  return {
    exitCode: 0,
    stderr: "",
    stdout:
      hits.length > 0
        ? `${hits.slice(0, SEARCH_MAX).join("\n")}\n`
        : `Nothing in any channel matches "${words}".\n`,
  };
}
