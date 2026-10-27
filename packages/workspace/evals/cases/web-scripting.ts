/**
 * How the agent reads many web pages once a script can fetch them.
 *
 * `web_fetch` is one page per call, so a question across a catalog of pages
 * is a step with a call per page, or a `curl` loop in bash with the HTML to
 * pick apart. A script can call the same fetch as data
 * (`instrument.web.fetch(url)` in Node and Python) and read every page in one
 * command. Run with `--bash-only` for the arm with no script surface.
 *
 * The fan-out should get cheaper with a script. The second case has four
 * pages, where a call per page and a script both make sense: it scores that
 * the model takes one path and does not fetch a page both ways, or reach for
 * a script call that does not exist and fall back half way.
 *
 * The pages are served on loopback from a fixed list, so the answers are
 * computed from the same data the pages show.
 */
import http from "node:http";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";
import { bashCommands, toolInputs } from "./app-scripting";

interface Product {
  freeShipping: boolean;
  name: string;
  price: number;
}

const PRODUCTS: Product[] = [
  { freeShipping: false, name: "Walnut desk organizer", price: 48 },
  { freeShipping: true, name: "Linen cable sleeve", price: 19 },
  { freeShipping: false, name: "Brass monitor riser", price: 129 },
  { freeShipping: true, name: "Cork mouse pad", price: 24 },
  { freeShipping: false, name: "Felt drawer liner", price: 31 },
  { freeShipping: false, name: "Oak headphone stand", price: 57 },
  { freeShipping: true, name: "Steel pen cup", price: 15 },
  { freeShipping: false, name: "Leather desk mat", price: 89 },
  { freeShipping: false, name: "Bamboo laptop stand", price: 64 },
  { freeShipping: true, name: "Copper cable clips", price: 12 },
  { freeShipping: false, name: "Maple keyboard tray", price: 112 },
  { freeShipping: false, name: "Wool coaster set", price: 22 },
  { freeShipping: true, name: "Ash book end pair", price: 38 },
  { freeShipping: false, name: "Glass whiteboard tile", price: 74 },
  { freeShipping: false, name: "Canvas tool roll", price: 27 },
];

interface Release {
  date: string;
  fixes: string[];
  version: string;
}

const RELEASES: Release[] = [
  {
    date: "2026-08-04",
    fixes: [
      "The sidebar no longer flickers when a folder is renamed.",
      "Search results keep their order after a refresh.",
    ],
    version: "4.2.0",
  },
  {
    date: "2026-08-21",
    fixes: [
      "Printing a long table no longer cuts its last row.",
      "Dark mode keeps the toolbar icons visible.",
    ],
    version: "4.2.1",
  },
  {
    date: "2026-09-09",
    fixes: [
      "Exporting to CSV keeps every row, including the last one.",
      "The share sheet opens on the first tap.",
    ],
    version: "4.3.0",
  },
  {
    date: "2026-09-30",
    fixes: [
      "Notifications arrive once rather than twice.",
      "Import from a spreadsheet keeps leading zeros.",
    ],
    version: "4.3.1",
  },
];

/**
 * How a page says whether a product ships free, in a few wordings each way:
 * a store's pages say it in prose, and every page offers free returns, so
 * matching the word "free" is not how to tell.
 */
const SHIPPING: [free: string, paid: string][] = [
  [
    "Shipping is on us anywhere in the US.",
    "Shipping is added at checkout, by weight.",
  ],
  ["We cover the shipping on this one.", "Delivery is charged at checkout."],
  ["No shipping charge in the US.", "Shipping costs depend on where it goes."],
];

/** The weight of a real store page around its few lines: styles, state, a site-wide menu. */
const STYLES = Array.from(
  { length: 300 },
  (_, index) =>
    `.c${index}{margin:${index % 7}px;padding:${index % 5}px;color:#${(index * 2654435).toString(16).slice(0, 6).padEnd(6, "0")}}`,
).join("");
const STATE = JSON.stringify({
  experiments: Array.from({ length: 120 }, (_, index) => ({
    bucket: index % 4,
    id: `exp-${index}`,
    variant: `v${index % 3}`,
  })),
  session: { currency: "USD", locale: "en-US", region: "us-west" },
});
const NAV = Array.from(
  { length: 80 },
  (_, index) => `<a href="/c/${index}">Department ${index + 1}</a>`,
).join(" ");
const FOOTER = `Northwind Supply, since 1998. ${Array.from(
  { length: 40 },
  (_, index) => `<a href="/help/${index}">Help topic ${index + 1}</a>`,
).join(" ")}`;

