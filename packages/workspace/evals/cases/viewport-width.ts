/**
 * Whether a narrow page costs the agent: the same browsing errands run with
 * every tab at Chrome's 1280 by 900 window (a tab nobody is looking at) and
 * with every tab pinned to the size of one side of a split on a laptop
 * (`INSTRUMENT_EVAL_VIEWPORT`, `lib/shared-chrome.ts`), where the page lays
 * out at the slot's width and the agent's `set viewport` waits.
 *
 * The local sites lay out the way common sites do at the usual 768 and 1024
 * breakpoints: a nav behind a menu button, a comparison table shown one plan
 * at a time, facets behind a Filters button, table columns hidden behind row
 * toggles, a sheet app that asks for a bigger screen, an app banner over a
 * booking form, and an article's infobox and sections folded away. The live
 * cases are sites whose answers have stayed put, scored by their text.
 *
 * Each case's prompt says to use the browser, since a fetch from the shell
 * sees no layout at all; `browsedOnly` notes a run that went around it.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

// ---------------------------------------------------------------------------
// Shared helpers

function replyText(sessions: Session.WithMessagesAndParts[]): string {
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

function bashCommands(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

/** Every session of the run: the chat's own and its tasks'. */
async function allSessions(context: {
  childSessions: () => Promise<{ sessions: Session.WithMessagesAndParts[] }[]>;
  sessions: Session.WithMessagesAndParts[];
}): Promise<Session.WithMessagesAndParts[]> {
  const children = await context.childSessions();
  return [...context.sessions, ...children.flatMap((child) => child.sessions)];
}

/** A reply that says every one of `needles` (each a RegExp). */
function says(text: string, needles: RegExp[]): { missing: string[] } {
  return {
    missing: needles
      .filter((needle) => !needle.test(text))
      .map((needle) => needle.source),
  };
}

function answerAssertion(label: string, needles: RegExp[]): Assertion {
  return {
    check: async (context) => {
      const sessions = await allSessions(context);
      const text = replyText(context.sessions) || replyText(sessions);
      const { missing } = says(text, needles);
      return {
        evidence:
          missing.length === 0
            ? text.slice(-400)
            : `missing ${missing.join(", ")}: ${text.slice(-400)}`,
        passed: missing.length === 0,
        text: label,
      };
    },
    text: label,
  };
}

/** A line of what the pinned viewport did (`noteViewport` in `lib/shared-chrome.ts`). */
const ViewportNoteSchema = z.object({
  applied: z.object({ height: z.number(), width: z.number() }).optional(),
  asked: z.object({ width: z.number().optional() }).optional(),
  method: z.string().optional(),
  refused: z.boolean().optional(),
});

/** Records how the run browsed, never failing: commands, and anything the pinned viewport refused or applied. */
const browsedOnly: Assertion = {
  check: async (context) => {
    const commands = bashCommands(await allSessions(context));
    const browser = commands.filter((command) =>
      /agent-browser\s/.test(command),
    );
    const fetches = commands.filter((command) =>
      /\b(?:curl|wget)\b|fetch\(/.test(command),
    );
    const viewportAsks = commands.filter((command) =>
      /agent-browser\s+set\s+(?:viewport|device)/.test(command),
    );
    let notes = "";
    try {
      notes = fs
        .readFileSync(path.join(os.homedir(), ".eval-viewport.jsonl"), "utf8")
        .trim();
    } catch {
      // Nothing was refused, applied or shifted.
    }
    const lines = notes.split("\n").filter(Boolean);
    const applied = lines.flatMap((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return [];
      }
      const note = ViewportNoteSchema.safeParse(parsed);
      return note.success && note.data.applied
        ? [
            `${note.data.method === "Emulation.clearDeviceMetricsOverride" ? "clear" : (note.data.asked?.width ?? "?")} -> ${note.data.applied.width}x${note.data.applied.height}`,
          ]
        : [];
    });
    return {
      evidence: JSON.stringify({
        browserCommands: browser.length,
        fetches: fetches.length,
        viewport: [
          process.env.INSTRUMENT_EVAL_VIEWPORT ?? "1280x900",
          ...(process.env.INSTRUMENT_EVAL_VIEWPORT_LAYOUT
            ? [`layout ${process.env.INSTRUMENT_EVAL_VIEWPORT_LAYOUT}`]
            : []),
          ...(process.env.INSTRUMENT_EVAL_VIEWPORT_AGENT === "1"
            ? ["agent"]
            : []),
        ].join(" "),
        viewportApplied: applied,
        viewportAsks: viewportAsks.map((command) => command.slice(0, 120)),
        viewportNotes: lines.length,
      }),
      passed: true,
      text: "How it browsed (recorded, not scored)",
    };
  },
  text: "How it browsed (recorded, not scored)",
};

