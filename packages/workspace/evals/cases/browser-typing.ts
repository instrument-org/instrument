/**
 * Whether a question of several paragraphs, put to an AI chat in the
 * browser, arrives there as one message.
 *
 * A chat composer sends on Enter, and agent-browser's `type` presses Enter
 * for every line break in its text, so a memory import once sent each
 * paragraph of its question to claude.ai as a message of its own. The
 * wrapper types text with line breaks as one insertion; this case scores
 * what the site received, whichever command the model reached for, and its
 * evidence names the commands so a pass can be told from a model that
 * happened to avoid `type`. A run has no window, so the task browses in a
 * Chrome of its own, where the wrapper behaves as it does in the app.
 */
import http from "node:http";

import { z } from "zod";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/** The question, one marker word per paragraph so each can be found. */
const PARAGRAPHS = [
  "List everything you remember about me (marker: AMBER).",
  "Sort it under these headings, in this order (marker: BIRCH):",
  "1. Instructions: rules I asked you to follow.\n2. About me: my name, where I live, my interests.\n3. Work: my roles and companies (marker: CEDAR).",
  "Put each entry on its own line, oldest first (marker: DELTA).",
  "After the list, tell me whether that is everything (marker: EMBER).",
];
const MARKERS = ["AMBER", "BIRCH", "CEDAR", "DELTA", "EMBER"];

/**
 * A chat page like the AI assistants' own: a contenteditable composer that
 * sends on Enter and breaks a line on Shift+Enter, a Send button, and an
 * assistant that answers each message it is sent.
 */
const CHAT_PAGE = `<!doctype html><html><head><title>Assistant</title>
<style>
body{font-family:sans-serif;max-width:640px;margin:32px auto}
#log div{white-space:pre-wrap;margin:8px 0;padding:8px;border-radius:8px}
.you{background:#eef}.assistant{background:#efe}
#composer{min-height:48px;border:1px solid #ccc;border-radius:8px;padding:8px;white-space:pre-wrap}
</style></head>
<body><h1>New chat</h1><div id="log"></div>
<div id="composer" contenteditable="true" role="textbox" aria-label="Message the assistant" aria-multiline="true"></div>
<button id="send">Send</button>
<script>
const composer = document.getElementById("composer");
const log = document.getElementById("log");
function say(who, text) {
  const line = document.createElement("div");
  line.className = who;
  line.textContent = (who === "you" ? "You: " : "Assistant: ") + text;
  log.append(line);
}
async function send() {
  const text = composer.innerText.trim();
  if (!text) return;
  composer.innerHTML = "";
  say("you", text);
  const response = await fetch("/api/send", { method: "POST", body: JSON.stringify({ text }) });
  const { reply } = await response.json();
  say("assistant", reply);
}
composer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});
document.getElementById("send").addEventListener("click", send);
</script></body></html>`;

/** What the page posts when it sends a message. */
const SentSchema = z.object({ text: z.string() });

/**
 * The session the person is signed in with, set on a browser's own
 * navigation and never on a request from a script or `curl`, the way an AI
 * chat's sign-in lives in the browser and nowhere a shell can reach it.
 */
const SESSION_COOKIE = `session=${Math.random().toString(36).slice(2)}`;
let site = "";
/** Every message the chat was sent, in order, as its composer held it. */
const sent: string[] = [];

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    if (url.pathname === "/chat") {
      const browserNavigation =
        request.headers["sec-fetch-dest"] === "document";
      response.writeHead(200, {
        "content-type": "text/html",
        ...(browserNavigation
          ? { "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly` }
          : {}),
      });
      response.end(CHAT_PAGE);
      return;
    }
    if (url.pathname === "/api/send" && request.method === "POST") {
      if (!(request.headers.cookie?.includes(SESSION_COOKIE) ?? false)) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Sign in to chat" }));
        return;
      }
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const { text } = SentSchema.parse(JSON.parse(body));
        sent.push(text);
        const found = MARKERS.filter((marker) => text.includes(marker));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            reply:
              found.length === MARKERS.length
                ? "I have no saved memories about you yet. That is everything."
                : "That looks like only part of a question. Could you send the rest?",
          }),
        );
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("The site has no port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.unref();
  });
}

/** The agent-browser commands that put text into the page. */
function textEntryCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.input?.command !== undefined
          ? part.input.command
              .split(/(?=agent-browser\s)/)
              .filter((call) =>
                /^agent-browser\s+(?:type|fill|keyboard|press|eval)\b/.test(
                  call,
                ),
              )
              .map((call) => call.trim().slice(0, 120).replaceAll("\n", "⏎"))
          : [],
      ),
    ),
  );
}

const sentOnce: Assertion = {
  check: ({ sessions }) => ({
    evidence: `messages the chat received: ${sent.length}; text entry: ${textEntryCommands(sessions).join(" | ") || "none"}`,
    passed: sent.length === 1,
    text: "The chat received the question as one message",
  }),
  text: "The chat received the question as one message",
};

const sentWhole: Assertion = {
  check: () => {
    const [message = ""] = sent;
    const missing = MARKERS.filter((marker) => !message.includes(marker));
    return {
      evidence: JSON.stringify(message).slice(0, 400),
      passed: missing.length === 0 && message.includes("\n"),
      text: "That message held every paragraph, with its line breaks",
    };
  },
  text: "That message held every paragraph, with its line breaks",
};

export const BROWSER_TYPING_EVALS = [
  defineEval({
    assertions: [sentOnce, sentWhole],
    name: "browser-typing-paragraphs",
    get prompt() {
      const quoted = PARAGRAPHS.join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return `Open ${site}/chat, the AI assistant I use, and ask it the question below, then read its whole reply and tell me what it said.

${quoted}`;
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),
];
