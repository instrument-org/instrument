/**
 * Does a task that reads its way through a shop's catalog leave the user a
 * tab group they can still use?
 *
 * Drawn from a real run in which a task opened a tab for every product page
 * it read once and closed none: twelve in two minutes. The shop here has
 * eight products, each price only on its own page, and a cart the server
 * keeps. The work needs the cart again at the end, so a tab kept for it is
 * fair; a tab per product read once is not.
 *
 * A run has no window, so the task browses in a Chrome of its own, and the
 * pages report on themselves: each product page and the cart pings the site
 * while it is up and says goodbye as it goes (a navigation in the same tab,
 * or a close). A page with no goodbye was still open when the task ended.
 */
import http from "node:http";

import { type Assertion, defineEval } from "../harness";

type Product = { id: string; name: string; ounces: number; price: number };

/** Eight sparkling waters; the cheapest per ounce are Brook and Ridge. */
const PRODUCTS: Product[] = [
  { id: "p1", name: "Alder Lime", ounces: 144, price: 6.49 },
  { id: "p2", name: "Brook Grapefruit", ounces: 288, price: 8.99 },
  { id: "p3", name: "Cedar Berry", ounces: 96, price: 4.79 },
  { id: "p4", name: "Dune Lemon", ounces: 144, price: 7.29 },
  { id: "p5", name: "Elm Peach", ounces: 192, price: 9.49 },
  { id: "p6", name: "Fern Cherry", ounces: 144, price: 6.99 },
  { id: "p7", name: "Grove Mango", ounces: 96, price: 3.99 },
  { id: "p8", name: "Ridge Orange", ounces: 240, price: 7.79 },
];
const CHEAPEST = ["Brook Grapefruit", "Ridge Orange"];

/** What the pages said of themselves, and what the cart holds, for this run's site. */
const site = {
  cart: [] as string[],
  /** Each page load by its own id: what it showed, and whether it said goodbye. */
  pages: new Map<string, { at: number; goneAt?: number; path: string }>(),
  url: "",
};

/**
 * The script every page runs: one id per load, a hello, and a goodbye as it
 * goes; and the shop's session cookie, without which the cart takes nothing,
 * so the cart is reached only through a browser, as a signed-in shop is.
 */
const REPORTER = `<script>
document.cookie = "shop=1; path=/";
const load = Math.random().toString(36).slice(2);
fetch("/hello?load=" + load + "&path=" + encodeURIComponent(location.pathname));
addEventListener("pagehide", () => navigator.sendBeacon("/bye?load=" + load));
</script>`;

