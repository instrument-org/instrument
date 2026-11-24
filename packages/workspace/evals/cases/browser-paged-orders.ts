/**
 * One job across many pages of a site only the browser is signed in to, for
 * which way the agent goes through them.
 *
 * Two real sessions asked to find the odd returns in a store's order history
 * wrote a script that started `agent-browser` as a program, were told there
 * was none, and gave up on scripting: one ran a browser command per model
 * step, the other looped inside the page. A script can run the command
 * itself now (`instrument.browser("open", url)` in `node` and `python`), so
 * the whole history is one bash call.
 *
 * The shop is a loopback site: thirty pages of orders, ten to a page, over
 * three years, a year picked from a select or by its address, each page
 * linking the next. Five orders across the years show a refund on hold. The
 * pages answer only a browser's own navigation or a request carrying the
 * cookie that navigation set, so `curl` and `web_fetch` get the sign-in page.
 *
 * The prompt asks for the orders and says nothing of how. The answer is
 * scored; how it was reached is recorded, always passing: bash calls that
 * drove the browser from a script, typed commands, loops in the shell, and
 * loops inside the page, and whether the first script that drove the browser
 * ran clean. Model steps and tokens are the run's own stats. Run it again
 * with `--bash-only`, which opens no script channel, for the same job done
 * with commands alone.
 */
import http from "node:http";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const YEARS = [2026, 2025, 2024];
const PAGES_PER_YEAR = 10;
const PAGE_SIZE = 10;

const ITEMS = [
  "Canvas tote",
  "Desk lamp",
  "Enamel mug",
  "Linen apron",
  "Wool socks, 3 pack",
  "Cast iron trivet",
  "Beeswax candles, 6 pack",
  "Cedar coat hangers, 10 pack",
  "Stoneware planter",
  "Brass key hook",
  "Cotton throw",
  "Oak cutting board",
  "Glass storage jars, 4 pack",
  "Felt desk mat",
  "Steel water bottle",
  "Jute door mat",
];

const ON_HOLD = "Return received · refund on hold";
const REFUNDED = "Return complete · refund issued";

/** Where the orders with a refund on hold sit: year, page, and place on the page. */
const HELD: readonly (readonly [number, number, number])[] = [
  [2026, 3, 4],
  [2026, 9, 8],
  [2025, 2, 1],
  [2025, 7, 6],
  [2024, 6, 3],
];

interface Order {
  amount: string;
  date: string;
  id: string;
  item: string;
  status: string;
}

/** The orders on one page of one year, the same every run. */
function ordersOn(year: number, page: number): Order[] {
  return Array.from({ length: PAGE_SIZE }, (_, place) => {
    const index =
      YEARS.indexOf(year) * PAGES_PER_YEAR * PAGE_SIZE +
      (page - 1) * PAGE_SIZE +
      place;
    const month = 12 - Math.floor(((page - 1) * PAGE_SIZE + place) / 9);
    const held = HELD.some(
      ([heldYear, heldPage, heldPlace]) =>
        heldYear === year && heldPage === page && heldPlace === place,
    );
    return {
      amount: `$${(12 + ((index * 733) % 140) + ((index * 37) % 100) / 100).toFixed(2)}`,
      date: `${year}-${String(Math.max(1, month)).padStart(2, "0")}-${String(1 + ((index * 11) % 28)).padStart(2, "0")}`,
      id: `FS-${48_213 + index * 17}`,
      item: ITEMS[(index * 7) % ITEMS.length] ?? "Canvas tote",
      status: held ? ON_HOLD : index % 13 === 5 ? REFUNDED : "Delivered",
    };
  });
}

const HELD_ORDERS = HELD.flatMap(([year, page, place]) => {
  const order = ordersOn(year, page)[place];
  return order ? [order] : [];
});
const EVERY_ORDER = YEARS.flatMap((year) =>
  Array.from({ length: PAGES_PER_YEAR }, (_, page) =>
    ordersOn(year, page + 1),
  ).flat(),
);

