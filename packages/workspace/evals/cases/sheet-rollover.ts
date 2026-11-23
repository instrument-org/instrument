/**
 * One long browser job in one turn, at a real price step, for what the
 * context management costs it: a beta tester's chat on Haiku 5.5 spent 807
 * requests filling in a Google Sheet through agent-browser, rolled over about
 * once every seven requests, and after each rollover checked the live sheet
 * again for state its summary already had.
 *
 * The sheet here is a loopback page that works the way a spreadsheet does in
 * a browser: a grid showing forty rows at a time, a name box to go to a cell,
 * and a formula bar to edit it. An edit lands only through a real key press or
 * click (`isTrusted`), as a canvas sheet ignores events a script makes, so the
 * job takes browser steps. The rows live on the server, behind a cookie only
 * the browser's own navigation gets, as a web sheet's data is out of reach of
 * the shell: measured, a sheet written as a `file://` page had its source read
 * with `cat`, twice, and the job became one script. The teardown writes the
 * server's sheet into `sheet-rollover-outcome.json`.
 *
 * Needs `INSTRUMENT_PRICE_STEP_OVERRIDE=100000` on the Claude account, which
 * lists no price step: Haiku 5.5's real step is 100K tokens, where every rate
 * goes up five times. The override sets that step; it does not lower one.
 *
 * Scored on the sheet, and measured on the context (`lib/context-cycles.ts`):
 * rollovers and clearings, the room each cycle had, what the agent did first
 * after each rollover, and the tokens and estimated cost of the whole job.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { z } from "zod";

import { AIGatewayModelURI } from "@instrument-org/ai-gateway";

import { setChatProject } from "../../src/lib/chat/chats";
import { createProject } from "../../src/lib/chat/projects";
import { memoryDir, saveMemory } from "../../src/lib/memory/store";
import { chatDir } from "../../src/lib/record-folders";
import { type ChatId } from "../../src/schemas/chat-id";
import { type Session } from "../../src/schemas/session";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { type StoreId } from "../../src/schemas/store-id";
import { type Assertion, defineEval, type EvalCase } from "../harness";
import { seedChatHistory } from "../lib/seed-chat-history";
import {
  type ContextCycles,
  contextCycles,
  type SteppedPrice,
  spreadOf,
  type StepKind,
} from "../lib/context-cycles";
import { HOME } from "./handoff";

const SHEET_TAB = "tab_01M3AX9RF3C2E9RTATMB60SH01";
const DOCUMENTS = path.join(HOME, "Documents");
const COUNT_FILE = path.join(DOCUMENTS, "Warehouse count.csv");

/** Haiku 5.5's list price, dollars per million tokens, five times past 100K. */
const HAIKU_PRICE: SteppedPrice = {
  cacheRead: 0.01,
  cacheWrite: 0.125,
  input: 0.1,
  output: 0.5,
  step: 100_000,
  stepMultiplier: 5,
};

const HEADERS = [
  "SKU",
  "Product",
  "Category",
  "Warehouse",
  "Supplier",
  "Reorder level",
  "Units on hand",
  "Unit cost",
  "Last counted",
  "Bin",
  "Notes",
  "Status",
];
const UNITS = 6;
const COST = 7;
/**
 * Sized so the job rolls over: measured on Haiku 5.5, 150 rows and 40 SKUs
 * finished in 21 requests with the prompt peaking at 81K, and 450 rows and
 * 150 SKUs in 9 to 33 requests, the job adding 40K to 55K to the prompt and
 * rolling over once in four runs. A cycle has about 50K of room between the step and a fresh window.
 * Size alone moves nothing while the edits can be scripted (`signed`); with
 * them signed, 900 rows and 300 SKUs took 25 to 36 requests and rolled over
 * at most once, the edits batched into loops of browser commands, and 1,800
 * rows and 600 SKUs took 52 requests and rolled over once, the second cycle
 * peaking at 85K. 2,700 rows and 900 SKUs took 25 to 80 requests and rolled
 * over one to three times.
 */
const ROWS = 2_700;
/** SKUs the count lists: each needs both its units and its cost right. */
const TARGETS = 900;

/** A fixed sequence, so every run gets the same sheet. */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const CATEGORIES: Record<string, { nouns: string[]; prefix: string }> = {
  Electrical: {
    nouns: ["wire nuts", "outlet", "switch", "junction box", "conduit"],
    prefix: "EL",
  },
  Fasteners: {
    nouns: ["wood screws", "anchors", "hex bolts", "washers", "lag screws"],
    prefix: "FA",
  },
  Garden: {
    nouns: ["hose", "pruner", "rake", "sprinkler", "trowel"],
    prefix: "GA",
  },
  "Hand tools": {
    nouns: ["hammer", "tape measure", "level", "utility knife", "wrench set"],
    prefix: "HT",
  },
  Paint: {
    nouns: ["roller kit", "primer", "brush set", "drop cloth", "tray liner"],
    prefix: "PA",
  },
  Plumbing: {
    nouns: ["ball valve", "PEX elbow", "drain snake", "P-trap", "supply line"],
    prefix: "PL",
  },
  "Power tools": {
    nouns: ["drill", "impact driver", "jigsaw", "orbital sander", "grinder"],
    prefix: "PT",
  },
  Safety: {
    nouns: ["gloves", "goggles", "ear muffs", "respirator", "hard hat"],
    prefix: "SA",
  },
};
const ADJECTIVES = [
  "Pro",
  "Compact",
  "Heavy-duty",
  "Standard",
  "Contractor",
  "Lightweight",
];
const WAREHOUSES = ["Reno", "Columbus", "Dallas", "Allentown"];
const SUPPLIERS = [
  "Ridgeway Supply",
  "Atlas Industrial",
  "Northgate Tools",
  "Bayline Distributors",
  "Keystone Hardware",
];
const NOTES = [
  "",
  "",
  "",
  "Seasonal",
  "Check damaged cartons",
  "New packaging in Q1",
  "Vendor backorder",
  "",
];