function page(title: string, body: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}${REPORTER}</body></html>`;
}

function catalogPage() {
  return page(
    "Sparkling water",
    `<h1>Sparkling water</h1><p>Prices on each product's page.</p><ul>${PRODUCTS.map(
      (product) =>
        `<li><a href="/product/${product.id}">${product.name}</a></li>`,
    ).join("")}</ul><p><a href="/cart">Cart</a></p>`,
  );
}

/** A price the page's script writes in, as a shop's does, so a fetch of the page alone has none. */
function renderedPrice(product: Product) {
  const encoded = Buffer.from(
    JSON.stringify([product.price, product.ounces]),
  ).toString("base64");
  return `<p id="price">Loading price…</p><script>setTimeout(() => { const [price, ounces] = JSON.parse(atob("${encoded}")); document.getElementById("price").textContent = "Price: $" + price.toFixed(2) + " for " + ounces + " fl oz total"; }, 300);</script>`;
}

function productPage(product: Product) {
  return page(
    product.name,
    `<h1>${product.name}</h1>${renderedPrice(product)}<button id="add" onclick="fetch('/add?id=${product.id}',{method:'POST'}).then(()=>{document.getElementById('status').textContent='Added to cart'})">Add to cart</button><p id="status" role="status"></p><p><a href="/cart">Cart</a></p>`,
  );
}

function cartPage() {
  const items = site.cart.flatMap((id) => {
    const product = PRODUCTS.find((each) => each.id === id);
    return product ? [product] : [];
  });
  const total = items.reduce((sum, product) => sum + product.price, 0);
  return page(
    "Cart",
    `<h1>Cart</h1><ul>${items.map((product) => `<li>${product.name}: $${product.price.toFixed(2)}</li>`).join("")}</ul><p>Total: $${total.toFixed(2)}</p>`,
  );
}

async function serveShop(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const send = (body: string) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(body);
    };
    if (url.pathname === "/hello") {
      site.pages.set(url.searchParams.get("load") ?? "", {
        at: Date.now(),
        path: url.searchParams.get("path") ?? "",
      });
      response.end();
      return;
    }
    if (url.pathname === "/bye") {
      const load = site.pages.get(url.searchParams.get("load") ?? "");
      if (load) {
        load.goneAt = Date.now();
      }
      response.end();
      return;
    }
    if (url.pathname === "/add") {
      const id = url.searchParams.get("id");
      const signedIn = (request.headers.cookie ?? "").includes("shop=1");
      if (!signedIn) {
        response.writeHead(401);
        response.end("Sign in to add to your cart.");
        return;
      }
      if (id && PRODUCTS.some((product) => product.id === id)) {
        site.cart.push(id);
      }
      response.end();
      return;
    }
    if (url.pathname === "/" || url.pathname === "/catalog") {
      send(catalogPage());
      return;
    }
    if (url.pathname === "/cart") {
      send(cartPage());
      return;
    }
    const product = PRODUCTS.find(
      (each) => url.pathname === `/product/${each.id}`,
    );
    if (product) {
      send(productPage(product));
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
    throw new Error("The shop has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

/** The most pages of the shop the task may leave open: the catalog or a product, and the cart. */
const OPEN_AT_END_MAX = 3;

const leftFewTabs: Assertion = {
  check: () => {
    const loads = [...site.pages.values()];
    const open = loads.filter((load) => load.goneAt === undefined);
    // The most pages up at one moment, which is how full the tab group got.
    const peak = Math.max(
      0,
      ...loads.map(
        (load) =>
          loads.filter(
            (other) =>
              other.at <= load.at &&
              (other.goneAt === undefined || other.goneAt > load.at),
          ).length,
      ),
    );
    return {
      evidence: `${loads.length} page loads; most open at once: ${peak}; open at the end: ${open.length} (${open.map((load) => load.path).join(", ") || "none"})`,
      passed: open.length <= OPEN_AT_END_MAX,
      text: `Left ${OPEN_AT_END_MAX} or fewer of the shop's pages open`,
    };
  },
  text: `Left ${OPEN_AT_END_MAX} or fewer of the shop's pages open`,
};

const cartHoldsTheCheapest: Assertion = {
  check: () => {
    const names = site.cart.map(
      (id) => PRODUCTS.find((product) => product.id === id)?.name ?? id,
    );
    return {
      evidence: names.join(", ") || "empty cart",
      passed:
        names.length === CHEAPEST.length &&
        CHEAPEST.every((name) => names.includes(name)),
      text: "Put one each of the two cheapest per ounce in the cart",
    };
  },
  text: "Put one each of the two cheapest per ounce in the cart",
};

const ASK = () =>
  `${site.url}/catalog lists eight sparkling waters. Find the two with the lowest price per fluid ounce, add one of each to the cart, and tell me the cart's total.`;

async function openShop() {
  site.cart = [];
  site.pages.clear();
  site.url = await serveShop();
}

export const TASK_TABS_CATALOG_EVALS = [
  defineEval({
    assertions: [cartHoldsTheCheapest, leftFewTabs],
    name: "task-tabs-catalog",
    get prompt() {
      return `Using the shop in the browser: ${ASK()}`;
    },
    setup: openShop,
  }),

  // The words a chat handed the task in the run this case is drawn from,
  // which read "a tab of your own" as `tab new` for every page.
  defineEval({
    assertions: [cartHoldsTheCheapest, leftFewTabs],
    name: "task-tabs-catalog-own-tabs",
    get prompt() {
      return `Using the shop in the browser, in your own tabs: ${ASK()}`;
    },
    setup: openShop,
  }),
];
