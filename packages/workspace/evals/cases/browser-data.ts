/**
 * How the agent gets at what a signed-in web app holds, and whether it looks
 * at a page when how it looks is the question.
 *
 * The agent-browser addendum says a signed-in app's data comes most easily
 * from the requests the app itself makes (`network requests`, then `eval`
 * with `fetch`), and that the last screenshot a call takes comes back in its
 * result as an image. These cases ask whether a model reaches for either
 * when the task calls for it. A run has no window, so each task browses in a
 * Chrome of its own, where the wrapper behaves as it does in the app.
 */
import http from "node:http";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

/** Four hundred orders, twenty to a page, with amounts in cents. */
const ORDERS = Array.from({ length: 400 }, (_, index) => ({
  amountCents: 1000 + ((index * 737) % 9000),
  id: `A-${1000 + index}`,
}));
const ORDERS_TOTAL = (
  ORDERS.reduce((sum, order) => sum + order.amountCents, 0) / 100
).toFixed(2);
const PAGE_SIZE = 20;

/**
 * An orders page that shows its first page of orders from its own API and
 * the rest only behind "Load more", and an API that answers only the
 * signed-in session the page's cookie carries.
 */
const ORDERS_PAGE = `<!doctype html><html><head><title>Your orders</title>
<style>body{font-family:sans-serif}li{padding:4px 0}</style></head>
<body><h1>Your orders</h1><ul id="orders"></ul><button id="more">Load more</button>
<script>
let page = 1;
async function load() {
  const response = await fetch("/api/orders?page=" + page, { credentials: "include" });
  const { orders, hasMore } = await response.json();
  for (const order of orders) {
    const item = document.createElement("li");
    item.textContent = order.id + " · $" + (order.amountCents / 100).toFixed(2);
    document.getElementById("orders").append(item);
  }
  document.getElementById("more").hidden = !hasMore;
  page += 1;
}
document.getElementById("more").addEventListener("click", load);
load();
</script></body></html>`;

/**
 * A sign-up form whose button label is white on a white button: the
 * accessibility tree reads it as "Create account", and only a picture shows
 * nobody can see it.
 */
const SIGNUP_PAGE = `<!doctype html><html><head><title>Sign up</title>
<style>
body{font-family:sans-serif;max-width:420px;margin:48px auto}
label{display:block;margin:12px 0 4px}
input{width:100%;padding:8px;font-size:16px}
button{margin-top:20px;width:100%;padding:12px;font-size:16px;background:#fff;color:#fff;border:1px solid #ddd;border-radius:6px}
</style></head>
<body><h1>Create your account</h1>
<label for="email">Email</label><input id="email" type="email">
<label for="password">Password</label><input id="password" type="password">
<button type="submit">Create account</button>
</body></html>`;

/**
 * The session the person signed in with, which only their browser holds: the
 * orders page sets it on a browser's own navigation and never on a request
 * from a script or `curl`, the way a real sign-in lives in the browser
 * profile and nowhere a shell can read it.
 */
const SESSION_COOKIE = `session=${Math.random().toString(36).slice(2)}`;
let site = "";
/** Every request the site answered, by path and query, for the assertions. */
const served: { cookie: boolean; path: string }[] = [];

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const cookie = request.headers.cookie?.includes(SESSION_COOKIE) ?? false;
    served.push({ cookie, path: `${url.pathname}${url.search}` });
    if (url.pathname === "/orders") {
      const browserNavigation = request.headers["sec-fetch-dest"] === "document";
      response.writeHead(200, {
        "content-type": "text/html",
        ...(browserNavigation
          ? { "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly` }
          : {}),
      });
      response.end(ORDERS_PAGE);
      return;
    }
    if (url.pathname === "/api/orders") {
      if (!cookie) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Sign in to see your orders" }));
        return;
      }
      const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
      const orders = ORDERS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ hasMore: page * PAGE_SIZE < ORDERS.length, orders }),
      );
      return;
    }
    if (url.pathname === "/signup") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(SIGNUP_PAGE);
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

type BashPart = {
  command: string;
  screenshot: boolean;
};

/** Every bash call in the run, with whether its result carried a screenshot. */
function bashCalls(sessions: Session.WithMessagesAndParts[]): BashPart[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.input?.command !== undefined
          ? [
              {
                command: part.input.command,
                screenshot:
                  part.state === "output-available" &&
                  part.output.screenshot !== undefined,
              },
            ]
          : [],
      ),
    ),
  );
}

/** Image files the run read back with `read_file`. */
function imageReads(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-read_file" &&
        /\.(?:png|jpe?g|webp)$/i.test(part.input?.filePath ?? "")
          ? [part.input?.filePath ?? ""]
          : [],
      ),
    ),
  );
}

function reply(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n");
}

const usedTheAppsRequests: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCalls(sessions).map(({ command }) => command);
    const network = commands.filter((command) =>
      /agent-browser\s+network\s+requests?\b/.test(command),
    );
    const fetched = served.filter(
      ({ cookie, path }) => cookie && path.startsWith("/api/orders"),
    );
    const scripted = commands.filter(
      (command) =>
        /agent-browser\s+eval/.test(command) && /fetch\(/.test(command),
    );
    return {
      evidence: `network: ${network.length}, eval with fetch: ${scripted.length}, signed-in API requests the site answered: ${fetched.map(({ path }) => path).join(" ")}`,
      passed: scripted.length > 0,
      text: "Asked the app's own API for the orders from the page",
    };
  },
  text: "Asked the app's own API for the orders from the page",
};

const gaveTheTotal: Assertion = {
  check: ({ sessions }) => {
    const text = reply(sessions);
    const plain = text.replaceAll(",", "");
    return {
      evidence: text.slice(-600) || "no reply",
      passed: plain.includes(ORDERS_TOTAL),
      text: `Gave the total of all ${ORDERS.length} orders, $${ORDERS_TOTAL}`,
    };
  },
  text: `Gave the total of all ${ORDERS.length} orders, $${ORDERS_TOTAL}`,
};

const sawTheScreenshot: Assertion = {
  check: ({ sessions }) => {
    const shown = bashCalls(sessions).filter(({ screenshot }) => screenshot);
    const reads = imageReads(sessions);
    return {
      evidence: `screenshots shown in a result: ${shown.length}; image files read back: ${reads.join(", ") || "none"}`,
      passed: shown.length > 0 && reads.length === 0,
      text: "Looked at the page through the screenshot its result carried, without reading the file",
    };
  },
  text: "Looked at the page through the screenshot its result carried, without reading the file",
};

const namedTheInvisibleLabel: Assertion = {
  check: ({ sessions }) => {
    const text = reply(sessions);
    return {
      evidence: text.slice(-600) || "no reply",
      passed:
        /button/i.test(text) &&
        /(invisible|can'?t (?:be )?see|not visible|white (?:on|text)|contrast|blank|unreadable|no visible)/i.test(
          text,
        ),
      text: "Said the button's label cannot be seen",
    };
  },
  text: "Said the button's label cannot be seen",
};

export const BROWSER_DATA_EVALS = [
  defineEval({
    assertions: [usedTheAppsRequests, gaveTheTotal],
    name: "browser-app-requests",
    get prompt() {
      return `I'm signed in to my store account at ${site}/orders. Add up every order I've ever placed there and tell me the total.`;
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),

  defineEval({
    assertions: [sawTheScreenshot, namedTheInvisibleLabel],
    name: "browser-screenshot-look",
    get prompt() {
      return `I just made a sign-up page at ${site}/signup. Something about it looks off to me. Can you open it in the browser, take a look, and tell me what's wrong?`;
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),
];