interface Row {
  cells: string[];
}

/** The sheet as it starts, sorted by category and product as the team keeps it. */
function buildSheet(): {
  count: string;
  expected: Map<string, string[]>;
  rows: Row[];
} {
  const next = sequence(20_261_120);
  const pick = <T>(list: T[]): T =>
    list[Math.floor(next() * list.length)] ?? (list[0] as T);
  const used = new Set<string>();
  const rows: Row[] = [];
  const categories = Object.keys(CATEGORIES);
  for (let index = 0; index < ROWS; index++) {
    const category = categories[index % categories.length] ?? "Garden";
    const { nouns, prefix } = CATEGORIES[category] ?? { nouns: [], prefix: "" };
    let sku = "";
    do {
      sku = `${prefix}-${String(1000 + Math.floor(next() * 9000))}`;
    } while (used.has(sku));
    used.add(sku);
    const units = Math.floor(next() * 480) + 4;
    const cost = (Math.floor(next() * 9000) + 199) / 100;
    rows.push({
      cells: [
        sku,
        `${pick(ADJECTIVES)} ${pick(nouns)}`,
        category,
        pick(WAREHOUSES),
        pick(SUPPLIERS),
        String(Math.floor(next() * 60) + 10),
        String(units),
        cost.toFixed(2),
        `2026-0${String(Math.floor(next() * 9) + 1)}-${String(Math.floor(next() * 18) + 10)}`,
        `${String.fromCharCode(65 + Math.floor(next() * 8))}-${String(Math.floor(next() * 40) + 1).padStart(2, "0")}`,
        pick(NOTES),
        next() < 0.08 ? "Discontinued" : "Active",
      ],
    });
  }
  rows.sort(
    (a, b) =>
      (a.cells[2] ?? "").localeCompare(b.cells[2] ?? "") ||
      (a.cells[1] ?? "").localeCompare(b.cells[1] ?? "") ||
      (a.cells[0] ?? "").localeCompare(b.cells[0] ?? ""),
  );

  // The counted SKUs, spread over the whole sheet: most blank, some out of
  // date, a few already right.
  const targets = new Set<number>();
  while (targets.size < TARGETS) {
    targets.add(Math.floor(next() * ROWS));
  }
  const expected = new Map<string, string[]>();
  [...targets].forEach((rowIndex, order) => {
    const row = rows[rowIndex];
    if (!row) {
      return;
    }
    const units = String(Math.floor(next() * 480) + 4);
    const cost = ((Math.floor(next() * 9000) + 199) / 100).toFixed(2);
    expected.set(row.cells[0] ?? "", [units, cost]);
    if (order < TARGETS * 0.6) {
      row.cells[UNITS] = "";
      row.cells[COST] = "";
    } else if (order < TARGETS * 0.9) {
      row.cells[UNITS] = String(Number(units) + 7 + (order % 5) * 11);
      row.cells[COST] = (Number(cost) + 1.25).toFixed(2);
    } else {
      row.cells[UNITS] = units;
      row.cells[COST] = cost;
    }
  });
  const count = [
    "sku,units_on_hand,unit_cost,counted_by,count_date",
    ...[...expected]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([sku, [units, cost]], index) =>
          `${sku},${units ?? ""},${cost ?? ""},${["J. Ortiz", "M. Chen", "R. Patel"][index % 3] ?? ""},2026-11-1${String(index % 8)}`,
      ),
  ].join("\n");
  return { count, expected, rows };
}

const SHEET = buildSheet();

