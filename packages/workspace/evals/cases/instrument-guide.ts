/**
 * Does the conversation answer a question about Instrument itself from the
 * guide it ships, and link the user to the place to do it?
 *
 * The guide and the links are a prompt line and a skill, so whether a model
 * reads the guide rather than answering from what it assumes an app like this
 * has, and writes the setting's own address rather than describing the way
 * there, is a property of the prompt and the model. What these measure:
 *
 * - **It read the guide.** The reference names every setting by the name its
 *   link takes; an answer written without it guesses at both.
 * - **It linked the setting.** A chip the user clicks is the whole point, and
 *   a name the app does not have is a link that opens a search instead.
 * - **It was a reply, not a task.** A how-to question is the conversation's
 *   to answer in a sentence.
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

function replyText(sessions: Session.WithMessagesAndParts[]) {
  return sessions
    .flatMap((session) =>
      session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        ),
    )
    .join("\n");
}

const result = (
  passed: boolean,
  text: string,
  evidence: string,
): AssertionResult => ({ evidence, passed, text });

const readTheGuide: Assertion = {
  check: ({ sessions }) => {
    const text = "read the guide before answering";
    const reads = bashCommands(sessions).filter((command) =>
      command.includes("instrument-guide/"),
    );
    return result(
      reads.length > 0,
      text,
      reads.length > 0
        ? reads.map((command) => command.split("\n")[0]).join(" | ")
        : `never read it: ${bashCommands(sessions)
            .map((command) => command.split("\n")[0])
            .join(" | ")}`,
    );
  },
  text: "read the guide before answering",
};

const linksTo = (address: string): Assertion => {
  const text = `linked ${address}`;
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions);
      return result(
        reply.includes(`](${address})`),
        text,
        JSON.stringify(reply.slice(0, 600)),
      );
    },
    text,
  };
};

const withoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "answered without starting a task";
    const started = bashCommands(sessions).filter((command) =>
      /(?:^|[\n;&|])\s*task new\b/.test(command),
    );
    return result(
      started.length === 0,
      text,
      started.length === 0 ? "no task" : `started ${started.length} task(s)`,
    );
  },
  text: "answered without starting a task",
};

export const INSTRUMENT_GUIDE_EVALS = [
  defineEval({
    // The user's words are not the setting's: the reference calls it Zoom.
    assertions: [
      readTheGuide,
      linksTo("instrument://settings/zoom"),
      withoutATask,
    ],
    kind: "chat",
    name: "instrument-guide-links-a-setting",
    prompt: "How do I make the text bigger?",
  }),

  defineEval({
    assertions: [
      readTheGuide,
      linksTo("instrument://screen/shortcuts"),
      withoutATask,
    ],
    kind: "chat",
    name: "instrument-guide-links-a-screen",
    prompt: "Is there a list of all the keyboard shortcuts somewhere?",
  }),
];