function ordersPage(year: number, page: number): string {
  const cards = ordersOn(year, page)
    .map(
      (order) =>
        `<li class="order-card"><h2>Order ${order.id}</h2><p class="item">${order.item}</p><p class="placed">Placed ${order.date} · ${order.amount}</p><p class="status">${order.status}</p><a href="/orders/${order.id}">View order details</a></li>`,
    )
    .join("\n");
  const next =
    page < PAGES_PER_YEAR
      ? `<a rel="next" href="/orders?year=${year}&page=${page + 1}">Next →</a>`
      : "";
  const previous =
    page > 1
      ? `<a rel="prev" href="/orders?year=${year}&page=${page - 1}">← Previous</a>`
      : "";
  return `<!doctype html><html><head><title>Your orders · Fernhill Supply</title>
<style>body{font-family:sans-serif;max-width:640px;margin:32px auto}ul{list-style:none;padding:0}.order-card{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}h2{font-size:16px;margin:0}p{margin:4px 0}</style></head>
<body><h1>Your orders</h1>
<label for="time-filter">Orders placed in</label>
<select id="time-filter" onchange="location.href='/orders?year='+this.value">${YEARS.map((each) => `<option value="${each}"${each === year ? " selected" : ""}>${each}</option>`).join("")}</select>
<ul>
${cards}
</ul>
<nav>${previous} <span>Page ${page} of ${PAGES_PER_YEAR}</span> ${next}</nav>
</body></html>`;
}

const SIGN_IN_PAGE = `<!doctype html><html><head><title>Sign in · Fernhill Supply</title></head><body><h1>Sign in to see your orders</h1></body></html>`;

/**
 * The session the person signed in with, which only their browser holds: set
 * on a browser's own navigation and never on a request from a script or
 * `curl`, the way a real sign-in lives in the browser profile.
 */
const SESSION_COOKIE = `fernhill=${Math.random().toString(36).slice(2)}`;
let site = "";
/** Every order page the site showed, for the record of how the job went. */
const shown: { navigation: boolean; page: number; year: number }[] = [];

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const cookie = request.headers.cookie?.includes(SESSION_COOKIE) ?? false;
    const navigation = request.headers["sec-fetch-dest"] === "document";
    const signedIn = {
      "content-type": "text/html; charset=utf-8",
      ...(navigation
        ? { "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly` }
        : {}),
    };
    if (!cookie && !navigation) {
      response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      response.end(SIGN_IN_PAGE);
      return;
    }
    if (url.pathname === "/orders") {
      const year = Number(url.searchParams.get("year") ?? YEARS[0]);
      const page = Number(url.searchParams.get("page") ?? "1");
      if (
        !YEARS.includes(year) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > PAGES_PER_YEAR
      ) {
        response.writeHead(404, signedIn);
        response.end("<h1>No orders here</h1>");
        return;
      }
      shown.push({ navigation, page, year });
      response.writeHead(200, signedIn);
      response.end(ordersPage(year, page));
      return;
    }
    const order = EVERY_ORDER.find(
      (each) => url.pathname === `/orders/${each.id}`,
    );
    if (order) {
      response.writeHead(200, signedIn);
      response.end(
        `<!doctype html><html><head><title>Order ${order.id}</title></head><body><h1>Order ${order.id}</h1><p>${order.item}</p><p>Placed ${order.date} · ${order.amount}</p><p>${order.status}</p></body></html>`,
      );
      return;
    }
    response.writeHead(404, signedIn);
    response.end("<h1>Not found</h1>");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("The shop has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

interface BashCall {
  command: string;
  exitCode: number | undefined;
  /** Runs of `agent-browser` the call recorded, typed or from a script. */
  ran: number;
  /** Whether the shell itself ran `agent-browser`, as a typed command does. */
  typed: boolean;
}

function bashCalls(sessions: Session.WithMessagesAndParts[]): BashCall[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash" || part.input?.command === undefined) {
          return [];
        }
        const output =
          part.state === "output-available" ? part.output : undefined;
        return [
          {
            command: part.input.command,
            exitCode: output?.exitCode ?? undefined,
            ran: (output?.ran ?? [])
              .filter((row) => row.name === "agent-browser")
              .reduce((sum, row) => sum + row.count, 0),
            typed: output?.commands.includes("agent-browser") ?? false,
          },
        ];
      }),
    ),
  );
}

