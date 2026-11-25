/**
 * Whether a form that shows its next question in place, some time after the
 * click that answered the last one, is filled in without reading too early.
 *
 * Each answer posts in the background and the page keeps the question it
 * shows, with nothing to say it is working, until the reply comes 400 to
 * 2,000 ms later. A page read straight after the click, the snapshot attached
 * to the call among them, is of the question just answered. A model that acts
 * on that answers it twice, or spends a step looking again.
 *
 * The site answers only in a browser, so the page's source cannot be read with
 * `curl` to learn how it updates. The claim it received is scored; the route
 * is recorded, always passing: model steps that only read the page, waits by
 * kind, and answers the site had already.
 */
import http from "node:http";

import { z } from "zod";

import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/** Each question in turn: what it offers, what the prompt asks for, and how long its answer takes. */
const QUESTIONS = [
  {
    answer: "Kettle",
    delayMs: 1200,
    options: ["Toaster", "Kettle", "Blender"],
    title: "Which product is this about?",
  },
  {
    answer: "It stopped working",
    delayMs: 600,
    options: ["It arrived damaged", "It stopped working", "A part is missing"],
    title: "What went wrong?",
  },
  {
    answer: "It does not turn on",
    delayMs: 2000,
    options: ["It leaks", "It does not turn on", "It turns off early"],
    title: "What does it do?",
  },
  {
    answer: "More than a month ago",
    delayMs: 400,
    options: ["This week", "This month", "More than a month ago"],
    title: "When did it start?",
  },
  {
    answer: "Yes",
    delayMs: 1500,
    options: ["Yes", "No"],
    title: "Do you still have the box?",
  },
  {
    answer: "Replacement",
    delayMs: 900,
    options: ["Repair", "Replacement", "Store credit"],
    title: "How should we put it right?",
  },
  {
    answer: "Drop it off",
    delayMs: 1800,
    options: ["Home pickup", "Drop it off"],
    title: "How will you send it back?",
  },
  {
    answer: "Email",
    delayMs: 1000,
    options: ["Email", "Phone", "Text message"],
    title: "How should we keep you posted?",
  },
];

const PAGE = `<!doctype html><html><head><title>Warranty claim</title>
<style>body{font-family:sans-serif;max-width:480px;margin:32px auto}label{display:block;margin:12px 0}</style></head>
<body><h1>Warranty claim</h1><main id="step"></main>
<script>
const step = document.getElementById("step");
function show(state) {
  if (state.confirmation) {
    step.innerHTML = "<h2>Claim sent</h2><p>Your claim number is " + state.confirmation + ".</p>";
    return;
  }
  step.innerHTML = "<h2>" + state.title + "</h2>" + state.options.map((option) =>
    '<label><input type="radio" name="answer" value="' + option + '"> ' + option + "</label>").join("") +
    '<button type="button">Continue</button>';
  step.querySelector("button").addEventListener("click", async () => {
    const answer = step.querySelector("input:checked")?.value;
    if (!answer) return;
    const response = await fetch("/api/answer", { method: "POST", body: JSON.stringify({ answer, question: state.question }) });
    show(await response.json());
  });
}
fetch("/api/state").then((response) => response.json()).then(show);
</script></body></html>`;

const AnswerSchema = z.object({ answer: z.string(), question: z.number() });

/** Set on a browser's own navigation, and never on a request from a script or `curl`. */
const SESSION_COOKIE = `session=${Math.random().toString(36).slice(2)}`;
const HOME_TAB = "tab_01M3AX9RF3C2E9RTATMB602W1A";

/** The new-tab page on screen, nothing else open. */
const viewing: SessionMessageDataPart.ViewContextDataPart = {
  screen: "home",
  tabs: [{ at: "/new-tab", id: HOME_TAB, title: "New tab" }],
  url: "/new-tab",
};

let site = "";
const answers: string[] = [];
/** Answers to a question the site already had one for. */
let repeated = 0;
let confirmation = "";

function state() {
  const question = QUESTIONS[answers.length];
  return question
    ? {
        options: question.options,
        question: answers.length,
        title: question.title,
      }
    : { confirmation };
}

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/claim") {
      const navigation = request.headers["sec-fetch-dest"] === "document";
      if (!navigation) {
        response.writeHead(403);
        response.end("Open this page in a browser.");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly`,
      });
      response.end(PAGE);
      return;
    }
    if (!request.headers.cookie?.includes(SESSION_COOKIE)) {
      json({ error: "Start the claim in a browser" }, 401);
      return;
    }
    if (request.url === "/api/state") {
      json(state());
      return;
    }
    if (request.url === "/api/answer" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const { answer, question } = AnswerSchema.parse(JSON.parse(body));
        const delayMs = QUESTIONS[question]?.delayMs ?? 0;
        if (question === answers.length) {
          answers.push(answer);
          if (answers.length === QUESTIONS.length) {
            confirmation = "WC-58214";
          }
        } else {
          repeated += 1;
        }
        setTimeout(() => json(state()), delayMs);
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("The site has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function browserCalls(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" &&
        part.input?.command?.includes("agent-browser")
          ? [part.input.command]
          : [],
      ),
    ),
  );
}

const ACTS =
  /agent-browser\s+(?:open|click|check|press|select|find|eval|type|fill|keyboard)\b/;
const READS = /agent-browser\s+(?:snapshot|get|read|screenshot)\b/;

const ANSWERED = "the site received every answer as asked";
const answered: Assertion = {
  check: () => ({
    evidence: `answers: ${answers.join(" | ") || "none"}`,
    passed:
      confirmation !== "" &&
      QUESTIONS.every(({ answer }, index) => answers[index] === answer),
    text: ANSWERED,
  }),
  text: ANSWERED,
};

const ROUTE = "records how the questions were gone through";
/** Always passes: the evidence is what comparing runs reads. */
const route: Assertion = {
  check: ({ sessions }) => {
    const calls = browserCalls(sessions);
    const count = (test: (call: string) => boolean) =>
      calls.filter(test).length;
    return {
      evidence: [
        `browser calls ${calls.length}`,
        `only reading ${count((call) => READS.test(call) && !ACTS.test(call))}`,
        `clicking then reading with no wait ${count((call) => /agent-browser\s+(?:click|find)\b(?![\s\S]*(?:\bwait\b|\bsleep\b))[\s\S]*agent-browser\s+(?:snapshot|get|read|screenshot)\b/.test(call))}`,
        `waiting for a condition ${count((call) => /agent-browser\s+wait\s+(?!\d)/.test(call))}`,
        `waiting a set time ${count((call) => /agent-browser\s+wait\s+\d|\bsleep\s/.test(call))}`,
        `answers repeated ${repeated}`,
      ].join("; "),
      passed: true,
      text: ROUTE,
    };
  },
  text: ROUTE,
};

export const BROWSER_IN_PLACE_EVALS = [
  defineEval({
    assertions: [answered, route],
    kind: "chat",
    name: "browser-in-place-claim",
    get prompt() {
      return `Fill in the warranty claim at ${site}/claim for me and tell me the claim number. My kettle quit more than a month ago and won't turn on at all. I'd like a replacement, I still have the box, and I can drop it off. Email is the best way to reach me.`;
    },
    setup: async () => {
      site ||= await serveSite();
      answers.length = 0;
      repeated = 0;
      confirmation = "";
    },
    sharedBrowser: true,
    viewing,
  }),
];
