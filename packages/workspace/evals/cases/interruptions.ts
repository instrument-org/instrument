/**
 * Messages the user types while the chat is still working, the way people
 * actually write mid-job: a request finished in fragments, a correction, a
 * step added, a later wish that changes what they want to hear, a stop, an
 * unrelated question. Paraphrased from real mid-turn messages, which mostly
 * belong to the work already running.
 *
 * Each case scores what objectively has to be true (the file matches the
 * correction, one issue filed, nothing done twice by two agents) and leaves
 * how the conversation read to the user-view grader
 * (`evals/user-view-grade.ts`), which reads only `user-view.md`: what the
 * user typed and what the chat wrote back.
 *
 * Cases whose slug starts `holdout-` are kept back from whoever tunes the
 * agent's prompt: score them, never write instructions against them.
 *
 * Run through `evals/handoff-matrix.ts --cases <slug>,...`; they are left
 * out of the default hand-off suite.
 */
import fs from "node:fs";
import path from "node:path";

import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval, type EvalCase } from "../harness";
import { type AppFixture } from "../lib/connected-app";
import { createdIssueUrl } from "../lib/mcp-tracker";
import {
  type Context,
  fail,
  HOME,
  pass,
  QUICK_ANSWER,
  readText,
  recentFilesUnder,
  renamedTheScans,
  said,
  seedScans,
  sentAt,
} from "./handoff";

// ---------------------------------------------------------------------------
// Reading a run back
// ---------------------------------------------------------------------------

/** One agent's own steps: the chat, or a fork without what it inherited. */
interface Agent {
  name: string;
  sessions: Session.WithMessagesAndParts[];
}

async function agents(ctx: Context): Promise<Agent[]> {
  const children = await ctx.childSessions();
  return [
    { name: "chat", sessions: ctx.sessions },
    ...children.map((child) => ({
      name: child.title || child.taskId,
      sessions: child.sessions,
    })),
  ];
}

/** Every tool part an agent ran itself, as JSON, input and output alike. */
function ownToolParts(agent: Agent): string[] {
  return agent.sessions.flatMap((session) =>
    session.messages
      .filter((message) => !message.metadata.inherited)
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type.startsWith("tool-") ? [JSON.stringify(part)] : [],
        ),
      ),
  );
}

/**
 * The same work not done by two agents: no resource matching `resource` is
 * touched by the chat and a fork, or by two forks. One agent going back to a
 * file is fine; two agents doing the same reading is the work done twice.
 */
function noWorkDoneTwice(resource: RegExp, what: string): Assertion {
  const text = `${what} was worked by one agent, not two`;
  return {
    check: async (ctx) => {
      const touched = (await agents(ctx)).filter((agent) =>
        ownToolParts(agent).some((part) => resource.test(part)),
      );
      const evidence = `touched by ${touched.length}: ${touched.map((agent) => agent.name).join(", ") || "none"}`;
      return touched.length <= 1 ? pass(text, evidence) : fail(text, evidence);
    },
    text,
  };
}

/** What the chat said after the user's message containing `words`. */
function saidAfter(ctx: Context, words: string): string {
  const at = sentAt(ctx.sessions, words) ?? 0;
  return said(ctx.sessions)
    .filter((one) => one.at >= at)
    .map((one) => one.text)
    .join("\n");
}

