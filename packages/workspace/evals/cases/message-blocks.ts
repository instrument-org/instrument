/**
 * Does the conversation hand over words to send as a message?
 *
 * A message is an email, a text, a post: words the user sends as their own.
 * The conversation writes a short one itself as a ```message fence; one a task
 * wrote is a Markdown file whose front matter says `message:`, handed over in
 * the files fence rather than typed out again. Both draw one card.
 *
 * The asks are worded the way a person asks for help writing, never naming the
 * block, because what is measured is whether a model reaches for it unprompted:
 * the conversation writing it directly, the conversation reading a connected
 * app first, and a task that has to work something out before it drafts. Two
 * mirror cases ask for no message at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { filesNamedIn } from "../../src/lib/parse-files-block";
import {
  isMessageDocument,
  MESSAGE_FENCE,
  type MessageDraft,
  type MessageKind,
  parseMessage,
} from "../../src/lib/parse-message";
import { taskDir } from "../../src/lib/task-dir-utils";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../fixtures/message-blocks",
);

const RUN_STARTED_AT = Date.now();

type Context = Parameters<Assertion["check"]>[0];

function assistantTexts(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && part.text.trim() !== "" ? [part.text] : [],
        ),
      ),
  );
}

function describe(message: MessageDraft): string {
  return `${message.kind}${message.via ? ` via ${message.via}` : ""}${message.to ? ` to ${message.to}` : ""}${message.subject ? ` "${message.subject}"` : ""} (${message.body.length} chars)`;
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

/** Every ```message fence the conversation wrote, parsed. */
function fencedMessages(sessions: Session.WithMessagesAndParts[]) {
  return assistantTexts(sessions).flatMap((text) =>
    [...text.matchAll(MESSAGE_FENCE)].map((match) =>
      parseMessage(match[1] ?? ""),
    ),
  );
}

/** The message files the conversation named in a files fence. */
async function handedFiles(context: Context) {
  const named = new Set(
    assistantTexts(context.sessions)
      .flatMap((text) => filesNamedIn(text))
      .map((file) => path.basename(file)),
  );
  return (await messageFiles(context)).filter(({ file }) =>
    named.has(path.basename(file)),
  );
}

/** The conversation handed over a message, by either carrier. */
function handedOverAMessage(kinds?: MessageKind[]): Assertion {
  const text = kinds
    ? `handed over a message (${kinds.join(" or ")})`
    : "handed over a message";
  return {
    check: async (context) => {
      const fenced = fencedMessages(context.sessions);
      const files = await handedFiles(context);
      const all = [
        ...fenced.map((message) => ({ carrier: "fence", message })),
        ...files.map(({ file, message }) => ({
          carrier: `file ${path.basename(file)}`,
          message,
        })),
      ];
      const evidence =
        all.length === 0
          ? `none; last reply: ${JSON.stringify(assistantTexts(context.sessions).at(-1) ?? "")}`
          : all
              .map(({ carrier, message }) => `${carrier}: ${describe(message)}`)
              .join(" | ");
      const matching = all.filter(
        ({ message }) => !kinds || kinds.includes(message.kind),
      );
      return matching.length > 0 ? pass(text, evidence) : fail(text, evidence);
    },
    text,
  };
}

/** Markdown files this run wrote anywhere it could, that are messages. */
async function messageFiles(
  context: Context,
): Promise<{ file: string; message: MessageDraft }[]> {
  const children = await context.childSessions();
  const roots = [
    os.homedir(),
    taskDir(context.taskId),
    ...children.map((child) => taskDir(child.taskId)),
  ];
  const found = new Map<string, MessageDraft>();
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const entry of fs.readdirSync(root, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const file = path.join(entry.parentPath, entry.name);
      if (fs.statSync(file).mtimeMs < RUN_STARTED_AT - 1000) {
        continue;
      }
      const source = fs.readFileSync(file, "utf8");
      if (isMessageDocument(source)) {
        found.set(file, parseMessage(source));
      }
    }
  }
  return [...found].map(([file, message]) => ({ file, message }));
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

/** Nothing here asked for words to send, so no card should appear. */
const handedOverNoMessage: Assertion = {
  check: async (context) => {
    const text = "handed over no message";
    const fenced = fencedMessages(context.sessions);
    const files = await handedFiles(context);
    return fenced.length + files.length === 0
      ? pass(text, "none")
      : fail(
          text,
          [...fenced, ...files.map(({ message }) => message)]
            .map(describe)
            .join(" | "),
        );
  },
  text: "handed over no message",
};

/**
 * A message a task wrote reached the user as its file, not typed out again in
 * a fence: the words the task wrote are the words the user sees.
 */