/** What the site serves, by path, as HTML a fetch converts to Markdown. */
function page(path: string): string | undefined {
  const shell = (title: string, body: string) =>
    `<!doctype html><html><head><title>${title}</title><style>${STYLES}</style><script>window.__STATE__ = ${STATE};</script></head><body><nav>${NAV}</nav><main>${body}</main><footer>${FOOTER}</footer></body></html>`;
  if (path === "/catalog") {
    return shell(
      "Catalog",
      `<h1>Catalog</h1><ul>${PRODUCTS.map((product, index) => `<li><a href="/products/${index + 1}">${product.name}</a></li>`).join("")}</ul>`,
    );
  }
  const product = /^\/products\/(\d+)$/.exec(path)?.[1];
  const found =
    product === undefined ? undefined : PRODUCTS[Number(product) - 1];
  if (found) {
    return shell(
      found.name,
      `<div class="crumbs"><a href="/">Home</a> / <a href="/catalog">Desk</a></div><article><h1>${found.name}</h1><div class="buy"><span class="label">Our price</span> <span class="amount">$${found.price}.00</span></div><p>${SHIPPING[Number(product) % SHIPPING.length]?.[found.freeShipping ? 0 : 1] ?? ""}</p><p>Handmade in small batches from materials we source ourselves. Free returns within 30 days, and a two-year warranty on every piece.</p></article><aside><h2>Customers also bought</h2><ul>${PRODUCTS.slice(
        0,
        6,
      )
        .map((other) => `<li>${other.name}</li>`)
        .join("")}</ul></aside>`,
    );
  }
  const release = /^\/releases\/(\d+\.\d+\.\d+)$/.exec(path)?.[1];
  const notes = RELEASES.find(({ version }) => version === release);
  if (notes) {
    return shell(
      `Version ${notes.version}`,
      `<h1>Version ${notes.version}</h1><p>Released ${notes.date}.</p><h2>Fixed</h2><ul>${notes.fixes.map((fix) => `<li>${fix}</li>`).join("")}</ul>`,
    );
  }
  return undefined;
}

/**
 * The site on loopback, one per case, shared by the case's trials, which a
 * run starts together: up from the first trial's setup to the last one's
 * teardown.
 */
function site() {
  let server: http.Server | undefined;
  let ready: Promise<string> | undefined;
  let base = "";
  let using = 0;
  const start = async () => {
    const started = http.createServer((req, res) => {
      const html = page(new URL(req.url ?? "/", "http://site").pathname);
      if (html === undefined) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });
    const address = started.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP address");
    }
    return `http://127.0.0.1:${address.port}`;
  };
  return {
    get base() {
      return base;
    },
    async serve() {
      using++;
      ready ??= start();
      base = await ready;
    },
    stop() {
      using--;
      if (using === 0) {
        server?.close();
        server = undefined;
        ready = undefined;
      }
    },
  };
}

const CATALOG = site();
const RELEASE_NOTES = site();

function replyText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/** Every `web_fetch` tool call's URL. */
function toolFetches(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-web_fetch" && typeof part.input?.url === "string"
          ? [part.input.url]
          : [],
      ),
    ),
  );
}

/** A script calling the web or image capabilities, matched in JSON-quoted tool input. */
const SCRIPT_WEB_CALL = /\binstrument\.(?:web|images)\.\w+/;

