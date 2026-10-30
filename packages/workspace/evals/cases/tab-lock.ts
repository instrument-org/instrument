/**
 * The one-driver-per-tab lock between a chat and its tasks, and a session
 * seeing only the tabs it holds. Each case starts with the user looking at a
 * shop page in a chat tab, in one real headless Chrome every session reaches
 * through the CDP bridge (`sharedBrowser`), and asks for work that could put
 * two sessions in that one page at once: two tasks on it, or the chat acting
 * on the page while a task works there. The checkout form keeps its values
 * only in the page, so a session that takes the tab elsewhere under another
 * empties it; the cart is the shop's own. What broke when sessions shared
 * tabs: the form emptied while the chat said it was filled, and a task
 * following another session's new tab added items twice.
 *
 * The teardown writes the shop tab's form, the cart, the orders and the
 * shop's request log into the records as `tab-lock-outcome.json`, which the
 * assertions read, so `report` rescores a past run the same way.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { chatDir } from "../../src/lib/record-folders";
import { type Session } from "../../src/schemas/session";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type Assertion, defineEval } from "../harness";
import { getSharedChrome } from "../lib/shared-chrome";

const SHOP_TAB = "tab_01M3AX9RF3C2E9RTATMB60QQ01";

const AISLES: Record<string, string[]> = {
  Bakery: [
    "Sourdough roll",
    "Country loaf",
    "Butter croissant",
    "Cinnamon bun",
    "Plain bagels (4)",
    "Rye bread",
    "Baguette",
    "Blueberry muffin",
  ],
  Produce: [
    "Banana",
    "Strawberries, 1 lb",
    "Lemon",
    "Avocados (4)",
    "Baby spinach",
    "Blueberries, 1 pint",
    "Red onion",
    "Garlic bulb",
  ],
  Dairy: [
    "Whole milk, 1 gal",
    "Greek yogurt",
    "Aged cheddar",
    "Salted butter",
    "Eggs (6)",
    "Cream cheese",
    "Oat milk",
    "Feta",
  ],
  Pantry: [
    "Spaghetti",
    "Olive oil",
    "Long-grain rice",
    "Crushed tomatoes",
    "Peanut butter",
    "Sea salt",
    "Ground coffee",
    "Rolled oats",
  ],
  Frozen: [
    "Frozen peas",
    "Vanilla ice cream",
    "Fish sticks",
    "Frozen pizza",
    "Mixed berries",
    "Waffles",
    "Edamame",
    "Hash browns",
  ],
  Snacks: [
    "Tortilla chips",
    "Salsa",
    "Dark chocolate",
    "Pretzels",
    "Popcorn",
    "Trail mix",
    "Granola bars",
    "Rice cakes",
  ],
  Drinks: [
    "Sparkling water",
    "Orange juice",
    "Cold brew",
    "Green tea",
    "Lemonade",
    "Ginger ale",
    "Coconut water",
    "Kombucha",
  ],
  Household: [
    "Dish soap",
    "Paper towels",
    "Sponges (3)",
    "Trash bags",
    "Laundry pods",
    "Hand soap",
    "Foil",
    "Napkins",
  ],
};

/** Four pages of the catalog, two aisles each, prices spread from $0.79 to $9.49. */
const PRODUCTS = Object.entries(AISLES).flatMap(([section, names], aisle) =>
  names.map((name, index) => {
    const n = aisle * 8 + index;
    return {
      name,
      page: Math.floor(aisle / 2) + 1,
      price: Math.round((0.79 + ((n * 37) % 87) / 10) * 100) / 100,
      section,
      sku: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-$/, ""),
    };
  }),
);
const PAGES = 4;

interface ShopEvent {
  body?: string;
  method: string;
  path: string;
  t: number;
}

const shop = {
  cart: [] as string[],
  events: [] as ShopEvent[],
  orders: [] as unknown[],
};

/**
 * The cart as the page shows it, from the shop's own record: rendered with
 * the page and sent back whole by an add, which the page's click waits for,
 * so the cart on screen is current the moment an Add click returns.
 */