function sheetPage(): string {
  const toolbar = [
    "Undo",
    "Redo",
    "Print",
    "Paint format",
    "Zoom",
    "Format as currency",
    "Format as percent",
    "Decrease decimal places",
    "Increase decimal places",
    "More formats",
    "Font",
    "Decrease font size",
    "Font size",
    "Increase font size",
    "Bold",
    "Italic",
    "Strikethrough",
    "Text color",
    "Fill color",
    "Borders",
    "Merge cells",
    "Horizontal align",
    "Vertical align",
    "Text wrapping",
    "Text rotation",
    "Insert link",
    "Insert comment",
    "Insert chart",
    "Create a filter",
    "Filter views",
    "Functions",
  ];
  const menus = [
    "File",
    "Edit",
    "View",
    "Insert",
    "Format",
    "Data",
    "Tools",
    "Extensions",
    "Help",
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Q4 inventory</title>
<style>
body{font-family:Arial,sans-serif;margin:0;font-size:13px}
header{padding:6px 12px;border-bottom:1px solid #ddd}
#menus button,#toolbar button{border:0;background:none;padding:3px 6px;font-size:12px}
#bar{display:flex;gap:6px;padding:4px 12px;border-bottom:1px solid #ddd}
#name-box{width:70px}#formula-bar{flex:1}
#grid-wrap{height:calc(100vh - 170px);overflow:hidden;outline:none}
table{border-collapse:collapse}td,th{border:1px solid #e2e2e2;padding:2px 6px;white-space:nowrap;height:18px}
th{background:#f8f9fa;font-weight:normal;color:#555}
td[aria-selected=true]{outline:2px solid #1a73e8}
footer{padding:4px 12px;border-top:1px solid #ddd}
</style></head><body>
<header><div><b>Q4 inventory</b> <span id="saved">All changes saved</span></div>
<nav id="menus">${menus.map((menu) => `<button>${menu}</button>`).join("")}</nav>
<div id="toolbar" role="toolbar">${toolbar.map((label) => `<button aria-label="${label}">${label.slice(0, 2)}</button>`).join("")}</div></header>
<div id="bar"><input id="name-box" aria-label="Name box" value="A2"><span>fx</span><input id="formula-bar" aria-label="Formula bar"></div>
<div id="grid-wrap" tabindex="0"><table role="grid" aria-label="Inventory"><thead id="head"></thead><tbody id="body"></tbody></table></div>
<footer><button aria-current="page">Inventory</button> <button>Suppliers</button> <button>Archive 2025</button> <span id="where"></span></footer>
<script>
(() => {
// Out of the page once it runs, as a web app's code is out of reach of
// reading its markup.
document.currentScript.remove();
const HEADERS = ${JSON.stringify(HEADERS)};
const VISIBLE = 40;
const TOTAL = ${String(ROWS)};
// The rows on screen, from the server, as a web sheet loads what it shows.
const values = [];
function load(from) {
  const x = new XMLHttpRequest();
  x.open("GET", "/api/rows?from=" + from + "&count=" + VISIBLE, false);
  x.send();
  JSON.parse(x.responseText).forEach((row, i) => { values[from + i] = row; });
}
let sel = { r: 0, c: 0 };
let top = 0;
const letters = HEADERS.map((_, i) => String.fromCharCode(65 + i));
const nameBox = document.getElementById("name-box");
const formula = document.getElementById("formula-bar");
const wrap = document.getElementById("grid-wrap");
const addr = (r, c) => letters[c] + (r + 2);
function render() {
  load(top);
  document.getElementById("head").innerHTML =
    "<tr><th></th>" + letters.map((l) => '<th role="columnheader">' + l + "</th>").join("") + "</tr>" +
    '<tr><th role="rowheader">1</th>' + HEADERS.map((h) => '<td role="gridcell">' + h + "</td>").join("") + "</tr>";
  let html = "";
  for (let r = top; r < Math.min(TOTAL, top + VISIBLE); r++) {
    html += '<tr><th role="rowheader">' + (r + 2) + "</th>";
    for (let c = 0; c < letters.length; c++) {
      const v = String(values[r][c]).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      html += '<td role="gridcell" data-r="' + r + '" data-c="' + c + '"' +
        (r === sel.r && c === sel.c ? ' aria-selected="true"' : "") + ">" + v + "</td>";
    }
    html += "</tr>";
  }
  document.getElementById("body").innerHTML = html;
  document.getElementById("where").textContent = "Rows " + (top + 2) + "-" + (Math.min(TOTAL, top + VISIBLE) + 1) + " of " + (TOTAL + 1);
}
function select(r, c) {
  sel = { r: Math.max(0, Math.min(TOTAL - 1, r)), c: Math.max(0, Math.min(letters.length - 1, c)) };
  if (sel.r < top || sel.r >= top + VISIBLE) top = Math.max(0, Math.min(TOTAL - VISIBLE, sel.r - 10));
  render();
  nameBox.value = addr(sel.r, sel.c);
  formula.value = values[sel.r][sel.c];
}
let rev = ${JSON.stringify(served.rev)};
${SIGNED}
function commit(text) {
  const x = new XMLHttpRequest();
  x.open("POST", "/api/cell", false);
  x.setRequestHeader("x-sheet-sig", signed(rev + ":" + sel.r + ":" + sel.c + ":" + text));
  x.send(JSON.stringify({ c: sel.c, r: sel.r, value: text }));
  if (x.status !== 204) return;
  rev = x.getResponseHeader("x-sheet-rev");
  values[sel.r][sel.c] = text;
  document.getElementById("saved").textContent = "Saving...";
  setTimeout(() => { document.getElementById("saved").textContent = "All changes saved"; }, 300);
}
// A spreadsheet's name box and formula bar take what is typed in place of what they show.
nameBox.addEventListener("focus", () => nameBox.select());
formula.addEventListener("focus", () => formula.select());
nameBox.addEventListener("keydown", (e) => {
  if (!e.isTrusted || e.key !== "Enter") return;
  e.preventDefault();
  const m = /^\\s*([A-Za-z])\\s*(\\d+)\\s*$/.exec(nameBox.value);
  if (m) select(Number(m[2]) - 2, m[1].toUpperCase().charCodeAt(0) - 65);
  wrap.focus();
});
formula.addEventListener("keydown", (e) => {
  if (!e.isTrusted) return;
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    commit(formula.value);
    if (e.key === "Enter") select(sel.r + 1, sel.c); else select(sel.r, sel.c + 1);
    wrap.focus();
  } else if (e.key === "Escape") {
    formula.value = values[sel.r][sel.c];
    wrap.focus();
  }
});
wrap.addEventListener("mousedown", (e) => {
  if (!e.isTrusted) return;
  const cell = e.target.closest("td[data-r]");
  if (cell) { select(Number(cell.dataset.r), Number(cell.dataset.c)); wrap.focus(); e.preventDefault(); }
});
wrap.addEventListener("wheel", (e) => {
  if (!e.isTrusted) return;
  top = Math.max(0, Math.min(TOTAL - VISIBLE, top + Math.sign(e.deltaY) * 10));
  render();
});
wrap.addEventListener("keydown", (e) => {
  if (!e.isTrusted) return;
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-20, 0], PageDown: [20, 0] };
  if (moves[e.key]) { e.preventDefault(); select(sel.r + moves[e.key][0], sel.c + moves[e.key][1]); return; }
  if (e.key === "Enter") { e.preventDefault(); formula.focus(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(""); select(sel.r, sel.c); return; }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); formula.focus(); formula.value = e.key; }
});
select(0, 0);
})();
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Serving the sheet

/** The sheet as the server holds it, which every edit through the page changes. */
const served = {
  commits: 0,
  /** What the next edit is signed over, new after every edit. */
  rev: Math.random().toString(36).slice(2),
  values: SHEET.rows.map((row) => [...row.cells]),
};

/**
 * How the page signs an edit, inside the code that removes itself, as a web
 * sheet's edits go out in a protocol its own code speaks. Without it the job
 * was one script: measured on Haiku 5.5, both runs of 1,800 rows read the
 * page's source with `curl`, then wrote every cell by posting to its API from
 * `agent-browser eval`, in 10 and 14 requests and with no rollover. Signed over
 * a value the server changes on every edit, so a recorded request cannot be
 * sent again either.
 */
function signed(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
const SIGNED = signed.toString();

/**
 * The session a browser signs in with, set on its own navigation and never on
 * a request from `curl` or a script, as a web sheet's sign-in lives in the
 * browser and nowhere a shell can reach it.
 */
const SESSION_COOKIE = `session=${Math.random().toString(36).slice(2)}`;

const CellSchema = z.object({
  c: z
    .number()
    .int()
    .min(0)
    .max(HEADERS.length - 1),
  r: z
    .number()
    .int()
    .min(0)
    .max(ROWS - 1),
  value: z.string(),
});

async function serveSheet(): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    // The page only to the browser's own navigation, as its code is out of
    // reach of `curl` or a script's fetch.
    if (
      url.pathname === "/sheet" &&
      request.headers["sec-fetch-dest"] === "document"
    ) {
      response.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": `${SESSION_COOKIE}; Path=/; HttpOnly`,
      });
      response.end(sheetPage());
      return;
    }
    if (!(request.headers.cookie?.includes(SESSION_COOKIE) ?? false)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Sign in to see this sheet" }));
      return;
    }
    if (url.pathname === "/api/rows") {
      const from = Math.max(0, Number(url.searchParams.get("from")) || 0);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(served.values.slice(from, from + 40)));
      return;
    }
    if (url.pathname === "/api/cell" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const cell = CellSchema.safeParse(JSON.parse(body));
        const row = cell.success ? served.values[cell.data.r] : undefined;
        if (!cell.success || !row) {
          response.writeHead(400);
          response.end();
          return;
        }
        const { c, r, value } = cell.data;
        if (
          request.headers["x-sheet-sig"] !==
          signed(`${served.rev}:${String(r)}:${String(c)}:${value}`)
        ) {
          response.writeHead(403);
          response.end();
          return;
        }
        row[c] = value;
        served.commits += 1;
        served.rev = Math.random().toString(36).slice(2);
        response.writeHead(204, { "x-sheet-rev": served.rev });
        response.end();
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
    throw new Error("The sheet has no port");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

const SHEET_URL = `${await serveSheet()}/sheet`;

// ---------------------------------------------------------------------------
// Reading the sheet back

interface Outcome {
  commits?: number;
  error?: string;
  values?: string[][];
}

const OUTCOME_FILE = "sheet-rollover-outcome.json";

function recordOutcome({ chatId }: { chatId: Parameters<typeof chatDir>[0] }) {
  const outcome: Outcome = { commits: served.commits, values: served.values };
  fs.writeFileSync(
    path.join(chatDir(chatId), OUTCOME_FILE),
    JSON.stringify(outcome, null, 2),
  );
}

function outcomeOf(chatId: Parameters<typeof chatDir>[0]): Outcome | undefined {
  const file = path.join(chatDir(chatId), OUTCOME_FILE);
  // The teardown's own JSON.
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Outcome)
    : undefined;
}

/** A cell's number as a person reads it: `$1,204.50` and `1204.5` agree. */
function amount(text: string | undefined): number | undefined {
  const cleaned = (text ?? "").replaceAll(/[$,\s]/g, "");
  return cleaned === "" || Number.isNaN(Number(cleaned))
    ? undefined
    : Number(cleaned);
}

const sheetIsRight: Assertion = {
  check: ({ chatId }) => {
    const outcome = outcomeOf(chatId);
    const values = outcome?.values;
    if (!values) {
      return {
        evidence: `no sheet read back: ${JSON.stringify(outcome)}`,
        passed: false,
        text: "Every counted SKU has the count's units and cost, and nothing else changed",
      };
    }
    let right = 0;
    const wrong: string[] = [];
    const touched: string[] = [];
    SHEET.rows.forEach((row, index) => {
      const now = values[index] ?? [];
      const sku = row.cells[0] ?? "";
      const want = SHEET.expected.get(sku);
      row.cells.forEach((before, column) => {
        const cell = `${String.fromCharCode(65 + column)}${String(index + 2)}`;
        if (want && (column === UNITS || column === COST)) {
          const target = want[column === UNITS ? 0 : 1];
          if (amount(now[column]) === amount(target)) {
            right += 1;
          } else {
            wrong.push(
              `${cell} (${sku}) ${JSON.stringify(now[column])}, wants ${target ?? ""}`,
            );
          }
        } else if ((now[column] ?? "") !== before) {
          touched.push(
            `${cell} ${JSON.stringify(before)} -> ${JSON.stringify(now[column])}`,
          );
        }
      });
    });
    return {
      evidence: `${String(right)}/${String(TARGETS * 2)} counted cells right; ${String(outcome.commits ?? 0)} edits through the sheet; wrong: ${wrong.slice(0, 12).join("; ") || "none"}${wrong.length > 12 ? ` (+${String(wrong.length - 12)} more)` : ""}; other cells changed: ${touched.slice(0, 12).join("; ") || "none"}`,
      passed: wrong.length === 0 && touched.length === 0,
      text: "Every counted SKU has the count's units and cost, and nothing else changed",
    };
  },
  text: "Every counted SKU has the count's units and cost, and nothing else changed",
};

// ---------------------------------------------------------------------------
// Measuring the context

const ACTS =
  /agent-browser\s+(?:\S+\s+)*?(?:fill|type|press|keyboard|click|dblclick)\b/;
const READS =
  /agent-browser\s+(?:\S+\s+)*?(?:snapshot|get|screenshot|eval|scroll|find|is|tab)\b|\b(?:cat|head|tail|grep|rg|awk|sed|python3?|read_file)\b/;

/** A step acted when any command typed or clicked; it read when it only looked. */
function classify(commands: string[]): StepKind {
  if (commands.some((command) => ACTS.test(command))) {
    return "act";
  }
  return commands.some((command) => READS.test(command)) ? "read" : "other";
}

/** Every session that did the work: the chat's own and any task it started. */
async function workSessions(
  context: Parameters<Assertion["check"]>[0],
): Promise<{ label: string; session: Session.WithMessagesAndParts }[]> {
  const children = await context.childSessions();
  return [
    ...context.sessions.map((session) => ({ label: "chat", session })),
    ...children.flatMap((child) =>
      child.sessions.map((session) => ({ label: child.title, session })),
    ),
  ].filter(({ session }) =>
    session.messages.some((message) => message.role === "assistant"),
  );
}

function report(label: string, cycles: ContextCycles) {
  const prompts = cycles.steps.map((step) => step.prompt);
  const rooms = cycles.rollovers.flatMap((one) =>
    one.room === undefined ? [] : [one.room],
  );
  return {
    clearings: cycles.clearings.map((one) => ({
      afterStep: one.afterStep,
      promptAfter: one.promptAfter,
      promptBefore: one.promptBefore,
      results: one.results,
    })),
    estimatedUSD: Math.round((cycles.estimatedUSD ?? 0) * 1000) / 1000,
    /** The job's first request, which a long chat starts already full. */
    firstPrompt: prompts[0],
    label,
    prompt: spreadOf(prompts),
    requests: cycles.steps.length,
    requestsPastStep: prompts.filter((prompt) => prompt > HAIKU_PRICE.step)
      .length,
    browserGuideSent: cycles.steps.filter((step) => step.sentBrowserGuide)
      .length,
    room: spreadOf(rooms),
    rollovers: cycles.rollovers.map((one) => ({
      afterStep: one.afterStep,
      droppedNewestToolResult: one.droppedNewestToolResult,
      firstTextAfter: one.firstTextAfter,
      lastCommandBefore: one.lastCommandBefore,
      promptAfter: one.promptAfter,
      promptAtCut: one.promptAtCut,
      readStepsBeforeAct: one.readStepsBeforeAct,
      reranLastCommand: one.reranLastCommand,
      room: one.room,
      summaryChars: one.summary?.length,
    })),
    stepKinds: {
      act: cycles.steps.filter((step) => step.kind === "act").length,
      other: cycles.steps.filter((step) => step.kind === "other").length,
      read: cycles.steps.filter((step) => step.kind === "read").length,
    },
    totalInputTokens: cycles.totalInputTokens,
    totalOutputTokens: cycles.totalOutputTokens,
  };
}

async function measured(context: Parameters<Assertion["check"]>[0]) {
  return (await workSessions(context)).map(({ label, session }) => ({
    cycles: contextCycles(session, { classify, price: HAIKU_PRICE }),
    label,
  }));
}

const contextMeasured: Assertion = {
  check: async (context) => {
    const sessions = await measured(context);
    const reports = sessions.map(({ cycles, label }) => report(label, cycles));
    return {
      evidence: JSON.stringify(reports, null, 1),
      passed: reports.some((one) => one.rollovers.length > 0),
      text: "Rolled over at least once (the measurements below are of a real rollover)",
    };
  },
  text: "Rolled over at least once (the measurements below are of a real rollover)",
};

const noRecheckAfterRollover: Assertion = {
  check: async (context) => {
    const rollovers = (await measured(context)).flatMap(
      ({ cycles }) => cycles.rollovers,
    );
    const rechecks = rollovers.map((one) => one.readStepsBeforeAct);
    return {
      evidence: `read-only steps before the first edit after each rollover: ${rechecks.join(", ") || "no rollover"}`,
      passed: rollovers.length > 0 && rechecks.every((count) => count <= 1),
      text: "After each rollover it went back to editing within one look at the sheet",
    };
  },
  text: "After each rollover it went back to editing within one look at the sheet",
};

const keptNewestResult: Assertion = {
  check: async (context) => {
    const rollovers = (await measured(context)).flatMap(
      ({ cycles }) => cycles.rollovers,
    );
    const dropped = rollovers.filter((one) => one.droppedNewestToolResult);
    return {
      evidence: `${String(dropped.length)}/${String(rollovers.length)} rollovers cut right after a tool result; ${String(dropped.filter((one) => one.reranLastCommand).length)} of those ran the last command again`,
      passed: rollovers.length > 0 && dropped.length === 0,
      text: "No rollover dropped the newest tool result",
    };
  },
  text: "No rollover dropped the newest tool result",
};

const viewing: SessionMessageDataPart.ViewContextDataPart = {
  page: {
    tab: SHEET_TAB,
    tabs: [{ id: SHEET_TAB, title: "Q4 inventory", url: SHEET_URL }],
    title: "Q4 inventory",
    url: SHEET_URL,
  },
  screen: "browser",
  url: SHEET_URL,
};

// ---------------------------------------------------------------------------
// A long chat before the job

/**
 * What the person keeps in memory. A whole memory note lists each one's first
 * line, and a long chat carries one note from every window it rolled over
 * into.
 */
const MEMORIES = [
  [
    "name",
    "The user's name is Dana Whitfield. She runs inventory and purchasing for Whitfield Hardware, a three-store chain, and is the only person who edits the inventory sheets.",
  ],
  [
    "stores",
    "Whitfield Hardware has stores in Reno, Columbus and Dallas, plus a warehouse in Allentown that receives from suppliers and ships to all three stores twice a week.",
  ],
  [
    "sheet-owner",
    "Dana owns the Q4 inventory sheet; the store managers can comment on it, but only she edits Units on hand and Unit cost, and she wants every edit made in the sheet itself.",
  ],
  [
    "count-schedule",
    "The warehouse does a full cycle count at the end of each quarter, and spot counts on the 1st and 15th of each month for fast-moving categories like Fasteners and Safety.",
  ],
  [
    "cost-rounding",
    "Unit costs are kept to the cent, with no currency sign and no thousands separator, because the accounting export reads the column as a plain number.",
  ],
  [
    "discontinued",
    "Discontinued SKUs stay on the sheet until year end so the auditors can trace them; never delete a row, even when its units reach zero.",
  ],
  [
    "reorder-policy",
    "Reorder level is set by the store managers each spring from the prior year's sales; Dana does not change it during the year and asks that nobody else does.",
  ],
  [
    "supplier-ridgeway",
    "Ridgeway Supply invoices net 45 and ships from Sparks, NV; their lead time is about 6 business days, longer in December when their warehouse runs a reduced crew.",
  ],
  [
    "supplier-atlas",
    "Atlas Industrial is the main supplier for power tools and has a 3% early-payment discount when invoices are paid within 10 days of delivery.",
  ],
  [
    "supplier-northgate",
    "Northgate Tools changed their SKU prefixes in 2025; old HT- codes map one to one to their new catalog, and the sheet keeps the old HT- codes.",
  ],
  [
    "supplier-bayline",
    "Bayline Distributors handles garden and seasonal stock; they want orders by Tuesday noon Eastern for a Friday delivery to the Allentown warehouse.",
  ],
  [
    "supplier-keystone",
    "Keystone Hardware is the fallback supplier for fasteners when Ridgeway is backordered; their prices run about 8% higher, so Dana uses them only when she has to.",
  ],
  [
    "bins",
    "Bin codes are aisle letter then shelf number, like C-14; the Allentown warehouse uses aisles A through H, and aisle H is overflow for seasonal stock.",
  ],
  [
    "counted-by",
    "J. Ortiz, M. Chen and R. Patel are the three warehouse counters; Ortiz leads the quarter-end count and sends the count file when it is done.",
  ],
  [
    "status-values",
    "The Status column only takes Active or Discontinued; anything else, including a trailing space, breaks the accounting import that runs every night.",
  ],
  [
    "notes-column",
    "The Notes column is for the store managers' comments; Dana prefers it left alone unless she asks for something to be written there.",
  ],
  [
    "weekly-report",
    "Every Monday morning Dana sends the owners a one-page summary of stock value by category and any item that went below its reorder level that week.",
  ],
  [
    "shrink",
    "Shrink above 2% in any category needs a note to the owners with the likely cause, such as damage in receiving, theft, or a miscount.",
  ],
  [
    "seasonal",
    "Garden stock is seasonal: counts drop sharply from October, the slow sellers are marked down in November, and restock starts in February.",
  ],
  [
    "safety-stock",
    "Safety items (gloves, goggles, respirators) must never go below their reorder level; flag any that do right away rather than at the end of a job.",
  ],
  [
    "paint",
    "Paint is mixed in store, so Units on hand for paint counts base cans, not finished colors; tint and primer are counted separately.",
  ],
  [
    "electrical",
    "Electrical stock has a compliance hold: recalled lots are marked in Notes and are not sold, but they stay in Units on hand until the supplier collects them.",
  ],
  [
    "plumbing",
    "PEX fittings come in bags of 10 but are counted by the piece, so a count of 40 is four bags; supply lines are counted by the piece too.",
  ],
  [
    "power-tools",
    "Power tools are serialized; the quarter-end count includes display units, which are marked Display in Notes and are sold at a discount.",
  ],
  [
    "tone",
    "Dana likes short updates: what changed, what needs her, nothing else. She reads them on her phone between store visits.",
  ],
  [
    "time-zone",
    "Dana works on Eastern time and usually starts at 7 am; the Dallas store is an hour behind and Reno is three hours behind.",
  ],
  [
    "spreadsheets",
    "Dana's sheets live in the browser; she does not keep local copies, does not want CSV exports changed, and does not want new tabs added to a sheet.",
  ],
  [
    "approvals",
    "Changes to more than 50 rows at once need a heads-up to the Columbus manager, Priya Nair, who reconciles the store's books on Fridays.",
  ],
  [
    "vendor-portal",
    "Atlas and Ridgeway have vendor portals; Dana signs in herself and does not share passwords, so purchase orders are placed by her, not by anyone else.",
  ],
  [
    "year-end",
    "Year-end close is December 31; the Q4 sheet freezes on January 5 for the auditors, and after that only Dana's accountant may change it.",
  ],
].map(([name = "", text = ""]) => ({ name, text }));

const PROJECT_INSTRUCTIONS = `Inventory and purchasing for Whitfield Hardware.

- The Q4 inventory sheet in the browser is the record. Edit it in place; never export, re-import or rebuild it.
- Units on hand and Unit cost come only from a warehouse count or an invoice. Never estimate them.
- Keep costs to the cent with no currency sign.
- Never change Reorder level, Notes or Status unless asked.
- When a count disagrees with the sheet by more than 20%, list those SKUs at the end rather than asking mid-job.
- Store managers: Reno (Luis Ortega), Columbus (Priya Nair), Dallas (Tom Becker).
- Suppliers: Ridgeway Supply, Atlas Industrial, Northgate Tools, Bayline Distributors, Keystone Hardware.
- The weekly report goes out Monday morning; the quarter-end count lands in the last week of the quarter.`;

/** What the person asked in the chat's earlier turns, and what it answered. */
const EARLIER_TURNS: [ask: string, reply: string][] = [
  [
    "What's the reorder level on the contractor rakes?",
    "The contractor rakes have a reorder level of 34 in Reno and 41 in Dallas.",
  ],
  [
    "Which power tools are below their reorder level?",
    "Three are below: the compact impact driver in Columbus, the pro jigsaw in Dallas and the standard grinder in Reno.",
  ],
  [
    "Can you check how many safety goggles we have across all stores?",
    "Across the three stores there are 212 pairs of safety goggles, all Active.",
  ],
  [
    "Is the Bayline order for garden hoses on the sheet yet?",
    "Not yet: the garden hose rows still show last month's counts.",
  ],
  [
    "What does row 48 say in Notes?",
    'Row 48, the standard washers, says "Check damaged cartons".',
  ],
  [
    "How many SKUs are discontinued?",
    "There are 37 discontinued SKUs, most of them in Paint and Garden.",
  ],
  [
    "Sort out which electrical items have recall notes.",
    "Two electrical rows carry recall notes, both outlet covers from the same lot.",
  ],
  [
    "What's our total stock value in Fasteners?",
    "Fasteners come to about $18,400 at current unit costs.",
  ],
  [
    "Which supplier has the most SKUs on the sheet?",
    "Ridgeway Supply, with 98 SKUs, then Atlas Industrial with 91.",
  ],
  [
    "Did the Columbus counts from the 1st get entered?",
    "Yes, the spot counts from the 1st are in for Columbus.",
  ],
  [
    "Find anything with a unit cost over $80.",
    "Eleven SKUs are over $80, all power tools except one respirator.",
  ],
  [
    "Which bins in aisle C are empty?",
    "None of the aisle C bins are empty; C-07 has the fewest units, 6.",
  ],
  [
    "Is the Dallas grinder still backordered?",
    'The Notes on the Dallas grinder say "Vendor backorder", last counted in September.',
  ],
  [
    "How many rows did Ortiz count last quarter?",
    "J. Ortiz is on 148 rows from the Q3 count.",
  ],
  [
    "What's the cheapest drill we carry?",
    "The lightweight drill at $41.20 is the cheapest.",
  ],
  [
    "Which plumbing items have no Units on hand?",
    "Four plumbing rows are blank in Units on hand: two PEX elbows and two supply lines.",
  ],
  [
    "Pull up the paint primer rows.",
    "There are six primer rows, three in Reno and three in Columbus.",
  ],
  [
    "Has anything in Safety dropped below reorder?",
    "Yes, respirators in Dallas are at 9 against a reorder level of 15.",
  ],
  [
    "What did we decide about the Northgate prefixes?",
    "Old HT- codes map one to one to Northgate's new catalog, so the sheet keeps the HT- codes.",
  ],
  [
    "Which garden items are discontinued?",
    "Nine garden rows are discontinued, mostly sprinklers and older trowels.",
  ],
  [
    "Check the Reno hammers.",
    "Reno has three hammer rows: 44, 61 and 18 units on hand.",
  ],
  [
    "What's the count date range in the sheet?",
    "Last counted dates run from 2026-01-12 to 2026-09-27.",
  ],
  [
    "Is anything counted twice?",
    "No SKU appears twice; every SKU is on one row.",
  ],
  [
    "How many rows have Notes filled in?",
    "About a third of the rows have something in Notes.",
  ],
  [
    "Which suppliers do we use for paint?",
    "Paint comes from Keystone Hardware and Bayline Distributors.",
  ],
  [
    "What's the most expensive item in Garden?",
    "The heavy-duty sprinkler system at $88.40.",
  ],
  [
    "Find the impact drivers.",
    "There are seven impact driver rows across the three stores.",
  ],
  ["Any rows missing a bin code?", "No, every row has a bin code."],
  [
    "What's the stock value in Power tools?",
    "Power tools come to roughly $96,000 at current costs.",
  ],
  ["How many Active SKUs are there?", "413 SKUs are Active."],
  [
    "Which store has the most hand tools?",
    "Columbus has the most hand tools on hand, about 1,900 units.",
  ],
  [
    "Look for any negative counts.",
    "There are no negative counts on the sheet.",
  ],
  [
    "What's on row 200?",
    "Row 200 is a standard roller kit in Dallas with 63 on hand.",
  ],
  [
    "Which wrench sets are low?",
    "The compact wrench set in Reno is at 7 against a reorder level of 12.",
  ],
  [
    "Are the electrical outlets all Active?",
    "Yes, all outlet rows are Active.",
  ],
  [
    "How many units of hex bolts in total?",
    "Hex bolts come to 2,340 units across the stores.",
  ],
  ["Which SKUs were last counted by Chen?", "M. Chen is on 141 rows."],
  [
    "Is the tape measure count from Dallas in?",
    "The Dallas tape measures were last counted 2026-09-15.",
  ],
  [
    "What's the reorder level for drop cloths?",
    "Drop cloths have a reorder level of 25 in every store.",
  ],
  [
    "Do we stock respirators in Reno?",
    "Yes, two respirator rows in Reno, with 22 and 14 on hand.",
  ],
  [
    "Which items are seasonal in Notes?",
    "Fourteen rows say Seasonal, all in Garden and Paint.",
  ],
  [
    "What's the average unit cost in Plumbing?",
    "Plumbing averages about $36 a unit.",
  ],
  [
    "Any duplicate product names?",
    "Several product names repeat across stores, but each has its own SKU.",
  ],
  [
    "How many SKUs does Keystone supply?",
    "Keystone Hardware supplies 87 SKUs.",
  ],
  [
    "OK, the quarter-end count should land today.",
    "Sounds good. Send me the count file when it's in and I'll put it into the sheet.",
  ],
];

/** A seeded turn's view: the sheet, at the cell the person was on. */
function viewingAt(turn: number): SessionMessageDataPart.ViewContextDataPart {
  const at = `${SHEET_URL}#range=G${String(2 + ((turn * 37) % ROWS))}`;
  return {
    page: {
      tab: SHEET_TAB,
      tabs: [{ id: SHEET_TAB, title: "Q4 inventory", url: at }],
      title: "Q4 inventory",
      url: at,
    },
    screen: "browser",
    url: at,
  };
}

/** A seeded rollover's summary, in the sections the summary prompt asks for. */
function seededSummary(turn: number): string {
  return `## Goal
Dana Whitfield runs inventory for Whitfield Hardware and is working in the Q4 inventory sheet (${SHEET_URL}). She asks quick questions about rows, suppliers and counts; the quarter-end warehouse count is due, and when it lands its Units on hand and Unit cost go into the sheet. Standing instructions: edit the sheet in place, never change Reorder level, Notes or Status unless asked, costs to the cent with no currency sign, leave CSV exports alone.

## Done and found
- Answered ${String(turn)} questions so far about rows, reorder levels, suppliers and counts.
- The sheet has ${String(ROWS)} data rows (rows 2 to ${String(ROWS + 1)}), columns A to L: SKU, Product, Category, Warehouse, Supplier, Reorder level, Units on hand, Unit cost, Last counted, Bin, Notes, Status.
- The grid shows 40 rows at a time. The Name box jumps to a cell; the formula bar edits the selected cell, and Enter commits and moves down.
- No edits made to the sheet yet in this chat.

## Files
(none)

## Decisions
- Answer from the live sheet rather than from earlier reads, since store managers comment on it during the day.

## Next
- Wait for the quarter-end count file, then enter it into the sheet.`;
}

/**
 * The 45 turns before the job, with what the app attaches to each (memory,
 * the view, the browser's tabs, the project's instructions) and a rollover
 * every five.
 */
async function seedLongChat({
  chatId,
  modelURI,
  sessionId,
}: {
  chatId: ChatId;
  modelURI: string;
  sessionId: StoreId.Session;
}) {
  for (const memory of MEMORIES) {
    await saveMemory(memoryDir(), memory);
  }
  const project = await createProject({
    instructions: PROJECT_INSTRUCTIONS,
    name: "Store ops",
  });
  await setChatProject(chatId, project.id);
  await seedChatHistory({
    chatId,
    modelURI: AIGatewayModelURI.Schema.parse(modelURI),
    rolloverEvery: 5,
    sessionId,
    summary: seededSummary,
    turns: EARLIER_TURNS.map(([ask, reply], turn) => ({
      ask,
      reply,
      viewing: viewingAt(turn),
    })),
  });
}

const JOB = {
  assertions: [
    sheetIsRight,
    contextMeasured,
    noRecheckAfterRollover,
    keptNewestResult,
  ],
  folders: [{ inPlace: true, path: DOCUMENTS }],
  kind: "chat",
  // The Claude account lists no price, so the run's cost is unread and the
  // default token cap would stop it in its first few dozen requests.
  maxRunTokens: 40_000_000,
  prompt:
    "The warehouse just finished its count, it's in Documents/Warehouse count.csv. Please put those numbers into this Q4 inventory sheet: for every SKU in the count, set Units on hand and Unit cost in the sheet to the counted values. Some are blank in the sheet and some are out of date. Leave the CSV and every other cell alone, and tell me when the sheet is done.",
  setup: () => {
    fs.mkdirSync(DOCUMENTS, { recursive: true });
    fs.writeFileSync(COUNT_FILE, `${SHEET.count}\n`);
  },
  sharedBrowser: true,
  teardown: recordOutcome,
  viewing,
} satisfies Omit<EvalCase, "name">;

export const SHEET_ROLLOVER_EVALS = [
  defineEval({ ...JOB, name: "sheet-rollover-browser-job" }),
  /**
   * The same job at the end of a long chat, as the recorded one was: the
   * window it starts in carries every earlier user message the last rollover
   * kept, with what the app attached to each.
   */
  defineEval({
    ...JOB,
    history: seedLongChat,
    name: "sheet-rollover-long-chat",
  }),
];
