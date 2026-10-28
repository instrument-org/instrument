/**
 * Does the agent keep `offer_feedback` for problems in Instrument itself?
 *
 * Every case here is a routine failure, the site's, the user's or the
 * agent's own, and none of them is Instrument's: each is scored on there
 * being no `offer_feedback` call at all.
 *
 * The sites are help desks on one loopback server, each at a `.localhost`
 * host of its own, which the browser and `curl` reach without any lookup.
 * A pricing page that works has its plans fetched by its script from an
 * address that answers only a browser, so the agent browses for them, and
 * most prompts pair the failing site with one that works, the way a real
 * request meets one failure among things that go fine.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ulid } from "ulid";

import { updatePermissionSettings } from "../../src/lib/permissions/rules";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type Assertion, defineEval } from "../harness";
import { type AppFixture, StandInStatus } from "../lib/connected-app";

let port = 0;

const PLANS: Record<string, string[]> = {
  helpwave: ["Free", "Growth", "Enterprise"],
};

/**
 * A pricing page whose plans only exist once its script has fetched them,
 * from an address that answers a browser's request and nothing else, so
 * reading the source or fetching the page finds no plans.
 */
const pricingPage = (name: string) => `<!doctype html>
<html><head><title>Pricing · ${name}</title></head>
<body><main id="plans">Loading plans…</main>
<script>
  fetch("/api/plans").then((r) => r.json()).then((plans) => {
    document.getElementById("plans").innerHTML =
      plans.map((plan) => "<h2>" + plan + "</h2>").join("");
  });
</script></body></html>`;

const SIGN_IN_PAGE = `<!doctype html>
<html><head><title>Sign in · Acme Billing</title></head>
<body><h1>Sign in to Acme Billing</h1>
<form method="post" action="/login"><label>Email <input name="email"></label>
<label>Password <input name="password" type="password"></label>
<button>Sign in</button></form></body></html>`;

/** A customer export cut off partway, as a download that stopped would leave it. */
const TRUNCATED_EXPORT = `{"exported_at":"2026-10-28","customers":[${Array.from(
  { length: 40 },
  (_, index) =>
    `{"id":${index + 1},"name":"Customer ${index + 1}","plan":"${index % 3 === 0 ? "Growth" : "Free"}"}`,
).join(",")},{"id":41,"name":"Custo`;

type Reply = { body: string; headers?: Record<string, string>; status: number };

const html = (status: number, body: string): Reply => ({
  body,
  headers: { "content-type": "text/html" },
  status,
});

/** What each help desk answers: its own way of failing, or its pricing. */
function answer(host: string, url: string, fromPage: boolean): Reply | "hang" {
  switch (host) {
    case "acme": {
      return url.startsWith("/account")
        ? html(200, SIGN_IN_PAGE)
        : html(404, "<h1>Not found</h1>");
    }
    case "deskpilot": {
      return {
        body: "<h1>429 Too Many Requests</h1><p>Slow down and try again later.</p>",
        headers: { "content-type": "text/html", "retry-after": "3600" },
        status: 429,
      };
    }
    case "slowdesk": {
      return "hang";
    }
    case "supportly": {
      return html(503, "<h1>503 Service Unavailable</h1>");
    }
    default: {
      break;
    }
  }
  const plans = PLANS[host];
  if (host === "helpwave" && url === "/export.json") {
    return {
      body: TRUNCATED_EXPORT,
      headers: { "content-type": "application/json" },
      status: 200,
    };
  }
  if (plans && url === "/api/plans") {
    return {
      body: fromPage ? JSON.stringify(plans) : '{"error":"forbidden"}',
      headers: { "content-type": "application/json" },
      status: fromPage ? 200 : 403,
    };
  }
  if (plans && url === "/pricing") {
    return html(200, pricingPage(host));
  }
  return html(404, "<h1>404 Not Found</h1><p>There is no page here.</p>");
}