const didNotRetypeATasksMessage: Assertion = {
  check: async (context) => {
    const text = "did not retype a task's message";
    // The conversation writes no files of its own, so any message file this
    // run left, in a task's folder or one it was handed, is a task's.
    const ownDir = taskDir(context.taskId);
    const fromTasks = (await messageFiles(context)).filter(
      ({ file }) => !file.startsWith(ownDir),
    );
    const fenced = fencedMessages(context.sessions);
    // The other way to retype one: the task put the words in its reply and
    // the conversation copied them into a fence.
    const taskTexts = (await context.childSessions()).flatMap((child) =>
      assistantTexts(child.sessions),
    );
    const copied = fenced.filter((message) => {
      const opening = message.body.split("\n").find((line) => line.length > 30);
      return (
        opening !== undefined &&
        taskTexts.some((taskText) => taskText.includes(opening.slice(0, 30)))
      );
    });
    if (copied.length > 0) {
      return fail(
        text,
        `copied from a task's reply: ${copied.map(describe).join(" | ")}`,
      );
    }
    if (fromTasks.length === 0) {
      return pass(text, "no task wrote a message file");
    }
    return fenced.length === 0
      ? pass(text, fromTasks.map(({ file }) => path.basename(file)).join(", "))
      : fail(
          text,
          `task wrote ${fromTasks.map(({ file }) => path.basename(file)).join(", ")}; conversation also fenced ${fenced.map(describe).join(" | ")}`,
        );
  },
  text: "did not retype a task's message",
};

// `[Your name]`, `{recipient}`, `<date>`, the gaps a draft leaves for the
// reader; a Markdown link's `[label](url)` is not one.
const PLACEHOLDER =
  /\[[A-Z][^\]]{1,30}\](?!\()|\{[a-z_ ]{2,30}\}|<(?:name|date|time)>/i;

/** What goes out is sendable: no gap left for the user, no subject in the body. */
const readyToSend: Assertion = {
  check: async (context) => {
    const text = "every message is ready to send";
    const messages = [
      ...fencedMessages(context.sessions),
      ...(await handedFiles(context)).map(({ message }) => message),
    ];
    const problems = messages.flatMap((message) => {
      const found: string[] = [];
      const gap = PLACEHOLDER.exec(message.body);
      if (gap) {
        found.push(`placeholder ${gap[0]}`);
      }
      if (/^subject:/im.test(message.body)) {
        found.push("subject line in the body");
      }
      if (message.body === "") {
        found.push("empty body");
      }
      return found;
    });
    return problems.length === 0
      ? pass(text, `${messages.length} checked`)
      : fail(text, problems.join(", "));
  },
  text: "every message is ready to send",
};

/** A follow-up that changes the words gets a new card, not prose about one. */
function revisedAsAMessage(atLeast: number): Assertion {
  const text = `handed over ${atLeast} messages across the turns`;
  return {
    check: async (context) => {
      const count =
        fencedMessages(context.sessions).length +
        (await handedFiles(context)).length;
      return count >= atLeast ? pass(text, `${count}`) : fail(text, `${count}`);
    },
    text,
  };
}

export const MESSAGE_BLOCK_EVALS = [
  defineEval({
    assertions: [handedOverAMessage(["text"]), readyToSend],
    kind: "orchestrator",
    name: "message-text-a-sister",
    prompt:
      "can you text my sister that my flight lands at 6 now instead of 5, and she doesn't need to rush",
  }),

  defineEval({
    assertions: [handedOverAMessage(), readyToSend, revisedAsAMessage(2)],
    followUps: ["make it a bit shorter and less formal"],
    kind: "orchestrator",
    name: "message-landlord-with-a-revision",
    prompt:
      "help me write something to my landlord Marcy. the dishwasher has been broken for two weeks and I've already asked twice",
  }),

  defineEval({
    assertions: [handedOverAMessage(["email"]), readyToSend],
    kind: "orchestrator",
    name: "message-decline-an-invite",
    prompt:
      "Priya invited me on her podcast but I'm swamped through March. I want to say no without burning the bridge, can you write the email?",
  }),

  defineEval({
    assertions: [handedOverAMessage(["post"]), readyToSend],
    kind: "orchestrator",
    name: "message-linkedin-post",
    prompt:
      "write a linkedin post about us shipping Instrument 2.0 today, keep it humble",
  }),

  defineEval({
    // The data is in a connected app, which the conversation may read itself
    // or hand to a task; either way what reaches the user is one message.
    apps: [{ name: "Beacon", slug: "beacon" }],
    assertions: [
      handedOverAMessage(["chat"]),
      readyToSend,
      didNotRetypeATasksMessage,
    ],
    kind: "orchestrator",
    name: "message-slack-update-from-an-app",
    prompt:
      "put together a quick slack update for the team on where the Beacon issues stand",
  }),

  defineEval({
    // Work first, then the draft: the comparison is a file a task writes, and
    // the email is the task's too, so the conversation hands it over as a file.
    assertions: [
      handedOverAMessage(["email"]),
      readyToSend,
      didNotRetypeATasksMessage,
    ],
    folders: [{ access: "read-only", path: path.join(FIXTURES, "Quotes") }],
    kind: "orchestrator",
    name: "message-after-a-task-compares",
    prompt:
      "Compare the three bathroom quotes in my Quotes folder in a one-page writeup in my Instrument folder, then draft the email to whichever one we should go with asking when they can start.",
  }),

  defineEval({
    assertions: [handedOverNoMessage],
    kind: "orchestrator",
    name: "message-mirror-cc-and-bcc",
    prompt: "what's the actual difference between cc and bcc",
  }),

  defineEval({
    assertions: [handedOverNoMessage],
    kind: "orchestrator",
    name: "message-mirror-a-document",
    prompt:
      "Write a one-page markdown explainer on what a CDN is, in my Instrument folder.",
  }),
];