/** Tool inputs (a bash heredoc, a script file written) that call `instrument.web.*`. */
function scriptedWebCalls(sessions: Session.WithMessagesAndParts[]): {
  inputs: string[];
  node: number;
  python: number;
} {
  const inputs = toolInputs(sessions).filter((input) =>
    SCRIPT_WEB_CALL.test(input),
  );
  const python = inputs.filter((input) =>
    /\bimport instrument\b|\.py\b|(?:^|[\s;&|("])python3?\b/.test(input),
  ).length;
  return { inputs, node: inputs.length - python, python };
}

/** What every tool call printed, as text. */
function outputsText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type.startsWith("tool-") && "output" in part
        ? [JSON.stringify(part.output)]
        : [],
    )
    .join("\n");
}

/** A script fetching with its runtime's own client: Python's urllib, requests or httpx, Node's fetch. */
const OWN_HTTP_CLIENT =
  /\burllib\b|\bimport requests\b|\brequests\.get\b|\bhttpx\b|(?<![.\w])fetch\(/;

const LOOPBACK_CURL = /\bcurl\b[^|;]{0,200}127\.0\.0\.1/;

/**
 * A script reaching for `instrument` in a way it does not answer: a name
 * the shell has no capability for, a namespace Python does not have, the
 * program from a subprocess, or a call shaped wrong.
 */
const SCRIPT_MISFIRE =
  /there is no capability|instrument has no |is not a function|InstrumentError|instrument\.Error|takes [\w, ]*one object|Instrument's commands run in its shell|unknown command \\"(?:web|images)\\"/g;

/**
 * Always passes: the evidence line is how the pages were read, which is
 * what comparing runs reads.
 */
const mechanism: Assertion = {
  check: ({ sessions }) => {
    const commands = bashCommands(sessions);
    const scripted = scriptedWebCalls(sessions);
    const curl = commands.filter((command) =>
      LOOPBACK_CURL.test(command),
    ).length;
    const misfires = outputsText(sessions).match(SCRIPT_MISFIRE)?.length ?? 0;
    const ownFetch = toolInputs(sessions).filter(
      (input) => !SCRIPT_WEB_CALL.test(input) && OWN_HTTP_CLIENT.test(input),
    ).length;
    return {
      evidence: `web_fetch calls ${toolFetches(sessions).length}, bash ${commands.length}, scripts calling instrument.web ${scripted.node + scripted.python} (node ${scripted.node}, python ${scripted.python}), scripts with their own HTTP client ${ownFetch}, curl to the site ${curl}, script misfires ${misfires}`,
      passed: true,
      text: "records the mechanism",
    };
  },
  text: "records the mechanism",
};

function answers(
  text: string,
  check: (reply: string) => { missing: string[]; wrong: string[] },
): Assertion {
  return {
    check: ({ sessions }) => {
      const reply = replyText(sessions);
      const { missing, wrong } = check(reply);
      return {
        evidence:
          missing.length === 0 && wrong.length === 0
            ? "all there"
            : `missing: ${missing.join(", ") || "none"}; wrong: ${wrong.join(", ") || "none"}; reply: ${reply.slice(-400)}`,
        passed: missing.length === 0 && wrong.length === 0,
        text,
      };
    },
    text,
  };
}

const cheapest = PRODUCTS.toSorted((a, b) => a.price - b.price).slice(0, 3);
const shipsFree = PRODUCTS.filter((product) => product.freeShipping);
const fixedExport = RELEASES.find((release) =>
  release.fixes.some((fix) => fix.includes("CSV")),
);

/** Says the dollar amount next to the name, either way round, on one line. */
function pricedOnALine(reply: string, product: Product): boolean {
  return reply
    .split("\n")
    .some(
      (line) =>
        line.toLowerCase().includes(product.name.toLowerCase()) &&
        new RegExp(String.raw`\$\s?${product.price}\b`).test(line),
    );
}

const NAMES_THE_CHEAPEST = answers(
  "names the three cheapest products with their prices",
  (reply) => ({
    missing: cheapest
      .filter((product) => !pricedOnALine(reply, product))
      .map((product) => `${product.name} $${product.price}`),
    wrong: [],
  }),
);

const LISTS_FREE_SHIPPING = answers(
  "lists exactly the products that ship free",
  (reply) => {
    const lower = reply.toLowerCase();
    return {
      missing: shipsFree
        .filter((product) => !lower.includes(product.name.toLowerCase()))
        .map((product) => product.name),
      // A product named as shipping free that does not. Only checked on
      // lines about shipping, since the cheapest list names others too.
      wrong: PRODUCTS.filter(
        (product) =>
          !product.freeShipping &&
          reply
            .split("\n")
            .some(
              (line) =>
                /free/i.test(line) &&
                !/not|paid|calculated|charge/i.test(line) &&
                line.toLowerCase().includes(product.name.toLowerCase()),
            ),
      ).map((product) => product.name),
    };
  },
);

const NAMES_THE_RELEASE = answers(
  "names the release that fixed the CSV export, with its date",
  (reply) => ({
    missing: [
      ...(fixedExport && reply.includes(fixedExport.version)
        ? []
        : [fixedExport?.version ?? "version"]),
      ...(fixedExport &&
      (reply.includes(fixedExport.date) ||
        /September 9(?:th)?,? 2026|9 September 2026|Sept?\.? 9/i.test(reply))
        ? []
        : [fixedExport?.date ?? "date"]),
    ],
    wrong: [],
  }),
);

/**
 * The path is one the run kept to: no page fetched both by the tool and by
 * a script, and no script call that misfired and left the work to finish
 * another way. Using one for some pages and the other for the rest, each
 * page once, is coherent.
 */
const ONE_PATH: Assertion = {
  check: ({ sessions }) => {
    const byTool = new Set(toolFetches(sessions));
    const scripts = scriptedWebCalls(sessions).inputs.join("\n");
    const both = [...byTool].filter((url) => scripts.includes(url));
    const misfires = outputsText(sessions).match(SCRIPT_MISFIRE) ?? [];
    return {
      evidence: `fetched by the tool ${byTool.size}, by both ${both.length}${both.length > 0 ? ` (${both.join(", ")})` : ""}, script misfires ${misfires.length}${misfires.length > 0 ? ` (${[...new Set(misfires)].join("; ")})` : ""}`,
      passed: both.length === 0 && misfires.length === 0,
      text: "keeps to one way of fetching each page, with no misfired script",
    };
  },
  text: "keeps to one way of fetching each page, with no misfired script",
};

/** A script asked for runs without a misfired call to `instrument` along the way. */
const SCRIPT_RAN_CLEAN: Assertion = {
  check: ({ sessions }) => {
    const misfires = outputsText(sessions).match(SCRIPT_MISFIRE) ?? [];
    return {
      evidence:
        misfires.length === 0
          ? "no misfires"
          : [...new Set(misfires)].join("; "),
      passed: misfires.length === 0,
      text: "runs its script with no misfired call to instrument",
    };
  },
  text: "runs its script with no misfired call to instrument",
};

export const WEB_SCRIPTING_EVALS = [
  defineEval({
    assertions: [NAMES_THE_CHEAPEST, LISTS_FREE_SHIPPING, mechanism],
    name: "web-scripting-fans-out-over-pages",
    get prompt() {
      return `Our supplier's catalog is at ${CATALOG.base}/catalog, a page per product. Which three products are cheapest (with prices), and which ones ship free?`;
    },
    setup: () => CATALOG.serve(),
    teardown: () => {
      CATALOG.stop();
    },
  }),
  defineEval({
    assertions: [
      NAMES_THE_CHEAPEST,
      LISTS_FREE_SHIPPING,
      SCRIPT_RAN_CLEAN,
      mechanism,
    ],
    // Asked for a script, where Python has its own ways to fetch a page too.
    name: "web-scripting-python-script",
    get prompt() {
      return `Write a Python script that reads every product page in our supplier's catalog at ${CATALOG.base}/catalog and prints the three cheapest products with their prices and the ones that ship free. Run it and tell me what it found.`;
    },
    setup: () => CATALOG.serve(),
    teardown: () => {
      CATALOG.stop();
    },
  }),
  defineEval({
    assertions: [NAMES_THE_RELEASE, ONE_PATH, mechanism],
    name: "web-scripting-two-ways",
    get prompt() {
      return `Which of these releases fixed the bug where CSV export dropped the last row, and when did it come out?\n\n${RELEASES.map(({ version }) => `${RELEASE_NOTES.base}/releases/${version}`).join("\n")}`;
    },
    setup: () => RELEASE_NOTES.serve(),
    teardown: () => {
      RELEASE_NOTES.stop();
    },
  }),
];
