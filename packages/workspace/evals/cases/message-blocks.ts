/**
 * Does the conversation hand over words to send as a message?
 *
 * A message is an email, a text, a post: words the user sends as their own.
 * The conversation writes one as a ```message fence; one already written to a
 * Markdown file whose front matter says `message:` is handed over in the files
 * fence rather than typed out again. Both draw one card.
 *
 * The asks are worded the way a person asks for help writing, never naming the
 * block, because what is measured is whether a model reaches for it unprompted:
 * the conversation writing it directly, reading a connected app first, and
 * working something out before it drafts, in the chat or in a fork. Two
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
import { chatDir } from "../../src/lib/record-folders";
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
      parseMessage(match.groups?.body ?? ""),
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
  const files = await messageFiles(context);
  return files.filter(({ file }) => named.has(path.basename(file)));
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
  // The chat's tasks work in its folder.
  const roots = [os.homedir(), chatDir(context.chatId)];
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
 * Each message reached the user once: a message file handed over is not also
 * typed out in a fence, and a fence is not a copy of words a fork already
 * wrote in its reply.
 */
const didNotRetypeAMessage: Assertion = {
  check: async (context) => {
    const text = "did not retype a message";
    const fenced = fencedMessages(context.sessions);
    const opening = (message: MessageDraft) =>
      message.body
        .split("\n")
        .find((line) => line.length > 30)
        ?.slice(0, 30);
    const children = await context.childSessions();
    const forkTexts = children.flatMap((child) =>
      assistantTexts(child.sessions),
    );
    const files = await messageFiles(context);
    const retyped = fenced.filter((message) => {
      const start = opening(message);
      return (
        start !== undefined &&
        (forkTexts.some((forkText) => forkText.includes(start)) ||
          files.some((file) => file.message.body.includes(start)))
      );
    });
    return retyped.length === 0
      ? pass(
          text,
          `${fenced.length} fenced, ${files.length} message files: ${files.map(({ file }) => path.basename(file)).join(", ") || "none"}`,
        )
      : fail(
          text,
          `fenced again what a fork or a file already held: ${retyped.map(describe).join(" | ")}`,
        );
  },
  text: "did not retype a message",
};

// `[Your name]`, `{recipient}`, `<date>`, the gaps a draft leaves for the
// reader; a Markdown link's `[label](url)` is not one.
const PLACEHOLDER =
  /\[[A-Z][^\]]{1,30}\](?!\()|\{[a-z_ ]{2,30}\}|<(?:name|date|time)>/i;

/** What goes out is sendable: no gap left for the user, no subject in the body. */
const readyToSend: Assertion = {
  check: async (context) => {
    const text = "every message is ready to send";
    const handed = await handedFiles(context);
    const messages = [
      ...fencedMessages(context.sessions),
      ...handed.map(({ message }) => message),
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
      const handed = await handedFiles(context);
      const count = fencedMessages(context.sessions).length + handed.length;
      return count >= atLeast ? pass(text, `${count}`) : fail(text, `${count}`);
    },
    text,
  };
}

export const MESSAGE_BLOCK_EVALS = [
  defineEval({
    assertions: [handedOverAMessage(["text"]), readyToSend],
    kind: "chat",
    name: "message-text-a-sister",
    prompt:
      "can you text my sister that my flight lands at 6 now instead of 5, and she doesn't need to rush",
  }),

  defineEval({
    assertions: [handedOverAMessage(), readyToSend, revisedAsAMessage(2)],
    followUps: ["make it a bit shorter and less formal"],
    kind: "chat",
    name: "message-landlord-with-a-revision",
    prompt:
      "help me write something to my landlord Marcy. the dishwasher has been broken for two weeks and I've already asked twice",
  }),

  defineEval({
    assertions: [handedOverAMessage(["email"]), readyToSend],
    kind: "chat",
    name: "message-decline-an-invite",
    prompt:
      "Priya invited me on her podcast but I'm swamped through March. I want to say no without burning the bridge, can you write the email?",
  }),

  defineEval({
    assertions: [handedOverAMessage(["post"]), readyToSend],
    kind: "chat",
    name: "message-linkedin-post",
    prompt:
      "write a linkedin post about us shipping Instrument 2.0 today, keep it humble",
  }),

  defineEval({
    // The data is in a connected app, which the conversation may read itself
    // or in a fork; either way what reaches the user is one message.
    apps: [{ name: "Beacon", slug: "beacon" }],
    assertions: [
      handedOverAMessage(["chat"]),
      readyToSend,
      didNotRetypeAMessage,
    ],
    kind: "chat",
    name: "message-slack-update-from-an-app",
    prompt:
      "put together a quick slack update for the team on where the Beacon issues stand",
  }),

  defineEval({
    // Work first, then the draft: the comparison is a file, and the email
    // reaches the user once, whoever did the work.
    assertions: [
      handedOverAMessage(["email"]),
      readyToSend,
      didNotRetypeAMessage,
    ],
    folders: [{ access: "read-only", path: path.join(FIXTURES, "Quotes") }],
    kind: "chat",
    name: "message-after-a-comparison",
    prompt:
      "Compare the three bathroom quotes in my Quotes folder in a one-page writeup in my Instrument folder, then draft the email to whichever one we should go with asking when they can start.",
  }),

  defineEval({
    assertions: [handedOverNoMessage],
    kind: "chat",
    name: "message-mirror-cc-and-bcc",
    prompt: "what's the actual difference between cc and bcc",
  }),

  defineEval({
    assertions: [handedOverNoMessage],
    kind: "chat",
    name: "message-mirror-a-document",
    prompt:
      "Write a one-page markdown explainer on what a CDN is, in my Instrument folder.",
  }),
];