function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

const LISTED = "lists the five orders with a refund on hold and no others";

const listsTheHeldOrders: Assertion = {
  check: ({ sessions }) => {
    const reply = replyText(sessions);
    const named = new Set(reply.match(/\bFS-\d+\b/g));
    const held = new Set(HELD_ORDERS.map((order) => order.id));
    const missing = [...held].filter((id) => !named.has(id));
    const wrong = [...named].filter((id) => !held.has(id));
    return {
      evidence: `missing: ${missing.join(", ") || "none"}; named but not on hold: ${wrong.join(", ") || "none"}`,
      passed: missing.length === 0 && wrong.length === 0,
      text: LISTED,
    };
  },
  text: LISTED,
};

const MECHANISM = "records how the pages were gone through";

/**
 * Always passes: the evidence is the record of the route, which is what
 * comparing runs reads. A call drove the browser from a script when it
 * recorded runs of `agent-browser` the shell itself did not start.
 */
const mechanism: Assertion = {
  check: ({ sessions }) => {
    const calls = bashCalls(sessions);
    const scripted = calls.filter((call) => call.ran > 0 && !call.typed);
    const typed = calls.filter((call) => call.typed);
    const shellLoops = typed.filter((call) =>
      /\b(?:for|while)\b[\s\S]*\bagent-browser\b/.test(call.command),
    );
    const inPage = typed.filter(
      (call) =>
        /\bagent-browser\b[\s\S]*\beval\b/.test(call.command) &&
        /\bfetch\(/.test(call.command),
    );
    const asProgram = calls.filter((call) =>
      /(?:subprocess|execFileSync|spawnSync|exec(?:Sync)?\()[\s\S]*agent-browser/.test(
        call.command,
      ),
    );
    const [first] = scripted;
    const pages = new Set(shown.map(({ page, year }) => `${year}/${page}`));
    return {
      evidence: [
        `bash calls ${calls.length}`,
        `calls driving the browser from a script ${scripted.length} (${scripted.reduce((sum, call) => sum + call.ran, 0)} commands)`,
        `first such call ${first === undefined ? "none" : first.exitCode === 0 ? "exited 0" : `exited ${first.exitCode ?? "unknown"}`}`,
        `calls with typed commands ${typed.length} (${shellLoops.length} with a shell loop, ${inPage.length} fetching inside the page)`,
        `calls starting agent-browser as a program ${asProgram.length}`,
        `order pages shown ${pages.size} of ${YEARS.length * PAGES_PER_YEAR} (${shown.filter((each) => each.navigation).length} navigations, ${shown.filter((each) => !each.navigation).length} requests from a page)`,
      ].join("; "),
      passed: true,
      text: MECHANISM,
    };
  },
  text: MECHANISM,
};

export const BROWSER_PAGED_ORDERS_EVALS = [
  defineEval({
    assertions: [listsTheHeldOrders, mechanism],
    name: "browser-paged-orders",
    get prompt() {
      return `I'm signed in to my Fernhill Supply account at ${site}/orders. A few things I sent back never got refunded: the order says the refund is on hold. Go through all of my orders, every year, and list the ones with a refund on hold, with the order number, the item and the amount.`;
    },
    setup: async () => {
      site ||= await serveSite();
      shown.length = 0;
    },
  }),
];
