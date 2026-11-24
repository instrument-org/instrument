/**
 * Whether a form with dropdowns is submitted with the values asked for.
 *
 * The form has three native selects: a short one, one of 320 options, and
 * one with a value already chosen that the order changes. Every option's
 * value differs from its name, so the commands in the evidence say whether
 * the model chose by name, by value, by an option's ref or with a script.
 * The case scores what the site received.
 *
 * The form is a page of its own behind a "Start order" link, so the first
 * sight of its selects is the page snapshot the click ends with, unless the
 * model reads the page itself. As `snapshot -i` prints it, the form is past
 * the 10,000 characters a snapshot attached to a call is cut at: the cut
 * falls inside the long select, ahead of the region the order asks for, the
 * shipping select and the button. The site serves the form and takes an
 * order only in a browser that opened its first page, so the options cannot
 * be read, or the order placed, with `curl` or a fetch. A run has no window,
 * so the task browses in a Chrome of its own, where the snapshot a command
 * ends with is the one the app attaches.
 */
import http from "node:http";

import { z } from "zod";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

const SIZES = ["Extra small", "Small", "Medium", "Large", "Extra large"];
const SHIPPING = ["Economy", "Standard", "Two-day", "Overnight"];
const PRESELECTED_SHIPPING = "Standard";

/** 320 invented place names, in alphabetical order. */
const REGIONS = [
  "Alder",
  "Brine",
  "Cinder",
  "Dapple",
  "Ember",
  "Fennel",
  "Gorse",
  "Harrow",
  "Islet",
  "Juniper",
  "Kestrel",
  "Larch",
  "Marrow",
  "Nettle",
  "Osier",
  "Pewter",
  "Quill",
  "Russet",
  "Sorrel",
  "Tansy",
].flatMap((first) =>
  [
    "Bank",
    "Cross",
    "Fen",
    "Ford",
    "Gate",
    "Haven",
    "Heath",
    "Hollow",
    "Lea",
    "Marsh",
    "Moor",
    "Reach",
    "Ridge",
    "Strand",
    "Vale",
    "Wick",
  ].map((second) => `${first} ${second}`),
);

/** What the order asks for, by field. */
const ORDER = {
  name: "Wren Holloway",
  region: "Sorrel Strand",
  shipping: "Overnight",
  size: "Large",
};

function options(prefix: string, names: string[], selected?: string): string {
  return names
    .map(
      (name, index) =>
        `<option value="${prefix}-${index}"${name === selected ? " selected" : ""}>${name}</option>`,
    )
    .join("");
}

const START_PAGE = `<!doctype html><html><head><title>Jackets</title>
<style>body{font-family:sans-serif;max-width:480px;margin:32px auto}</style></head>
<body><h1>Jackets</h1>
<p>One jacket, made to order.</p>
<a href="/order/new">Start order</a>
</body></html>`;

const ORDER_PAGE = `<!doctype html><html><head><title>Order a jacket</title>
<style>
body{font-family:sans-serif;max-width:480px;margin:32px auto}
label{display:block;margin:12px 0}
</style></head>
<body><h1>Order a jacket</h1>
<form id="order">
<label>Name <input id="name" name="name"></label>
<label>Size <select id="size" name="size">${options("size", SIZES)}</select></label>
<label>Region <select id="region" name="region">${options("region", REGIONS)}</select></label>
<label>Shipping <select id="shipping" name="shipping">${options("ship", SHIPPING, PRESELECTED_SHIPPING)}</select></label>
<button type="submit">Place order</button>
</form>
<p id="done" role="status"></p>
<script>
document.getElementById("order").addEventListener("submit", async (event) => {
  event.preventDefault();
  const chosen = (id) => document.getElementById(id).selectedOptions[0].textContent;
  const response = await fetch("/api/order", {
    method: "POST",
    body: JSON.stringify({
      name: document.getElementById("name").value,
      region: chosen("region"),
      shipping: chosen("shipping"),
      size: chosen("size"),
    }),
  });
  const { confirmation } = await response.json();
  document.getElementById("done").textContent = "Order placed. Confirmation " + confirmation;
});
</script></body></html>`;

/** What the page posts when the form is submitted. */
const OrderSchema = z.object({
  name: z.string(),
  region: z.string(),
  shipping: z.string(),
  size: z.string(),
});

/**
 * What a browser that opened the first page carries from then on. It is set
 * on a browser's own navigation and never on a request from a script or
 * `curl`.
 */
const SESSION_COOKIE = `session=${Math.random().toString(36).slice(2)}`;
let site = "";
/** Every order the site received, in order. */
const orders: z.output<typeof OrderSchema>[] = [];

async function serveSite(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const signedIn = request.headers.cookie?.includes(SESSION_COOKIE) ?? false;
    if (url.pathname === "/order") {
      const browserNavigation =
        request.headers["sec-fetch-dest"] === "document";
      response.writeHead(200, {
        "content-type": "text/html",
        ...(browserNavigation
          ? { "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly` }
          : {}),
      });
      response.end(START_PAGE);
      return;
    }
    if (url.pathname === "/order/new") {
      if (!signedIn) {
        response.writeHead(302, { location: "/order" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(ORDER_PAGE);
      return;
    }
    if (url.pathname === "/api/order" && request.method === "POST") {
      if (!signedIn) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Start the order in a browser" }));
        return;
      }
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        orders.push(OrderSchema.parse(JSON.parse(body)));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ confirmation: `JK-${4170 + orders.length}` }),
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

/** The agent-browser commands that could set a dropdown or read its options. */
function dropdownCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && part.input?.command !== undefined
          ? part.input.command
              .split(/(?=agent-browser\s)/)
              .filter((call) =>
                /^agent-browser\s+(?:select|click|eval|snapshot|find|keyboard|press|type|fill)\b/.test(
                  call,
                ),
              )
              .map((call) => call.trim().slice(0, 120).replaceAll("\n", "⏎"))
          : [],
      ),
    ),
  );
}

const orderedAsAsked: Assertion = {
  check: ({ sessions }) => {
    const order = orders.at(-1);
    return {
      evidence: `orders received: ${orders.length}; last: ${JSON.stringify(order ?? null)}; commands: ${dropdownCommands(sessions).join(" | ") || "none"}`,
      passed:
        order !== undefined &&
        order.name.trim() === ORDER.name &&
        order.region === ORDER.region &&
        order.shipping === ORDER.shipping &&
        order.size === ORDER.size,
      text: "The site received the order with every value asked for",
    };
  },
  text: "The site received the order with every value asked for",
};

export const BROWSER_DROPDOWN_EVALS = [
  defineEval({
    assertions: [orderedAsAsked],
    name: "browser-dropdowns-order-form",
    get prompt() {
      return `Open ${site}/order and place this order for me, then tell me the confirmation number.

- Name: ${ORDER.name}
- Size: ${ORDER.size}
- Region: ${ORDER.region}
- Shipping: ${ORDER.shipping}`;
    },
    setup: async () => {
      site ||= await serveSite();
    },
  }),
];
