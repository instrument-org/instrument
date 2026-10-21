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
import { SKILL_NAMES } from "../../src/lib/skill-names";
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

/** Every tool call's input, as JSON, so a load_skill or read_file reads the same as a command. */
function toolInputs(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type.startsWith("tool-") && "input" in part
          ? [JSON.stringify(part.input ?? "")]
          : [],
      ),
    ),
  );
}

const readTheGuide: Assertion = {
  check: ({ sessions }) => {
    const text = "read the guide before answering";
    const inputs = toolInputs(sessions);
    const reads = inputs.filter((input) =>
      input.includes(SKILL_NAMES.instrumentGuide),
    );
    return result(
      reads.length > 0,
      text,
      reads.length > 0
        ? reads.join(" | ").slice(0, 400)
        : `never read it: ${inputs.join(" | ").slice(0, 400)}`,
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

const linksToOneOf = (addresses: string[]): Assertion => {
  const text = `linked one of ${addresses.join(", ")}`;
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions);
      return result(
        addresses.some((address) => reply.includes(`](${address})`)),
        text,
        JSON.stringify(reply.slice(0, 600)),
      );
    },
    text,
  };
};

const triedX: Assertion = {
  check: ({ sessions }) => {
    const text = "tried instrument x before answering";
    const runs = bashCommands(sessions).filter((command) =>
      /\binstrument x\b/.test(command),
    );
    return result(
      runs.length > 0,
      text,
      runs.length > 0
        ? runs.join(" | ").slice(0, 400)
        : `never ran it: ${bashCommands(sessions).join(" | ").slice(0, 400)}`,
    );
  },
  text: "tried instrument x before answering",
};

const withoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "answered without starting a task";
    const started = bashCommands(sessions).filter((command) =>
      /(?:^|[\n;&|])\s*instrument task new\b/.test(command),
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
    // The user's words are not the setting's, and the system prompt's own
    // example links name other places, so only the reference has this one.
    assertions: [
      readTheGuide,
      linksTo("instrument://settings/notifications"),
      withoutATask,
    ],
    kind: "chat",
    name: "instrument-guide-links-a-setting",
    prompt: "Can it ping me when something I left running is done?",
  }),

  defineEval({
    assertions: [
      readTheGuide,
      linksTo("instrument://screen/apps"),
      withoutATask,
    ],
    kind: "chat",
    name: "instrument-guide-links-a-screen",
    prompt: "Where can I see which of my services are hooked up?",
  }),

  defineEval({
    // Whether the user's own plan works here is the guide's to answer, and
    // a model answering from what it knows of other apps says no.
    assertions: [
      linksToOneOf([
        "instrument://settings/claude-account",
        "instrument://settings/providers",
      ]),
      withoutATask,
    ],
    kind: "chat",
    name: "instrument-guide-own-claude-plan",
    prompt:
      "I already pay for Claude. Can I use that subscription in here instead?",
  }),

  defineEval({
    // The run has no Grok account, so the command fails and its error links
    // the setting; the reply should pass that link on.
    assertions: [
      triedX,
      linksTo("instrument://settings/grok-account"),
      withoutATask,
    ],
    kind: "chat",
    name: "x-search-without-grok-links-sign-in",
    prompt: "Search X for what people are saying about the new Pixel launch.",
  }),
];