/** A seeded random number generator, so every run sees the same sites. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1d2330}
a{color:#2453c4}
.container{max-width:1180px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid #e3e6ec;background:#fff}
header.top .bar{display:flex;align-items:center;gap:24px;height:60px}
.logo{font-weight:700;font-size:18px;text-decoration:none;color:#111}
button{font:inherit;cursor:pointer}
.btn{background:#2453c4;color:#fff;border:0;border-radius:6px;padding:9px 16px}
.btn.ghost{background:#fff;color:#2453c4;border:1px solid #c5cfe6}
footer{margin-top:60px;border-top:1px solid #e3e6ec;padding:24px 0;color:#5a6274;font-size:13px}
.only-narrow{display:none}
@media (max-width:767px){.only-wide{display:none!important}.only-narrow{display:block}}
`;

function page(title: string, body: string, css = "", script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${BASE_CSS}${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

// ---------------------------------------------------------------------------
// 1. A company site whose enterprise desk is in a nav dropdown, behind a
//    menu button below 768.

const ACME_CSS = `
nav.main{display:flex;gap:4px;flex:1}
nav.main>.item{position:relative}
nav.main>.item>a,nav.main>.item>button{display:block;padding:8px 12px;color:#1d2330;text-decoration:none;background:none;border:0}
nav.main .drop{display:none;position:absolute;top:100%;left:0;background:#fff;border:1px solid #e3e6ec;border-radius:8px;box-shadow:0 8px 24px #0002;min-width:220px;padding:6px;z-index:5}
nav.main .item:hover .drop,nav.main .item:focus-within .drop{display:block}
nav.main .drop a{display:block;padding:8px 10px;color:#1d2330;text-decoration:none;border-radius:6px}
.menu-btn{display:none;margin-left:auto;background:none;border:1px solid #d5d9e2;border-radius:6px;padding:6px 10px}
#drawer{display:none;position:fixed;inset:0 0 0 auto;width:86%;background:#fff;box-shadow:-8px 0 30px #0003;padding:16px;z-index:10;overflow:auto}
#drawer.open{display:block}
#drawer a{display:block;padding:12px 4px;border-bottom:1px solid #eef0f4;color:#1d2330;text-decoration:none}
#drawer .sub{display:none;padding-left:14px}
#drawer .sub.open{display:block}
#drawer button.acc{width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #eef0f4;padding:12px 4px}
.hero{padding:70px 0 40px}
.hero h1{font-size:40px;margin:0 0 12px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.card{border:1px solid #e3e6ec;border-radius:10px;padding:18px}
@media (max-width:767px){nav.main,.top .cta{display:none}.menu-btn{display:block}.cards{grid-template-columns:1fr}.hero h1{font-size:28px}}
`;

const ACME_NAV = (base: string) => `
<header class="top"><div class="container bar">
<a class="logo" href="${base}/">Acme Cloud</a>
<nav class="main" aria-label="Main">
  <div class="item"><button>Products</button><div class="drop"><a href="${base}/products/compute">Compute</a><a href="${base}/products/storage">Object storage</a><a href="${base}/products/db">Managed databases</a></div></div>
  <div class="item"><a href="${base}/pricing">Pricing</a></div>
  <div class="item"><button>Enterprise</button><div class="drop"><a href="${base}/enterprise">Overview</a><a href="${base}/enterprise/security">Security &amp; compliance</a><a href="${base}/company/enterprise-desk">Talk to enterprise sales</a></div></div>
  <div class="item"><a href="${base}/docs">Docs</a></div>
  <div class="item"><a href="${base}/support">Support</a></div>
</nav>
<a class="btn cta" href="${base}/signup">Start free</a>
<button class="menu-btn" aria-label="Open menu" onclick="document.getElementById('drawer').classList.add('open')">☰</button>
</div></header>
<div id="drawer" role="dialog" aria-label="Menu">
<button aria-label="Close menu" onclick="document.getElementById('drawer').classList.remove('open')" style="float:right;background:none;border:0;font-size:22px">×</button>
<div style="clear:both"></div>
<button class="acc" onclick="this.nextElementSibling.classList.toggle('open')">Products ▾</button>
<div class="sub"><a href="${base}/products/compute">Compute</a><a href="${base}/products/storage">Object storage</a><a href="${base}/products/db">Managed databases</a></div>
<a href="${base}/pricing">Pricing</a>
<button class="acc" onclick="this.nextElementSibling.classList.toggle('open')">Enterprise ▾</button>
<div class="sub"><a href="${base}/enterprise">Overview</a><a href="${base}/enterprise/security">Security &amp; compliance</a><a href="${base}/company/enterprise-desk">Talk to enterprise sales</a></div>
<a href="${base}/docs">Docs</a>
<a href="${base}/support">Support</a>
</div>`;

const ACME_FOOTER = (base: string) =>
  `<footer><div class="container">© 2026 Acme Cloud, Inc. · <a href="${base}/support">Support</a> · General support line: 1-800-555-0100 · <a href="${base}/legal">Legal</a></div></footer>`;

function acmePage(base: string, title: string, inner: string): string {
  return page(
    `${title} · Acme Cloud`,
    `${ACME_NAV(base)}<main class="container">${inner}</main>${ACME_FOOTER(base)}`,
    ACME_CSS,
  );
}

function acme(base: string, route: string): string | undefined {
  const filler = (topic: string) =>
    `<div class="cards">${["Fast", "Reliable", "Global"].map((word) => `<div class="card"><h3>${word} ${topic}</h3><p>${topic} built for teams that ship. Regions on four continents and a 99.95% uptime commitment.</p></div>`).join("")}</div>`;
  switch (route) {
    case "/": {
      return acmePage(
        base,
        "Home",
        `<section class="hero"><h1>The cloud for builders</h1><p>Compute, storage and databases with pricing you can read.</p><a class="btn" href="${base}/signup">Start free</a></section>${filler("infrastructure")}`,
      );
    }
    case "/company/enterprise-desk": {
      return acmePage(
        base,
        "Talk to enterprise sales",
        `<section class="hero"><h1>Talk to enterprise sales</h1><p>For teams of 200 or more, custom contracts, and private regions.</p></section><div class="cards"><div class="card"><h3>Call us</h3><p>Enterprise sales desk: <strong>+1 (415) 555-0199</strong><br>Weekdays 7am to 6pm Pacific.</p></div><div class="card"><h3>Email</h3><p>enterprise@acme-cloud.example</p></div><div class="card"><h3>Book a call</h3><p>Pick a time with a solutions engineer.</p></div></div>`,
      );
    }
    case "/support": {
      return acmePage(
        base,
        "Support",
        `<section class="hero"><h1>Support</h1><p>Our general support line is 1-800-555-0100, any time. Enterprise customers with a contract use the number in their onboarding packet.</p></section>${filler("support")}`,
      );
    }
    case "/enterprise": {
      return acmePage(
        base,
        "Enterprise",
        `<section class="hero"><h1>Acme for Enterprise</h1><p>Private regions, SSO, audit logs and a named account team.</p></section>${filler("enterprise")}`,
      );
    }
    case "/enterprise/security":
    case "/pricing":
    case "/docs":
    case "/products/compute":
    case "/products/storage":
    case "/products/db":
    case "/legal":
    case "/signup": {
      const name = route.split("/").pop() ?? "";
      return acmePage(
        base,
        name,
        `<section class="hero"><h1>${name.charAt(0).toUpperCase()}${name.slice(1)}</h1></section>${filler(name)}`,
      );
    }
    default: {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. A pricing page whose comparison table becomes one plan at a time.

const PLANS = ["Starter", "Team", "Business", "Enterprise"] as const;
const PRICES: Record<string, { annual: string; monthly: string }> = {
  Business: { annual: "$16", monthly: "$20" },
  Enterprise: { annual: "Custom", monthly: "Custom" },
  Starter: { annual: "$5", monthly: "$6" },
  Team: { annual: "$10", monthly: "$12" },
};
const FEATURES: [string, string[]][] = [
  ["Storage per user", ["30 GB", "1 TB", "3 TB", "Unlimited"]],
  ["File version history", ["30 days", "180 days", "1 year", "10 years"]],
  ["Google and Microsoft sign-in", ["✓", "✓", "✓", "✓"]],
  ["SAML single sign-on (SSO)", ["—", "—", "✓", "✓"]],
  ["Shared folders", ["✓", "✓", "✓", "✓"]],
  ["Admin console", ["—", "✓", "✓", "✓"]],
  ["Audit log", ["—", "—", "90 days", "Unlimited"]],
  ["Remote wipe", ["—", "✓", "✓", "✓"]],
  ["Data residency", ["—", "—", "—", "✓"]],
  ["Support", ["Email", "Email", "Priority", "24/7 phone"]],
  ["Uptime commitment", ["—", "99.9%", "99.95%", "99.99%"]],
  ["Minimum seats", ["1", "3", "5", "50"]],
];

function pricing(base: string): string {
  const cell = (plan: string) =>
    `<span class="p-annual">${PRICES[plan]?.annual ?? ""}</span><span class="p-monthly">${PRICES[plan]?.monthly ?? ""}</span>`;
  const table = `<table class="compare only-wide"><thead><tr><th>Compare plans</th>${PLANS.map((plan) => `<th>${plan}<div class="price">${cell(plan)}<small> per user / month</small></div></th>`).join("")}</tr></thead><tbody>${FEATURES.map(([name, values]) => `<tr><th scope="row">${name}</th>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const tabs = `<div class="only-narrow"><div class="seg" role="tablist">${PLANS.map((plan, index) => `<button role="tab" aria-selected="${String(index === 0)}" onclick="pick(${index})">${plan}</button>`).join("")}</div>${PLANS.map((plan, index) => `<section class="plan" data-plan="${index}" ${index === 0 ? "" : "hidden"}><h2>${plan}</h2><div class="price">${cell(plan)}<small> per user / month</small></div><ul>${FEATURES.map(([name, values]) => `<li><span>${name}</span><b>${values[index] ?? ""}</b></li>`).join("")}</ul></section>`).join("")}</div>`;
  return page(
    "Pricing · Driftbox",
    `<header class="top"><div class="container bar"><a class="logo" href="${base}/">Driftbox</a></div></header><main class="container"><h1>Plans for every team</h1><p>Prices are per user per month. <label><input type="checkbox" id="annual" onchange="document.body.classList.toggle('annual',this.checked)"> Bill annually (save up to 20%)</label></p>${table}${tabs}</main>`,
    `.compare{width:100%;border-collapse:collapse;margin-top:20px}.compare th,.compare td{border-bottom:1px solid #e3e6ec;padding:10px;text-align:left}.price{font-size:22px;font-weight:600}.price small{font-size:12px;font-weight:400}
.p-annual{display:none}body.annual .p-annual{display:inline}body.annual .p-monthly{display:none}
.seg{display:flex;border:1px solid #c5cfe6;border-radius:8px;overflow:hidden;margin:16px 0}.seg button{flex:1;border:0;background:#fff;padding:10px 4px}.seg button[aria-selected=true]{background:#2453c4;color:#fff}
.plan ul{list-style:none;padding:0}.plan li{display:flex;justify-content:space-between;border-bottom:1px solid #eef0f4;padding:10px 0}`,
    `function pick(i){document.querySelectorAll('.plan').forEach(function(s){s.hidden=s.dataset.plan!=String(i)});document.querySelectorAll('.seg button').forEach(function(b,j){b.setAttribute('aria-selected',String(j===i))})}`,
  );
}

// ---------------------------------------------------------------------------
// 3. A shop whose facets go behind a Filters button below 1024.

interface Machine {
  brand: string;
  grinder: boolean;
  name: string;
  price: number;
  rating: number;
  reviews: number;
  sku: string;
}

const BRANDS = ["Lumen", "Corvo", "Marlow", "Brevio", "Altura", "Pesca"];
const MODELS = [
  "Uno",
  "Duo",
  "Bar",
  "Studio",
  "Barista",
  "Compact",
  "Pro",
  "Classic",
  "Touch",
  "Mini",
];

const MACHINES: Machine[] = (() => {
  const random = seeded(42);
  const list: Machine[] = [];
  for (let index = 0; index < 60; index++) {
    const brand = BRANDS[index % BRANDS.length] ?? "Lumen";
    const model = MODELS[Math.floor(random() * MODELS.length)] ?? "Uno";
    list.push({
      brand,
      grinder: random() < 0.4,
      name: `${brand} ${model} ${100 + index * 7}`,
      price: 249 + Math.floor(random() * 90) * 10,
      rating: Math.round((3.6 + random() * 1.35) * 10) / 10,
      reviews: 12 + Math.floor(random() * 900),
      sku: `EM-${1000 + index}`,
    });
  }
  // Distractors around the answer: a cheaper grinder under 4.5, and a cheaper 4.8 without one.
  list[7] = { ...(list[7] as Machine), grinder: true, price: 299, rating: 4.4 };
  list[19] = {
    ...(list[19] as Machine),
    grinder: false,
    price: 279,
    rating: 4.8,
  };
  list[44] = {
    ...(list[44] as Machine),
    grinder: true,
    price: 389,
    rating: 4.6,
  };
  for (const machine of list) {
    if (
      machine.grinder &&
      machine.rating >= 4.5 &&
      machine.price <= 389 &&
      machine.sku !== "EM-1044"
    ) {
      machine.price = 389 + 40 + (Number(machine.sku.slice(3)) % 9) * 10;
    }
  }
  return list;
})();

const SHOP_ANSWER = (() => {
  const fit = MACHINES.filter(
    (machine) => machine.grinder && machine.rating >= 4.5,
  ).sort((a, b) => a.price - b.price);
  return fit[0] as Machine;
})();

let cart: string[] = [];

function shopList(base: string, query: URLSearchParams): string {
  const grinder = query.get("grinder") === "1";
  const minRating = Number(query.get("rating") ?? "0");
  const brand = query.getAll("brand");
  const sort = query.get("sort") ?? "featured";
  const pageNumber = Math.max(1, Number(query.get("page") ?? "1"));
  let list = MACHINES.filter(
    (machine) =>
      (!grinder || machine.grinder) &&
      machine.rating >= minRating &&
      (brand.length === 0 || brand.includes(machine.brand)),
  );
  if (sort === "price") {
    list = [...list].sort((a, b) => a.price - b.price);
  } else if (sort === "rating") {
    list = [...list].sort((a, b) => b.rating - a.rating);
  }
  const perPage = 12;
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const shown = list.slice((pageNumber - 1) * perPage, pageNumber * perPage);
  const count = (grinder ? 1 : 0) + (minRating ? 1 : 0) + brand.length;
  const facets = (id: string) => `
<form method="get" action="${base}/shop" id="${id}">
<input type="hidden" name="sort" value="${sort}">
<fieldset><legend>Features</legend><label><input type="checkbox" name="grinder" value="1" ${grinder ? "checked" : ""} ${id === "side" ? "onchange='this.form.submit()'" : ""}> Built-in grinder</label></fieldset>
<fieldset><legend>Customer rating</legend>${[4.5, 4, 0].map((value) => `<label><input type="radio" name="rating" value="${value}" ${minRating === value ? "checked" : ""} ${id === "side" ? "onchange='this.form.submit()'" : ""}> ${value ? `${value} stars &amp; up` : "Any rating"}</label>`).join("<br>")}</fieldset>
<fieldset><legend>Brand</legend>${BRANDS.map((name) => `<label><input type="checkbox" name="brand" value="${name}" ${brand.includes(name) ? "checked" : ""} ${id === "side" ? "onchange='this.form.submit()'" : ""}> ${name}</label>`).join("<br>")}</fieldset>
${id === "drawer-form" ? `<button class="btn" type="submit" style="width:100%;margin-top:12px">Show results</button>` : ""}
</form>`;
  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(overrides)) {
      next.set(key, value);
    }
    return `${base}/shop?${next.toString()}`;
  };
  return page(
    "Espresso machines · Crema & Co.",
    `<header class="top"><div class="container bar"><a class="logo" href="${base}/shop">Crema &amp; Co.</a><span style="margin-left:auto">Cart (${cart.length})</span></div></header>
<main class="container">
<h1>Espresso machines</h1>
<div class="toolbar"><button class="btn ghost filters-btn" onclick="document.getElementById('fdrawer').classList.add('open')">Filters${count ? ` (${count})` : ""}</button>
<span>${list.length} results</span>
<label>Sort by <select onchange="location.href=this.value">${[
      ["featured", "Featured"],
      ["price", "Price: low to high"],
      ["rating", "Customer rating"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${link({ page: "1", sort: value ?? "" })}" ${sort === value ? "selected" : ""}>${label ?? ""}</option>`,
      )
      .join("")}</select></label></div>
<div class="layout"><aside class="facets">${facets("side")}</aside>
<section><div class="grid">${shown
      .map(
        (machine) =>
          `<a class="product" href="${base}/shop/p/${machine.sku}"><div class="ph"></div><div class="name">${machine.name}</div><div class="rate">${"★".repeat(Math.round(machine.rating))} ${machine.rating.toFixed(1)} (${machine.reviews})</div><div class="price">$${machine.price}</div>${machine.grinder ? `<div class="tag">Built-in grinder</div>` : ""}</a>`,
      )
      .join(
        "",
      )}</div><nav class="pager">${Array.from({ length: pages }, (_, index) => (index + 1 === pageNumber ? `<b>${index + 1}</b>` : `<a href="${link({ page: String(index + 1) })}">${index + 1}</a>`)).join(" ")}</nav></section></div>
</main>
<div id="fdrawer"><div class="dh"><b>Filters</b><button aria-label="Close filters" onclick="document.getElementById('fdrawer').classList.remove('open')">×</button></div>${facets("drawer-form")}</div>`,
    `.toolbar{display:flex;gap:16px;align-items:center;margin:12px 0}.toolbar label{margin-left:auto}
.layout{display:grid;grid-template-columns:230px 1fr;gap:28px}
.facets fieldset{border:0;padding:0;margin:0 0 18px}.facets legend{font-weight:600;margin-bottom:6px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.product{display:block;border:1px solid #e3e6ec;border-radius:10px;padding:12px;color:inherit;text-decoration:none}
.product .ph{height:120px;background:#f1f3f7;border-radius:8px;margin-bottom:8px}.product .price{font-weight:700}.product .rate{color:#b07800;font-size:13px}.tag{font-size:12px;color:#2a7a3b}
.pager{margin:20px 0;display:flex;gap:10px}
.filters-btn{display:none}
#fdrawer{display:none;position:fixed;inset:0;background:#fff;z-index:20;padding:16px;overflow:auto}#fdrawer.open{display:block}#fdrawer fieldset{border:0;padding:0;margin:0 0 18px}#fdrawer legend{font-weight:600}.dh{display:flex;justify-content:space-between;margin-bottom:12px}.dh button{background:none;border:0;font-size:24px}
@media (max-width:1023px){.layout{grid-template-columns:1fr}.facets{display:none}.filters-btn{display:inline-block}.grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:767px){.toolbar{flex-wrap:wrap}.toolbar label{margin-left:0}}`,
  );
}

function shopProduct(base: string, sku: string): string | undefined {
  const machine = MACHINES.find((entry) => entry.sku === sku);
  if (!machine) {
    return undefined;
  }
  return page(
    `${machine.name} · Crema & Co.`,
    `<header class="top"><div class="container bar"><a class="logo" href="${base}/shop">Crema &amp; Co.</a><span style="margin-left:auto">Cart (${cart.length})</span></div></header>
<main class="container"><p><a href="${base}/shop">← All espresso machines</a></p><div class="pd"><div class="ph"></div><div><h1>${machine.name}</h1><p>${machine.rating.toFixed(1)} out of 5 · ${machine.reviews} reviews</p><p style="font-size:26px;font-weight:700">$${machine.price}</p><p>${machine.grinder ? "Built-in conical burr grinder with 30 settings." : "No built-in grinder; pairs with any burr grinder."}</p><button class="btn" id="add">Add to cart</button><p id="msg" role="status"></p></div></div></main>`,
    `.pd{display:grid;grid-template-columns:1fr 1fr;gap:30px}.pd .ph{height:360px;background:#f1f3f7;border-radius:12px}@media (max-width:767px){.pd{grid-template-columns:1fr}.pd .ph{height:220px}}`,
    `document.getElementById('add').onclick=async function(){await fetch('${base}/shop/cart',{method:'POST',body:JSON.stringify({sku:'${machine.sku}'})});document.getElementById('msg').textContent='Added to your cart.'}`,
  );
}

// ---------------------------------------------------------------------------
// 4. An orders table that hides columns and its filters below 1024.

const REGIONS = ["West", "East", "Central", "South"];
const STATUSES = ["Pending", "Shipped", "Delivered", "Pending", "Canceled"];
const REPS = ["D. Moreau", "K. Osei", "L. Brandt", "P. Vance"];
const ORDERS = (() => {
  const random = seeded(7);
  return Array.from({ length: 46 }, (_, index) => ({
    customer: `${["Harbor", "Fenwick", "Larch", "Quill", "Basalt", "Tamsin", "Orrin", "Vesper"][Math.floor(random() * 8)] ?? ""} ${["Supply", "Labs", "Foods", "Studio", "Partners", "Goods"][Math.floor(random() * 6)] ?? ""}`,
    date: `2026-10-${String(1 + Math.floor(random() * 30)).padStart(2, "0")}`,
    items: 1 + Math.floor(random() * 9),
    number: `SO-${48_210 + index * 3}`,
    region: REGIONS[Math.floor(random() * 4)] ?? "West",
    rep: REPS[Math.floor(random() * 4)] ?? "K. Osei",
    status: STATUSES[Math.floor(random() * 5)] ?? "Pending",
    total: (
      120 +
      Math.floor(random() * 4800) +
      Math.floor(random() * 100) / 100
    ).toFixed(2),
  }));
})();
const ORDERS_ANSWER = ORDERS.filter(
  (order) => order.region === "West" && order.status === "Pending",
);

function orders(): string {
  return page(
    "Orders · Ledgerly",
    `<header class="top"><div class="container bar"><a class="logo" href="#">Ledgerly</a><span>Orders</span></div></header>
<main class="container"><h1>Orders</h1>
<div class="tb"><input id="q" placeholder="Search orders" aria-label="Search orders"><span class="wide-filters"><label>Region <select id="region"><option value="">All regions</option>${REGIONS.map((region) => `<option>${region}</option>`).join("")}</select></label> <label>Status <select id="status"><option value="">All statuses</option>${["Pending", "Shipped", "Delivered", "Canceled"].map((status) => `<option>${status}</option>`).join("")}</select></label></span><button class="btn ghost narrow-filters" onclick="document.getElementById('fp').hidden=!document.getElementById('fp').hidden">Filters</button></div>
<div id="fp" hidden><label>Region <select id="region2"><option value="">All regions</option>${REGIONS.map((region) => `<option>${region}</option>`).join("")}</select></label><br><label>Status <select id="status2"><option value="">All statuses</option>${["Pending", "Shipped", "Delivered", "Canceled"].map((status) => `<option>${status}</option>`).join("")}</select></label></div>
<table><thead><tr><th></th><th>Order</th><th>Date</th><th>Customer</th><th class="c">Region</th><th class="c">Status</th><th class="c">Items</th><th>Total</th><th class="c">Rep</th></tr></thead><tbody id="rows"></tbody></table>
<div class="pg"><button class="btn ghost" id="prev">Previous</button> <span id="pinfo"></span> <button class="btn ghost" id="next">Next</button></div></main>`,
    `.tb{display:flex;gap:14px;align-items:center;margin:10px 0}.narrow-filters{display:none}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e9ecf2;white-space:nowrap}
.x{display:none;background:none;border:0}.detail td{background:#f7f8fb;white-space:normal}
.pg{margin:14px 0}
@media (max-width:1023px){.c{display:none}.wide-filters{display:none}.narrow-filters{display:inline-block}.x{display:inline}}`,
    `var ORDERS=${JSON.stringify(ORDERS)};var page=0,open={};
function val(a,b){return document.getElementById(a).value||document.getElementById(b).value}
function render(){var q=document.getElementById('q').value.toLowerCase(),r=val('region','region2'),s=val('status','status2');
var list=ORDERS.filter(function(o){return(!r||o.region===r)&&(!s||o.status===s)&&(!q||(o.number+o.customer).toLowerCase().indexOf(q)>=0)});
var pages=Math.max(1,Math.ceil(list.length/15));if(page>=pages)page=pages-1;var shown=list.slice(page*15,page*15+15);
document.getElementById('rows').innerHTML=shown.map(function(o){var row='<tr><td><button class="x" aria-label="Details for '+o.number+'" onclick="open[\\''+o.number+'\\']=!open[\\''+o.number+'\\'];render()">'+(open[o.number]?'▾':'▸')+'</button></td><td>'+o.number+'</td><td>'+o.date+'</td><td>'+o.customer+'</td><td class="c">'+o.region+'</td><td class="c">'+o.status+'</td><td class="c">'+o.items+'</td><td>$'+o.total+'</td><td class="c">'+o.rep+'</td></tr>';
if(open[o.number]&&matchMedia('(max-width:1023px)').matches)row+='<tr class="detail"><td></td><td colspan="4">Region: '+o.region+' · Status: '+o.status+' · Items: '+o.items+' · Rep: '+o.rep+'</td></tr>';return row}).join('');
document.getElementById('pinfo').textContent='Page '+(page+1)+' of '+pages+' · '+list.length+' orders'}
['q','region','status','region2','status2'].forEach(function(id){document.getElementById(id).addEventListener('input',function(){page=0;render()})});
document.getElementById('prev').onclick=function(){if(page>0)page--;render()};document.getElementById('next').onclick=function(){page++;render()};render();`,
  );
}

// ---------------------------------------------------------------------------
// 5. A sheet app that asks for a bigger screen below 1024.

const SHEET_ROWS = ["Salaries", "Marketing", "Travel", "Software", "Office"];
const SHEET_START: Record<string, number[]> = {
  Marketing: [9800, 11_200, 10_400, 13_100],
  Office: [2100, 2050, 2300, 2400],
  Salaries: [184_000, 184_000, 191_500, 191_500],
  Software: [6400, 6400, 6900, 7100],
  Travel: [4200, 3900, 6100, 2800],
};
let sheetSaves: { col: number; row: string; value: number }[] = [];

function sheet(base: string): string {
  return page(
    "Budget 2026 · Gridly",
    `<header class="top"><div class="container bar"><a class="logo" href="#">Gridly</a><span>Budget 2026</span><span id="saved" style="margin-left:auto;color:#5a6274" role="status">All changes saved</span></div></header>
<main><div class="scroll"><table class="grid"><thead><tr><th></th>${["Q1", "Q2", "Q3", "Q4", "Total"].map((head) => `<th>${head}</th>`).join("")}</tr></thead><tbody>${SHEET_ROWS.map((row) => `<tr><th>${row}</th>${[0, 1, 2, 3].map((col) => `<td><input aria-label="${row} Q${col + 1}" data-row="${row}" data-col="${col}" value="${SHEET_START[row]?.[col] ?? ""}"></td>`).join("")}<td class="tot" data-total="${row}"></td></tr>`).join("")}</tbody></table></div></main>
<div id="gate"><div class="box"><h2>Gridly works best on a bigger screen</h2><p>Editing needs a window at least 1024 pixels wide. You can open a read-only view, or continue with the full editor.</p><a class="btn" href="${base}/sheet/budget/view">Open read-only view</a> <button class="btn ghost" onclick="document.getElementById('gate').remove()">Continue anyway</button></div></div>`,
    `.scroll{overflow-x:auto;padding:16px}.grid{border-collapse:collapse;min-width:980px}.grid th,.grid td{border:1px solid #dfe3ea;padding:0;height:34px}.grid th{background:#f4f6f9;padding:0 10px;text-align:left}.grid input{border:0;width:150px;height:34px;padding:0 10px;font:inherit;text-align:right}.tot{padding:0 10px!important;text-align:right;font-weight:600;width:150px}
#gate{display:none;position:fixed;inset:0;background:#0007;z-index:30;align-items:center;justify-content:center}#gate .box{background:#fff;border-radius:12px;padding:24px;max-width:90%}
@media (max-width:1023px){#gate{display:flex}}`,
    `function totals(){document.querySelectorAll('[data-total]').forEach(function(td){var r=td.dataset.total,s=0;document.querySelectorAll('input[data-row="'+r+'"]').forEach(function(i){s+=Number(i.value.replace(/[^0-9.-]/g,''))||0});td.textContent=s.toLocaleString('en-US')})}
document.querySelectorAll('.grid input').forEach(function(i){i.addEventListener('change',async function(){document.getElementById('saved').textContent='Saving…';await fetch('${base}/sheet/save',{method:'POST',body:JSON.stringify({row:i.dataset.row,col:Number(i.dataset.col),value:Number(i.value.replace(/[^0-9.-]/g,''))})});totals();document.getElementById('saved').textContent='All changes saved'})});totals();`,
  );
}

function sheetView(): string {
  const current = structuredClone(SHEET_START);
  for (const save of sheetSaves) {
    const row = current[save.row];
    if (row) {
      row[save.col] = save.value;
    }
  }
  return page(
    "Budget 2026 (read-only) · Gridly",
    `<main class="container"><h1>Budget 2026</h1><p>Read-only view. Open the editor on a larger screen to make changes.</p><table>${SHEET_ROWS.map((row) => `<tr><th>${row}</th>${(current[row] ?? []).map((value) => `<td>${value.toLocaleString("en-US")}</td>`).join("")}<td><b>${(current[row] ?? []).reduce((a, b) => a + b, 0).toLocaleString("en-US")}</b></td></tr>`).join("")}</table></main>`,
    "td,th{padding:6px 10px;text-align:right}",
  );
}

// ---------------------------------------------------------------------------
// 6. A booking form under an app banner below 768, with its date picker in a sheet.

let bookings: Record<string, unknown>[] = [];

function booking(base: string): string {
  const days = (month: number, year: number) => {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = [
      ...Array.from({ length: first }, () => "<span></span>"),
      ...Array.from(
        { length: count },
        (_, index) =>
          `<button type="button" class="day" data-date="${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}" aria-label="${new Date(Date.UTC(year, month, index + 1)).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC", weekday: "long" })}">${index + 1}</button>`,
      ),
    ];
    return `<div class="month" data-month="${month}"><div class="mh">${new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC", year: "numeric" })}</div><div class="dow">${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<span>${day}</span>`).join("")}</div><div class="days">${cells.join("")}</div></div>`;
  };
  const calendar = `<div class="cal"><div class="nav"><button type="button" class="prevm" aria-label="Previous month">‹</button><button type="button" class="nextm" aria-label="Next month">›</button></div>${days(10, 2026)}${days(11, 2026)}${days(0, 2027)}</div>`;
  const times = [
    "5:00 PM",
    "5:30 PM",
    "6:00 PM",
    "6:30 PM",
    "7:00 PM",
    "7:30 PM",
    "8:00 PM",
    "8:30 PM",
    "9:00 PM",
  ];
  return page(
    "Reserve · Osteria Lume",
    `<header class="top"><div class="container bar"><a class="logo" href="#">Osteria Lume</a></div></header>
<main class="container"><h1>Reserve a table</h1>
<form id="f"><div class="row"><label>Party size <select name="party">${[1, 2, 3, 4, 5, 6, 7, 8].map((size) => `<option ${size === 2 ? "selected" : ""}>${size}</option>`).join("")}</select></label>
<label>Time <select name="time">${times.map((time) => `<option>${time}</option>`).join("")}</select></label></div>
<input type="hidden" name="date" id="date">
<div class="pick"><b>Date:</b> <span id="dateLabel">none chosen</span> <button type="button" class="btn ghost open-cal">Choose a date</button></div>
<div class="inline-cal">${calendar}</div>
<div class="row"><label>Name <input name="name" required></label><label>Phone <input name="phone" required></label></div>
<label>Notes <textarea name="notes" rows="2"></textarea></label>
<p><button class="btn" type="submit">Reserve</button></p><p id="done" role="status"></p></form></main>
<div id="sheet"><div class="sh"><b>Choose a date</b><button type="button" class="btn" id="sheetDone">Done</button></div><div class="sheet-cal"></div></div>
<div id="app"><b>Lume is better in the app</b><p>Reserve faster, earn a free dessert on your third visit.</p><a class="btn" href="#">Open in app</a> <button aria-label="Close" onclick="document.getElementById('app').remove()">×</button></div>
<div id="cookies">We use cookies to remember your preferences. <button class="btn" onclick="document.getElementById('cookies').remove()">Accept</button></div>`,
    `.row{display:flex;gap:16px;margin:12px 0}label{display:flex;flex-direction:column;gap:4px}input,select,textarea{font:inherit;padding:8px;border:1px solid #cfd5e0;border-radius:6px}
.cal{border:1px solid #e3e6ec;border-radius:10px;padding:12px;max-width:340px}.cal .nav{display:flex;justify-content:space-between}.month{display:none}.month.on{display:block}.mh{font-weight:600;text-align:center;margin-bottom:6px}.dow,.days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center;gap:2px}.day{border:0;background:#f4f6f9;border-radius:6px;padding:6px 0}.day.sel{background:#2453c4;color:#fff}
.pick .open-cal{display:none}
#sheet{display:none;position:fixed;inset:0;background:#fff;z-index:40;padding:16px}#sheet.open{display:block}.sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
#app{display:none;position:fixed;left:0;right:0;bottom:0;height:46vh;background:#fff;box-shadow:0 -10px 30px #0003;border-radius:16px 16px 0 0;padding:20px;z-index:35}#app button{position:absolute;top:10px;right:14px;background:none;border:0;font-size:24px}
#cookies{position:fixed;left:0;right:0;bottom:0;background:#1d2330;color:#fff;padding:12px 20px;z-index:30;display:flex;gap:12px;align-items:center;justify-content:space-between}
@media (max-width:767px){.inline-cal{display:none}.pick .open-cal{display:inline-block}#app{display:block}.row{flex-direction:column}#cookies{flex-direction:column;align-items:flex-start;padding-bottom:20px}}`,
    `var cal=document.querySelector('.cal'),months=cal.querySelectorAll('.month'),at=0;function show(){months.forEach(function(m,i){m.classList.toggle('on',i===at)})}show();
cal.querySelector('.prevm').onclick=function(){if(at>0)at--;show()};cal.querySelector('.nextm').onclick=function(){if(at<months.length-1)at++;show()};
cal.addEventListener('click',function(e){var d=e.target.closest('.day');if(!d)return;cal.querySelectorAll('.day').forEach(function(x){x.classList.remove('sel')});d.classList.add('sel');document.getElementById('date').value=d.dataset.date;document.getElementById('dateLabel').textContent=d.getAttribute('aria-label')});
var home=document.querySelector('.inline-cal'),sheetCal=document.querySelector('.sheet-cal');
document.querySelector('.open-cal').onclick=function(){sheetCal.appendChild(cal);document.getElementById('sheet').classList.add('open')};
document.getElementById('sheetDone').onclick=function(){home.appendChild(cal);document.getElementById('sheet').classList.remove('open')};
document.getElementById('f').onsubmit=async function(e){e.preventDefault();var data=Object.fromEntries(new FormData(e.target));if(!data.date){document.getElementById('done').textContent='Choose a date first.';return}var r=await fetch('${base}/book',{method:'POST',body:JSON.stringify(data)});document.getElementById('done').textContent=r.ok?'You are booked. A confirmation is on its way.':'Something went wrong.'};`,
  );
}

// ---------------------------------------------------------------------------
// 7. An article whose infobox and sections fold away below 768.

function article(): string {
  const facts = `<table class="ib"><caption>Harrow Point Lighthouse</caption><tr><th>Location</th><td>Harrow Point, Wenlock Sound</td></tr><tr><th>First lit</th><td>14 March 1867</td></tr><tr><th>Height</th><td>38 m (125 ft)</td></tr><tr><th>Focal height</th><td>52 m</td></tr><tr><th>Designer</th><td>Eleanor Pryce-Haddow</td></tr><tr><th>Construction</th><td>Granite, cast iron lantern</td></tr><tr><th>Automated</th><td>1991</td></tr><tr><th>Range</th><td>21 nmi</td></tr></table>`;
  const sections: [string, string][] = [
    [
      "History",
      "A light on the point was first proposed after the loss of the brig <i>Calder</i> in 1858. Work began in 1863 and the tower first exhibited a light in the spring of 1867, after two seasons lost to storms. The original tower stood 31 m; it was raised in 1902 when a larger lantern was fitted. The keepers' cottages were added in 1871.",
    ],
    [
      "Design",
      "The engineering partnership of Pryce &amp; Haddow drew the plans. The tower is a tapering granite cylinder with a gallery and a cast iron lantern room, painted white with a single red band.",
    ],
    [
      "Operation",
      "The station was automated in 1991 and the last keepers left that autumn. The light is monitored from the coastguard station at Wenlock.",
    ],
    [
      "Today",
      "The cottages house a small museum, open from April to October. The tower is open for guided climbs on weekends.",
    ],
  ];
  return page(
    "Harrow Point Lighthouse · Wikiharbor",
    `<header class="top"><div class="container bar"><a class="logo" href="#">Wikiharbor</a></div></header>
<main class="container art"><h1>Harrow Point Lighthouse</h1>
<div class="only-wide">${facts}</div>
<p><b>Harrow Point Lighthouse</b> is an active lighthouse on the northern tip of Harrow Point, guarding the entrance to Wenlock Sound. It is one of the oldest working lights on the coast.</p>
<details class="only-narrow qf"><summary>Quick facts</summary>${facts}</details>
${sections.map(([head, text]) => `<section class="only-wide"><h2>${head}</h2><p>${text}</p></section><details class="only-narrow sec"><summary>${head}</summary><p>${text}</p></details>`).join("")}
</main>`,
    `.art .ib{float:right;margin:0 0 16px 24px;border:1px solid #c8ccd4;background:#f8f9fa;font-size:13px;width:300px}.ib caption{font-weight:700;padding:6px}.ib th,.ib td{padding:4px 8px;text-align:left;vertical-align:top}
.qf .ib{float:none;margin:8px 0;width:100%}details.sec summary{font-size:20px;font-weight:600;padding:10px 0;border-bottom:1px solid #e3e6ec}`,
  );
}

// ---------------------------------------------------------------------------
// The server for every local site.

let site = "";

async function serveSites(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const html = (body: string | undefined) => {
      if (body === undefined) {
        response.writeHead(404, { "content-type": "text/html" });
        response.end("<h1>Not found</h1>");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    };
    const readBody = (then: (value: Record<string, unknown>) => void) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        try {
          // The page's own JSON, posted by the fixture's script.
          then(JSON.parse(body) as Record<string, unknown>);
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
        } catch {
          response.writeHead(400);
          response.end();
        }
      });
    };
    const { pathname } = url;
    if (pathname.startsWith("/acme")) {
      html(acme(`${site}/acme`, pathname.slice("/acme".length) || "/"));
      return;
    }
    if (pathname === "/driftbox/pricing") {
      html(pricing(`${site}/driftbox`));
      return;
    }
    if (pathname === "/shop/cart" && request.method === "POST") {
      readBody((value) => {
        cart.push(String(value.sku));
      });
      return;
    }
    if (pathname === "/shop") {
      html(shopList(site, url.searchParams));
      return;
    }
    if (pathname.startsWith("/shop/p/")) {
      html(shopProduct(site, pathname.slice("/shop/p/".length)));
      return;
    }
    if (pathname === "/admin/orders") {
      html(orders());
      return;
    }
    if (pathname === "/sheet/save" && request.method === "POST") {
      readBody((value) => {
        sheetSaves.push({
          col: Number(value.col),
          row: String(value.row),
          value: Number(value.value),
        });
      });
      return;
    }
    if (pathname === "/sheet/budget") {
      html(sheet(site));
      return;
    }
    if (pathname === "/sheet/budget/view") {
      html(sheetView());
      return;
    }
    if (pathname === "/book" && request.method === "POST") {
      readBody((value) => {
        bookings.push(value);
      });
      return;
    }
    if (pathname === "/book") {
      html(booking(site));
      return;
    }
    if (pathname === "/wiki/Harrow_Point_Lighthouse") {
      html(article());
      return;
    }
    html(undefined);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("The sites have no port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.unref();
  });
}

const setup = async () => {
  site ||= await serveSites();
  cart = [];
  sheetSaves = [];
  bookings = [];
};

// ---------------------------------------------------------------------------
// The cases

const cartRight: Assertion = {
  check: () => ({
    evidence: `cart ${JSON.stringify(cart)}; answer ${SHOP_ANSWER.sku} ${SHOP_ANSWER.name} $${SHOP_ANSWER.price}`,
    passed: cart.length >= 1 && cart.every((sku) => sku === SHOP_ANSWER.sku),
    text: "Only the cheapest 4.5-star machine with a grinder went in the cart",
  }),
  text: "Only the cheapest 4.5-star machine with a grinder went in the cart",
};

const sheetSaved: Assertion = {
  check: () => {
    const marketingQ3 = sheetSaves.filter(
      (save) => save.row === "Marketing" && save.col === 2,
    );
    const stray = sheetSaves.filter(
      (save) => !(save.row === "Marketing" && save.col === 2),
    );
    return {
      evidence: JSON.stringify(sheetSaves),
      passed: marketingQ3.at(-1)?.value === 12_500 && stray.length === 0,
      text: "Marketing Q3 was saved as 12500 and nothing else changed",
    };
  },
  text: "Marketing Q3 was saved as 12500 and nothing else changed",
};

const booked: Assertion = {
  check: () => {
    const last = bookings.at(-1) ?? {};
    const passed =
      bookings.length === 1 &&
      String(last.party) === "4" &&
      last.date === "2026-12-12" &&
      last.time === "7:30 PM" &&
      /jordan\s+lee/i.test(String(last.name)) &&
      /555.?0142/.test(String(last.phone));
    return {
      evidence: JSON.stringify(bookings),
      passed,
      text: "One booking: 4 people, Dec 12, 7:30 PM, Jordan Lee, 555-0142",
    };
  },
  text: "One booking: 4 people, Dec 12, 7:30 PM, Jordan Lee, 555-0142",
};

const ordersNeedles = ORDERS_ANSWER.map(
  (order) => new RegExp(order.number.replace("-", "-?")),
);

const ordersNoExtras: Assertion = {
  check: async (context) => {
    const text = replyText(context.sessions);
    const named = [...text.matchAll(/SO-?\d{5}/g)].map((match) =>
      match[0].replace(/^SO-?/, "SO-"),
    );
    const wrong = _unique(named).filter(
      (number) => !ORDERS_ANSWER.some((order) => order.number === number),
    );
    return {
      evidence: `named ${_unique(named).join(", ")}; wrong ${wrong.join(", ") || "none"}`,
      passed: wrong.length === 0,
      text: "Named no order outside West and Pending",
    };
  },
  text: "Named no order outside West and Pending",
};

function _unique(list: string[]): string[] {
  return [...new Set(list)];
}

const browse = (text: string) => `${text} Use the browser.`;

export const VIEWPORT_WIDTH_EVALS = [
  defineEval({
    assertions: [
      answerAssertion("Gave the enterprise sales number", [/555.?0199/]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-nav-menu",
    get prompt() {
      return browse(
        `What's the phone number for Acme Cloud's enterprise sales team? Their site is ${site}/acme/`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion("Named Business at $16 billed annually", [
        /Business/,
        /\$16\b/,
      ]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-pricing-compare",
    get prompt() {
      return browse(
        `On ${site}/driftbox/pricing, which is the cheapest plan that includes SAML single sign-on and at least 1 TB of storage per user? What does it cost per user per month if we pay annually?`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [cartRight, browsedOnly],
    kind: "chat",
    name: "viewport-shop-filters",
    get prompt() {
      return browse(
        `On ${site}/shop, find the cheapest espresso machine that has a built-in grinder and is rated 4.5 stars or higher, and add it to my cart.`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion(
        "Named every West-region order still pending",
        ordersNeedles,
      ),
      ordersNoExtras,
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-orders-table",
    get prompt() {
      return browse(
        `In our Ledgerly admin at ${site}/admin/orders, which orders from the West region are still pending? Give me their order numbers and totals.`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      sheetSaved,
      answerAssertion("Said the new Marketing total, 46,600", [/46,?600/]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-sheet-app",
    get prompt() {
      return browse(
        `In my Gridly budget sheet at ${site}/sheet/budget, change the Q3 Marketing number to 12500, then tell me the new full-year Marketing total.`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [booked, browsedOnly],
    kind: "chat",
    name: "viewport-booking-form",
    get prompt() {
      return browse(
        `Book a table at ${site}/book for 4 people on Saturday, December 12 at 7:30pm, under the name Jordan Lee, phone 555-0142.`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion("Gave first lit, height and designer from the infobox", [
        /14 March 1867|March 14,? 1867/,
        /38\s?m|125\s?ft/,
        /Pryce-Haddow/,
      ]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-article-facts",
    get prompt() {
      return browse(
        `From ${site}/wiki/Harrow_Point_Lighthouse: what exact date was the lighthouse first lit, how tall is the tower today, and who designed it?`,
      );
    },
    setup,
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion("Named the cheapest Poetry book and its price", [
        /Poems That Make Grown Women Cry/i,
        /14\.19/,
      ]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-live-books",
    prompt: browse(
      "On books.toscrape.com, what's the cheapest book in the Poetry category, and how much is it?",
    ),
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [answerAssertion("Said Firefox 121", [/\b121\b/]), browsedOnly],
    kind: "chat",
    name: "viewport-live-mdn-compat",
    prompt: browse(
      "On MDN's page for the CSS :has() pseudo-class, which Firefox version does the browser compatibility table say first supported it?",
    ),
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion("Gave Rainier's elevation and prominence in feet", [
        /14,?4(?:06|10)/,
        /13,?210/,
      ]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-live-wikipedia",
    prompt: browse(
      "On Wikipedia's article for Mount Rainier, what are its summit elevation and its topographic prominence, in feet, according to the infobox?",
    ),
    sharedBrowser: true,
  }),
  defineEval({
    assertions: [
      answerAssertion("Named ripgrep's licenses", [/Unlicense/i, /MIT/]),
      browsedOnly,
    ],
    kind: "chat",
    name: "viewport-live-github",
    prompt: browse(
      "On GitHub, open the repository for ripgrep (BurntSushi/ripgrep). What license does it show, and what's the latest release listed on the repo's main page?",
    ),
    sharedBrowser: true,
  }),
];
