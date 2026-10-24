/**
 * Does the conversation bring the user's chats in from another AI app with
 * `instrument import`, finding the ones they mean before adding them?
 *
 * The command is listed by `instrument help` and named in the instrument
 * guide, so whether a model reaches for it, rather than reading a coding
 * agent's session files itself or telling the user to copy their chats over,
 * is a property of the prompt and the model. What these measure:
 *
 * - **It used the command.** The parsers decide what lands; a model reading
 *   `~/.codex` by hand brings in nothing.
 * - **It looked before it added.** "My kitchen chats" is a search, and an add
 *   of every chat the source has is a mess the user has to clean up.
 * - **It was a reply, not a task.** Listing and adding take a command each.
 *
 * Reads the run's home folder, so what `list` finds depends on the machine;
 * the assertions hold on the commands, not on what came in.
 */
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

function bashCommands(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        const command: string | undefined =
          part.type === "tool-bash" ? part.input?.command : undefined;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

const result = (
  passed: boolean,
  text: string,
  evidence: string,
): AssertionResult => ({ evidence, passed, text });

const LISTS = /(?:^|[\n;&|])\s*instrument import list\b/;
const ADDS = /(?:^|[\n;&|])\s*instrument import add\b/;

const listedFirst: Assertion = {
  check: ({ sessions }) => {
    const text = "listed the source's chats before adding any";
    const commands = bashCommands(sessions);
    const list = commands.findIndex((command) => LISTS.test(command));
    const add = commands.findIndex((command) => ADDS.test(command));
    return result(
      list !== -1 && (add === -1 || list <= add),
      text,
      commands.join(" | ").slice(0, 400),
    );
  },
  text: "listed the source's chats before adding any",
};

const searched: Assertion = {
  check: ({ sessions }) => {
    const text = "narrowed the listing to what the user asked for";
    const lists = bashCommands(sessions).filter((command) =>
      LISTS.test(command),
    );
    return result(
      lists.some((command) => /--search\b/.test(command)),
      text,
      lists.join(" | ").slice(0, 400) || "no listing",
    );
  },
  text: "narrowed the listing to what the user asked for",
};

const withoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "imported without starting a task";
    const started = bashCommands(sessions).filter((command) =>
      /(?:^|[\n;&|])\s*instrument task new\b/.test(command),
    );
    return result(
      started.length === 0,
      text,
      started.length === 0 ? "no task" : `started ${started.length} task(s)`,
    );
  },
  text: "imported without starting a task",
};

export const CHAT_IMPORT_EVALS = [
  defineEval({
    assertions: [listedFirst, searched, withoutATask],
    kind: "chat",
    name: "chat-import-finds-before-adding",
    prompt: "Bring in my Codex chats about the kitchen remodel.",
  }),
];