function seedFolder(name: string, files: Record<string, string>): string {
  const dir = path.join(HOME, "Documents", name);
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

interface Interruption {
  apps?: AppFixture[];
  assertions: Assertion[];
  followUps: EvalCase["followUps"];
  prompt: string;
  /** A folder under Documents the user sent with the first message. */
  sent?: string;
  setup: () => void;
  slug: string;
}

function toEval(one: Interruption): EvalCase {
  return defineEval({
    apps: one.apps,
    assertions: one.assertions,
    folders:
      one.sent === undefined
        ? undefined
        : [
            {
              access: "read-write",
              inPlace: true,
              path: path.join(HOME, "Documents", one.sent),
            },
          ],
    followUps: one.followUps,
    kind: "chat",
    name: `handoff-${one.slug}`,
    prompt: one.prompt,
    setup: one.setup,
  });
}

// ---------------------------------------------------------------------------
// fragments: one question in three messages, sent while the lookup runs
// ---------------------------------------------------------------------------

const REGIONS = { central: 301_480, east: 389_120, west: 412_350 };

function quarterRows(region: string, total: number, months: string[]): string {
  const share = [0.31, 0.33];
  const first = Math.round(total * (share[0] ?? 0));
  const second = Math.round(total * (share[1] ?? 0));
  const amounts = [first, second, total - first - second];
  return `region,month,revenue\n${months.map((month, index) => `${region},${month},${String(amounts[index] ?? 0)}`).join("\n")}\n`;
}

function seedFinance() {
  const q3 = ["2026-07", "2026-08", "2026-09"];
  const q2 = ["2026-04", "2026-05", "2026-06"];
  seedFolder("Finance", {
    ...Object.fromEntries(
      Object.entries(REGIONS).map(([region, total]) => [
        `q3-${region}.csv`,
        quarterRows(region, total, q3),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(REGIONS).map(([region, total]) => [
        `q2-${region}.csv`,
        quarterRows(region, Math.round(total * 0.9), q2),
      ]),
    ),
    "README.txt":
      "Quarterly revenue by region, one CSV per region and quarter.\n",
  });
}

const comparedWestAndEast: Assertion = {
  check: (ctx) => {
    const text = "answered that West beat East in Q3, with West's total";
    const after = saidAfter(ctx, "west beat east");
    return /412[,.\s]?35|412(?:\.\d)?\s?k/i.test(after) && /west/i.test(after)
      ? pass(text, after.slice(0, 160))
      : fail(
          text,
          after.slice(0, 160) || "nothing said after the last fragment",
        );
  },
  text: "answered that West beat East in Q3, with West's total",
};

// ---------------------------------------------------------------------------
// correction: the file's form changes while it is being made
// ---------------------------------------------------------------------------

const ACTIONS = [
  ["Nadia", "send the venue contract to legal"],
  ["Owen", "book the photographer for the 14th"],
  ["Farah", "draft the welcome email"],
  ["Gus", "order lanyards for 120 guests"],
  ["Lines", "confirm the catering headcount"],
  ["Pavel", "test the livestream audio"],
] as const;

function seedMeetingNotes() {
  seedFolder(
    "Meeting Notes",
    Object.fromEntries(
      ACTIONS.map(([owner, action], index) => [
        `2026-09-${String(10 + index * 3).padStart(2, "0")}-planning.md`,
        `# Planning sync\n\nWe went over the offsite timeline and the open questions on the budget.\n\nAction item: ${owner} will ${action}.\n\nNext sync in three days.\n`,
      ]),
    ),
  );
}

const madeTheChecklist: Assertion = {
  check: () => {
    const text =
      "actions.md in Meeting Notes is a checklist of every action item";
    const dir = path.join(HOME, "Documents", "Meeting Notes");
    const body = readText(path.join(dir, "actions.md"));
    if (body === "") {
      return fail(
        text,
        `no actions.md; folder has ${fs.readdirSync(dir).join(", ")}`,
      );
    }
    const checks = body.match(/^\s*[-*] \[ \]/gm)?.length ?? 0;
    const missing = ACTIONS.filter(([owner]) => !body.includes(owner)).map(
      ([owner]) => owner,
    );
    const evidence = `${checks} checkboxes; missing ${missing.join(", ") || "none"}; actions.txt ${fs.existsSync(path.join(dir, "actions.txt")) ? "also there" : "absent"}`;
    return checks >= ACTIONS.length && missing.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "actions.md in Meeting Notes is a checklist of every action item",
};

// ---------------------------------------------------------------------------
// added step: a total row asked for while the table is being made
// ---------------------------------------------------------------------------

const INVOICES = [
  ["2026-08-02", "Corbel Print Shop", 182.4],
  ["2026-08-09", "Northwind Coffee", 64.75],
  ["2026-08-15", "Halvard Electric", 410],
  ["2026-08-21", "Pine & Pail Cleaning", 225.5],
  ["2026-08-28", "Corbel Print Shop", 96.1],
  ["2026-09-03", "Tallis Web Hosting", 39],
  ["2026-09-11", "Halvard Electric", 288.35],
  ["2026-09-19", "Northwind Coffee", 71.2],
] as const;

const INVOICE_TOTAL = INVOICES.reduce((sum, [, , amount]) => sum + amount, 0);

function seedInvoices() {
  seedFolder(
    "Invoices",
    Object.fromEntries(
      INVOICES.map(([date, vendor, amount], index) => [
        `invoice-${index + 1}.txt`,
        `INVOICE\nVendor: ${vendor}\nDate: ${date}\nAmount due: $${amount.toFixed(2)}\n`,
      ]),
    ),
  );
}

const madeTheTableWithTotal: Assertion = {
  check: () => {
    const text = `invoices.csv lists all ${INVOICES.length} and ends in a total of ${INVOICE_TOTAL.toFixed(2)}`;
    const body = readText(
      path.join(HOME, "Documents", "Invoices", "invoices.csv"),
    );
    if (body === "") {
      return fail(text, "no invoices.csv");
    }
    const rows = body.trim().split("\n");
    const listed = INVOICES.filter(([date]) => body.includes(date)).length;
    const last = rows.at(-1) ?? "";
    const totalLine = rows.find((row) => /total/i.test(row)) ?? "";
    const hasTotal = totalLine
      .replaceAll(",", "")
      .includes(INVOICE_TOTAL.toFixed(2));
    const evidence = `${listed}/${INVOICES.length} listed; total row: ${totalLine || "none"}; last row: ${last}`;
    return listed === INVOICES.length && hasTotal
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: `invoices.csv lists all ${INVOICES.length} and ends in a total of ${INVOICE_TOTAL.toFixed(2)}`,
};

// ---------------------------------------------------------------------------
// later wish: "no spoilers" arrives while the plot is being read
// ---------------------------------------------------------------------------

const CHAPTERS = [
  "Mara leaves the coast town with her grandfather's maps and a borrowed mule.",
  "At the first salt pan she meets a trader who swears the old road is cursed.",
  "A storm drives the caravan into the ruins of a waystation full of carved names.",
  "Mara finds a map drawn in a hand she almost recognizes, marked with her name.",
  "The trader vanishes with the water, and the caravan turns on itself.",
  "In the high pass Mara follows the strange map's markings to a hidden spring.",
  "The mapmaker waiting at the spring is revealed as her lost twin, Ilse, alive all along.",
];

const SPOILER = /\b(twin|ilse)\b/i;

function seedBookClub() {
  seedFolder("Book Club", {
    "the-salt-road.md": `# The Salt Road\n\n${CHAPTERS.map((summary, index) => `## Chapter ${index + 1}\n\n${summary} ${"The wind kept on, and the road went on with it. ".repeat(40)}\n`).join("\n")}`,
  });
}

const keptTheEnding: Assertion = {
  check: (ctx) => {
    const text = "never told the user the ending after they said no spoilers";
    const after = saidAfter(ctx, "no spoilers");
    const leaked = SPOILER.exec(after);
    return leaked
      ? fail(text, `said "${leaked[0]}"`)
      : pass(text, after.slice(0, 160) || "said nothing more");
  },
  text: "never told the user the ending after they said no spoilers",
};

const answeredTheLength: Assertion = {
  check: (ctx) => {
    const text = "said how many chapters the story has (7)";
    const after = saidAfter(ctx, "no spoilers");
    return /\b(7|seven)\b/i.test(after)
      ? pass(text, after.slice(0, 160))
      : fail(text, after.slice(0, 160) || "said nothing more");
  },
  text: "said how many chapters the story has (7)",
};

// ---------------------------------------------------------------------------
// stop: a plain "stop" mid-job
// ---------------------------------------------------------------------------

const STOP = "stop";

const stoppedPromptly: Assertion = {
  check: async (ctx) => {
    const text = "nothing kept working on the scans 15 seconds after stop";
    const stopAt = sentAt(ctx.sessions, STOP);
    if (stopAt === undefined) {
      return fail(text, "stop was never sent");
    }
    const lateSteps = (await agents(ctx)).flatMap((agent) =>
      agent.sessions.flatMap((session) =>
        session.messages.flatMap((message) =>
          message.role === "assistant" &&
          !message.metadata.inherited &&
          message.metadata.createdAt.getTime() > stopAt + 15_000 &&
          message.parts.some((part) => part.type.startsWith("tool-"))
            ? [agent.name]
            : [],
        ),
      ),
    );
    const lateFiles = recentFilesUnder(
      path.join(HOME, "Documents", "Scans"),
      stopAt + 15_000,
    );
    const evidence = `tool steps after +15s: ${lateSteps.length} (${[...new Set(lateSteps)].join(", ")}); files changed after +15s: ${lateFiles.length}`;
    return lateSteps.length === 0 && lateFiles.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "nothing kept working on the scans 15 seconds after stop",
};

// ---------------------------------------------------------------------------
// holdout: an unrelated question mid-job
// ---------------------------------------------------------------------------

const answeredQuickly: Assertion = {
  check: (ctx) => {
    const text = "answered 18% of 240 (43.2)";
    const after = saidAfter(ctx, "18% of 240");
    return QUICK_ANSWER.test(after)
      ? pass(text, after.slice(0, 120))
      : fail(text, after.slice(0, 120) || "said nothing after the question");
  },
  text: "answered 18% of 240 (43.2)",
};

// ---------------------------------------------------------------------------
// holdout: a change to a service mid-call
// ---------------------------------------------------------------------------

const BEACON: AppFixture = { kind: "mcp", name: "Beacon", slug: "beacon" };

const CREATED_ISSUE = new RegExp(
  createdIssueUrl("BCN-0")
    .replace("BCN-0", String.raw`(BCN-\d+)`)
    .replaceAll(".", "\\."),
  "g",
);

const filedOneIssue: Assertion = {
  check: async (ctx) => {
    const text = "filed exactly one issue in Beacon";
    const ids = new Set(
      (await agents(ctx)).flatMap((agent) =>
        ownToolParts(agent).flatMap((part) =>
          [...part.matchAll(CREATED_ISSUE)].map((match) => match[1]),
        ),
      ),
    );
    const evidence = `${ids.size} filed: ${[...ids].join(", ") || "none"}`;
    return ids.size === 1 ? pass(text, evidence) : fail(text, evidence);
  },
  text: "filed exactly one issue in Beacon",
};

// ---------------------------------------------------------------------------
// holdout: the month corrected while the counting runs
// ---------------------------------------------------------------------------

const ORDER_COUNTS = { "2026-09": 37, "2026-10": 52 };

function seedOrders() {
  const rows = Object.entries(ORDER_COUNTS).flatMap(([month, count]) =>
    Array.from(
      { length: count },
      (_, index) =>
        `${month}-${String((index % 28) + 1).padStart(2, "0")},ORD-${month.slice(5)}${String(index + 1).padStart(3, "0")},${(19 + ((index * 7) % 60)).toFixed(2)}`,
    ),
  );
  seedFolder("Orders", {
    "orders.csv": `date,order,amount\n${rows.join("\n")}\n`,
  });
}

const countedSeptember: Assertion = {
  check: (ctx) => {
    const text = `gave September's count (${ORDER_COUNTS["2026-09"]}) after the correction`;
    const after = saidAfter(ctx, "meant September");
    return new RegExp(`\\b${ORDER_COUNTS["2026-09"]}\\b`).test(after)
      ? pass(text, after.slice(0, 160))
      : fail(text, after.slice(0, 160) || "said nothing after the correction");
  },
  text: `gave September's count (${ORDER_COUNTS["2026-09"]}) after the correction`,
};

// ---------------------------------------------------------------------------

const INTERRUPTIONS: Interruption[] = [
  {
    assertions: [
      comparedWestAndEast,
      noWorkDoneTwice(/q3-(?:east|west|central)\.csv/, "the Q3 files"),
    ],
    followUps: [
      { duringWork: { afterToolCalls: 1 }, prompt: "the regional ones" },
      { afterMs: 5000, prompt: "mostly i want to know if west beat east" },
    ],
    prompt: "did the Q3 numbers come in? should be in Documents/Finance",
    sent: "Finance",
    setup: seedFinance,
    slug: "interrupt-fragments",
  },
  {
    assertions: [
      madeTheChecklist,
      noWorkDoneTwice(/planning\.md/, "the meeting notes"),
    ],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt: "actually make it actions.md, as a markdown checklist",
      },
    ],
    prompt:
      "Pull the action items out of the notes in Documents/Meeting Notes into one file, actions.txt, in that folder.",
    sent: "Meeting Notes",
    setup: seedMeetingNotes,
    slug: "interrupt-correction",
  },
  {
    assertions: [
      madeTheTableWithTotal,
      noWorkDoneTwice(/invoice-\d+\.txt/, "the invoices"),
    ],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt: "and put a total row at the bottom too",
      },
    ],
    prompt:
      "Make invoices.csv in Documents/Invoices with each invoice's date, vendor, and amount.",
    sent: "Invoices",
    setup: seedInvoices,
    slug: "interrupt-added-step",
  },
  {
    assertions: [
      keptTheEnding,
      answeredTheLength,
      noWorkDoneTwice(/the-salt-road\.md/, "the story"),
    ],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt:
          "wait, no spoilers, I'm not done with it. just how many chapters is it and roughly how long",
      },
    ],
    prompt:
      "what happens in the story in Documents/Book Club? give me the whole plot",
    sent: "Book Club",
    setup: seedBookClub,
    slug: "interrupt-later-wish",
  },
  {
    assertions: [stoppedPromptly],
    followUps: [{ duringWork: { afterToolCalls: 1 }, prompt: STOP }],
    prompt:
      "The scans in Documents/Scans have useless names. Rename each from what's inside it to date-kind-sender.txt, like 2026-01-05-invoice-corbel-print-shop.txt, right there in that folder.",
    sent: "Scans",
    setup: seedScans,
    slug: "interrupt-stop",
  },
  {
    assertions: [answeredQuickly, renamedTheScans],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt: "unrelated, quick: what's 18% of 240?",
      },
    ],
    prompt:
      "The scans in Documents/Scans have useless names. Rename each from what's inside it to date-kind-sender.txt, like 2026-01-05-invoice-corbel-print-shop.txt, right there in that folder.",
    sent: "Scans",
    setup: seedScans,
    slug: "holdout-unrelated",
  },
  {
    apps: [BEACON],
    assertions: [filedOneIssue],
    followUps: [
      { duringWork: { afterToolCalls: 1 }, prompt: "put it on Aiko" },
    ],
    prompt: "File a bug in Beacon: the export button does nothing in Safari.",
    setup: () => undefined,
    slug: "holdout-issue",
  },
  {
    assertions: [
      countedSeptember,
      noWorkDoneTwice(/orders\.csv/, "orders.csv"),
    ],
    followUps: [
      { duringWork: { afterToolCalls: 1 }, prompt: "sorry, I meant September" },
    ],
    prompt:
      "How many orders did we get in October? It's orders.csv in Documents/Orders.",
    sent: "Orders",
    setup: seedOrders,
    slug: "holdout-month",
  },
];

export const INTERRUPTION_EVALS = INTERRUPTIONS.map(toEval);