function cartHtml(): string {
  const counts = new Map<string, number>();
  for (const sku of shop.cart) {
    counts.set(sku, (counts.get(sku) ?? 0) + 1);
  }
  const items = [...counts].map(([sku, qty]) => {
    const product = PRODUCTS.find((p) => p.sku === sku);
    return { name: product?.name ?? sku, price: product?.price ?? 0, qty };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return `<ul id="cart-items">${items.map((item) => `<li>${item.name} x${String(item.qty)}</li>`).join("")}</ul><p id="cart-total">Total: $${total.toFixed(2)}</p>`;
}

function shopPage(page: number, zip: string | null): string {
  const onPage = PRODUCTS.filter((p) => p.page === page);
  const sections = [...new Set(onPage.map((p) => p.section))];
  const fee = zip ? (zip.startsWith("941") ? "$6.49" : "$3.99") : null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Corner Market</title>
<style>body{font-family:sans-serif;max-width:900px;margin:auto}li{margin:4px 0}</style></head><body>
<h1>Corner Market</h1>
<p>Fresh groceries, delivered the same day.</p>
<section id="delivery"><h2>Delivery cost</h2>
<form method="get" action="/shop"><input type="hidden" name="page" value="${page}"><label>ZIP code <input name="zip" value="${zip ?? ""}"></label> <button>Check delivery</button></form>
${fee ? `<p id="fee">Delivery to ${zip ?? ""}: ${fee}</p>` : ""}</section>
${sections
  .map(
    (section) =>
      `<section><h2>${section}</h2><ul>${onPage
        .filter((p) => p.section === section)
        .map(
          (p) =>
            `<li>${p.name}, $${p.price.toFixed(2)} <button onclick="add('${p.sku}')" aria-label="Add ${p.name}">Add</button></li>`,
        )
        .join("")}</ul></section>`,
  )
  .join("")}
<nav id="pages">Catalog page ${page} of ${PAGES}: ${Array.from({ length: PAGES }, (_, i) => (i + 1 === page ? `<b>${i + 1}</b>` : `<a href="/shop?page=${i + 1}">${i + 1}</a>`)).join(" ")}${page < PAGES ? ` <a href="/shop?page=${page + 1}">Next page</a>` : ""}</nav>
<section id="cart"><h2>Your cart</h2>${cartHtml()}</section>
<section id="checkout"><h2>Checkout</h2>
<form id="checkout-form" onsubmit="placeOrder(event)">
<p><label>Full name <input name="name"></label></p>
<p><label>Street address <input name="street"></label></p>
<p><label>City <input name="city"></label></p>
<p><label>ZIP <input name="zip"></label></p>
<p><label>Phone <input name="phone"></label></p>
<p><label>Delivery notes <textarea name="notes"></textarea></label></p>
<p><button type="submit">Place order</button></p>
</form><p id="order-status"></p></section>
<footer><a href="/shop/reviews">Customer reviews</a> · <a href="/shop/returns">Returns policy</a></footer>
<script>
function add(sku){const x=new XMLHttpRequest();x.open('POST','/api/cart',false);x.send(sku);
document.getElementById('cart').innerHTML='<h2>Your cart</h2>'+x.responseText;}
async function placeOrder(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));
await fetch('/api/order',{method:'POST',body:JSON.stringify(d)});document.getElementById('order-status').textContent='Order placed.';}
document.querySelectorAll('#checkout-form input, #checkout-form textarea').forEach(el=>el.addEventListener('change',()=>fetch('/api/event',{method:'POST',body:el.name+'='+el.value})));
</script></body></html>`;
}

const REVIEWS = `<!doctype html><html><head><meta charset="utf-8"><title>Reviews - Corner Market</title></head><body><h1>Customer reviews</h1>
<ul>
<li>★★★★☆ Great bread, but my delivery came two hours after the window.</li>
<li>★★☆☆☆ Late again. Third time this month the driver missed the slot.</li>
<li>★★★★★ Love the produce, always fresh.</li>
<li>★★★☆☆ Good prices. Deliveries are slow on weekends.</li>
<li>★★★★★ Friendly drivers, on time for me.</li>
<li>★★☆☆☆ Order arrived the next morning instead of same day.</li>
</ul><p><a href="/shop">Back to the shop</a></p></body></html>`;

const RETURNS = `<!doctype html><html><head><meta charset="utf-8"><title>Returns - Corner Market</title></head><body><h1>Returns policy</h1>
<p>Unopened pantry items can be returned within 14 days for a full refund. Fresh and perishable items (bakery, produce, dairy) cannot be returned, but tell us within 24 hours if something arrives damaged and we will credit you.</p>
<p><a href="/shop">Back to the shop</a></p></body></html>`;

async function serveShop(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      shop.events.push({
        ...(body ? { body: body.slice(0, 300) } : {}),
        method: request.method ?? "GET",
        path: url.pathname + url.search,
        t: Date.now(),
      });
      const html = (text: string) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(text);
      };
      if (url.pathname === "/shop") {
        html(
          shopPage(
            Number(url.searchParams.get("page") ?? "1") || 1,
            url.searchParams.get("zip"),
          ),
        );
      } else if (url.pathname === "/shop/reviews") {
        html(REVIEWS);
      } else if (url.pathname === "/shop/returns") {
        html(RETURNS);
      } else if (url.pathname === "/api/cart") {
        if (request.method === "POST" && body) {
          shop.cart.push(body);
        }
        html(cartHtml());
      } else if (url.pathname === "/api/order") {
        shop.orders.push(body);
        response.writeHead(200);
        response.end("{}");
      } else {
        response.writeHead(request.method === "POST" ? 204 : 404);
        response.end();
      }
    });
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

const site = await serveShop();

const SHOP = `${site}/shop`;

const viewing: SessionMessageDataPart.ViewContextDataPart = {
  page: {
    tab: SHOP_TAB,
    tabs: [{ id: SHOP_TAB, title: "Corner Market", url: SHOP }],
    title: "Corner Market",
    url: SHOP,
  },
  screen: "browser",
  url: SHOP,
};

/** The shop tab's page as the run left it, the cart and the shop's log, into the records. */
async function recordOutcome({
  chatId,
}: {
  chatId: Parameters<typeof chatDir>[0];
}) {
  const chrome = getSharedChrome();
  const page = chrome
    ? await chrome
        .evaluate(
          SHOP_TAB,
          `JSON.stringify({url: location.href, form: Object.fromEntries([...document.querySelectorAll('#checkout-form input, #checkout-form textarea')].map(e=>[e.name,e.value]))})`,
        )
        .catch((error: unknown) => JSON.stringify({ error: String(error) }))
    : undefined;
  fs.writeFileSync(
    path.join(chatDir(chatId), "tab-lock-outcome.json"),
    JSON.stringify(
      {
        cart: shop.cart,
        events: shop.events,
        orders: shop.orders,
        pages: chrome?.pages(),
        shopTab:
          typeof page === "string" ? (JSON.parse(page) as unknown) : page,
      },
      null,
      2,
    ),
  );
}

/**
 * Waits, at most `capMs`, until the shop has taken `count` adds to the cart:
 * the long job is under way in the tab, so a follow-up lands while it works.
 */
function cartAddsReached(count: number, capMs = 45_000) {
  return async () => {
    const started = Date.now();
    while (Date.now() - started < capMs) {
      if (shop.cart.length >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
}

const DETAILS =
  "Sam Rivera, 12 Elm St, Springfield, ZIP 01105, phone 555-0142, notes: leave it at the door";
/** What each checkout field holds once DETAILS are in, lowercased, by the field's name. */
const FILLED: Record<string, string> = {
  city: "springfield",
  name: "sam rivera",
  notes: "leave it at the door",
  phone: "555-0142",
  street: "12 elm st",
  zip: "01105",
};
const UNDER_THREE = PRODUCTS.filter((p) => p.price < 3).map((p) => p.sku);

interface Outcome {
  cart: string[];
  orders: unknown[];
  shopTab?: { error?: string; form?: Record<string, string>; url?: string };
}

/** What the teardown recorded, from the records, so a rescore reads the same thing. */
function outcomeOf(chatId: Parameters<typeof chatDir>[0]): Outcome | undefined {
  const file = path.join(chatDir(chatId), "tab-lock-outcome.json");
  // The teardown's own JSON.
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Outcome)
    : undefined;
}

function formFilled(outcome: Outcome | undefined): boolean {
  const form = outcome?.shopTab?.form ?? {};
  return Object.entries(FILLED).every(([field, value]) =>
    (form[field] ?? "").toLowerCase().includes(value),
  );
}

function formEmpty(outcome: Outcome | undefined): boolean {
  const form = outcome?.shopTab?.form;
  return form !== undefined && Object.values(form).every((value) => !value);
}

function formEvidence(outcome: Outcome | undefined): string {
  return outcome
    ? JSON.stringify(outcome.shopTab ?? {})
    : "no tab-lock-outcome.json";
}

/** The chat's last reply, as the user reads it once the run is quiet. */
function lastReply(sessions: Session.WithMessagesAndParts[]): string {
  const replies = sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .map((message) =>
      message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n"),
    )
    .filter((text) => text.trim() !== "");
  return replies.at(-1) ?? "";
}

/** A sentence saying the checkout form is filled, without saying it is not. */
const CLAIMS_FILLED =
  /[^.\n]*\bform\b[^.\n]*\b(?:filled|completed|entered)\b[^.\n]*/gi;
const DENIED = /\b(?:not|isn't|wasn't|no longer|empty|emptied|cleared|lost)\b/i;

const formIsFilled: Assertion = {
  check: ({ chatId }) => {
    const outcome = outcomeOf(chatId);
    return {
      evidence: formEvidence(outcome),
      passed: formFilled(outcome),
      text: "The shop tab's checkout form still holds the user's details",
    };
  },
  text: "The shop tab's checkout form still holds the user's details",
};

const formUntouched: Assertion = {
  check: ({ chatId }) => {
    const outcome = outcomeOf(chatId);
    return {
      evidence: formEvidence(outcome),
      passed: formEmpty(outcome),
      text: "The checkout form nobody was asked to fill is still empty",
    };
  },
  text: "The checkout form nobody was asked to fill is still empty",
};

const noOrder: Assertion = {
  check: ({ chatId }) => {
    const orders = outcomeOf(chatId)?.orders;
    return {
      evidence: JSON.stringify(orders ?? "no tab-lock-outcome.json"),
      passed: orders !== undefined && orders.length === 0,
      text: "No order was placed",
    };
  },
  text: "No order was placed",
};

const cartIsUnderThree: Assertion = {
  check: ({ chatId }) => {
    const cart = outcomeOf(chatId)?.cart ?? [];
    const sorted = [...cart].sort();
    return {
      evidence: `cart: ${sorted.join(", ") || "empty"}`,
      passed: sorted.join() === [...UNDER_THREE].sort().join(),
      text: "The cart holds every item under $3 once, and nothing else",
    };
  },
  text: "The cart holds every item under $3 once, and nothing else",
};

const toldTheTruthAboutTheForm: Assertion = {
  check: ({ chatId, sessions }) => {
    const reply = lastReply(sessions);
    const claims = [...reply.matchAll(CLAIMS_FILLED)]
      .map((match) => match[0])
      .filter((sentence) => !DENIED.test(sentence));
    const filled = formFilled(outcomeOf(chatId));
    return {
      evidence: `form filled: ${String(filled)}; claims: ${claims.join(" | ") || "none"}`,
      passed: filled || claims.length === 0,
      text: "The last reply does not say the form is filled when it is not",
    };
  },
  text: "The last reply does not say the form is filled when it is not",
};

function replied(pattern: RegExp, text: string): Assertion {
  return {
    check: ({ sessions }) => {
      const said = sessions
        .flatMap((session) => session.messages)
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        )
        .join("\n");
      return {
        evidence: said.match(pattern)?.[0] ?? (said.slice(-400) || "no reply"),
        passed: pattern.test(said),
        text,
      };
    },
    text,
  };
}

const answeredReturns = replied(/14 days/i, "Answered the returns policy");
const answeredDelivery = replied(
  /\$6\.49/,
  "Answered the delivery cost to 94110",
);

const LONG_JOB =
  "Go through all four pages of this catalog and add every item that costs under $3 to my cart.";
/** The same job, with the user asking for it in the background, as people who know tasks do. */
const LONG_JOB_IN_BACKGROUND = `Start a task for this, I might ask you other things meanwhile: ${LONG_JOB.charAt(0).toLowerCase()}${LONG_JOB.slice(1)}`;
const RETURNS_FOLLOW_UP =
  "Oh, and what's their returns policy? There's a link at the bottom of the page.";

export const TAB_LOCK_EVALS = [
  defineEval({
    assertions: [
      formIsFilled,
      toldTheTruthAboutTheForm,
      noOrder,
      cartIsUnderThree,
    ],
    kind: "chat",
    name: "tab-lock-two-tasks",
    prompt: `I need two things done here, and both take a while, so run them side by side as two tasks: go through all four pages of the catalog and add every item under $3 to my cart, and fill in the checkout form on this page with my details (${DETAILS}). Don't place the order.`,
    sharedBrowser: true,
    teardown: recordOutcome,
    viewing,
  }),
  defineEval({
    assertions: [answeredReturns, formUntouched, noOrder, cartIsUnderThree],
    beforeFollowUp: cartAddsReached(4),
    followUps: [RETURNS_FOLLOW_UP],
    kind: "chat",
    name: "tab-lock-follow-up",
    prompt: LONG_JOB_IN_BACKGROUND,
    sharedBrowser: true,
    teardown: recordOutcome,
    viewing,
  }),
  defineEval({
    assertions: [answeredDelivery, formUntouched, noOrder, cartIsUnderThree],
    beforeFollowUp: cartAddsReached(4),
    followUps: [
      "While that's going, can you quickly check what delivery to ZIP 94110 costs? There's a checker at the top of this page.",
    ],
    kind: "chat",
    name: "tab-lock-quick-check",
    prompt: LONG_JOB_IN_BACKGROUND,
    sharedBrowser: true,
    teardown: recordOutcome,
    viewing,
  }),
];