async function serveDesks() {
  const server = http.createServer((request, response) => {
    const host = (request.headers.host ?? "").split(".")[0] ?? "";
    // A page's own fetch says so; curl and a plain fetch do not.
    const fromPage = request.headers["sec-fetch-dest"] === "empty";
    const reply = answer(host, request.url ?? "/", fromPage);
    if (reply === "hang") {
      // Never answers, as a site that has stopped responding.
      return;
    }
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
}

const at = (host: string, pathname: string) =>
  `http://${host}.localhost:${port}${pathname}`;

const PLANS_PROMPT = (failing: string) =>
  `What plans are listed on ${at(failing, "/pricing")} and ${at("helpwave", "/pricing")}? Just tell me the names.`;

/** A folder on a drive the user names, which the agent may ask for and is refused. */
let refusedDrive = "";

async function makeRefusedDrive() {
  const root = path.join(os.tmpdir(), `feedback-drive-${ulid()}`);
  const receipts = path.join(root, "Receipts");
  fs.mkdirSync(receipts, { recursive: true });
  fs.writeFileSync(path.join(receipts, "hotel.txt"), "Hotel, 3 nights: $612\n");
  fs.writeFileSync(path.join(receipts, "flight.txt"), "Flight: $428\n");
  await updatePermissionSettings((settings) => ({
    ...settings,
    // Both spellings of the temp folder (`/var` and `/private/var`).
    folders: [
      ...settings.folders,
      ...[...new Set([root, fs.realpathSync(root)])].map((folder) => ({
        addedAt: new Date(),
        level: "ask" as const,
        path: AbsolutePathSchema.parse(folder),
      })),
    ],
  }));
  refusedDrive = receipts;
}

/** An app the user connected whose sign-in has since expired. */
const LEDGER: AppFixture = {
  kind: "api",
  name: "Ledger",
  service: {
    about: "Ledger is the team's bookkeeping app.",
    endpoints: [
      "- `GET /balance` -- the account's balance, as `{ balance, currency }`.",
      "- `GET /invoices` -- invoices newest first, as `{ invoices: [{ id, customer, amount, status }] }`.",
    ],
    respond: () =>
      new StandInStatus(401, {
        error: "token_expired",
        message: "The access token has expired. Sign in again.",
      }),
  },
  slug: "ledger",
};

const neverOffers = (what: string): Assertion => {
  const text = `never offered to report ${what}`;
  return {
    check: async ({ childSessions, sessions }) => {
      const tasks = (await childSessions()).flatMap((task) => task.sessions);
      const offers = [...sessions, ...tasks].flatMap((session) =>
        session.messages.flatMap((message) =>
          message.parts.filter((part) => part.type === "tool-offer_feedback"),
        ),
      );
      return {
        evidence:
          offers
            .map((part) => JSON.stringify(part.input ?? {}).slice(0, 300))
            .join(" | ") || "no offer",
        passed: offers.length === 0,
        text,
      };
    },
    text,
  };
};

export const FEEDBACK_OFFER_EVALS = [
  defineEval({
    assertions: [neverOffers("a site that is down")],
    kind: "chat",
    name: "feedback-offer-site-down",
    prompt:
      "What plans are listed on https://pricing.helpdesk-competitor.invalid/plans? Just tell me the names.",
  }),

  defineEval({
    assertions: [neverOffers("a site answering 503")],
    kind: "chat",
    name: "feedback-offer-server-error",
    get prompt() {
      return PLANS_PROMPT("supportly");
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a page that is not there")],
    kind: "chat",
    name: "feedback-offer-not-found",
    get prompt() {
      return `What plans are listed on ${at("helpwave", "/pricing-2024")}? Just tell me the names.`;
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a site refusing it with 429")],
    kind: "chat",
    name: "feedback-offer-rate-limited",
    get prompt() {
      return PLANS_PROMPT("deskpilot");
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a sign-in page")],
    kind: "chat",
    name: "feedback-offer-sign-in-wall",
    get prompt() {
      return `What's the amount of my latest invoice on ${at("acme", "/account/invoices")}?`;
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a site that never answers")],
    kind: "chat",
    name: "feedback-offer-slow-site",
    get prompt() {
      return PLANS_PROMPT("slowdesk");
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a file that was cut off")],
    kind: "chat",
    name: "feedback-offer-bad-data",
    get prompt() {
      return `How many customers in ${at("helpwave", "/export.json")} are on the Growth plan?`;
    },
    setup: serveDesks,
  }),

  defineEval({
    assertions: [neverOffers("a folder the user refused")],
    declinesFolders: true,
    kind: "chat",
    name: "feedback-offer-refused-folder",
    get prompt() {
      return `My trip receipts are on my backup drive, in ${refusedDrive}. Which one was the most expensive?`;
    },
    setup: makeRefusedDrive,
  }),

  defineEval({
    apps: [LEDGER],
    assertions: [neverOffers("an app whose sign-in expired")],
    kind: "chat",
    name: "feedback-offer-expired-app",
    prompt: "In Ledger, what's our current balance?",
  }),
];
