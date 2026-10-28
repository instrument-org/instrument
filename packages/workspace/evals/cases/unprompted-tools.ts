/**
 * Does the chat reach for its own tools when nobody names them, and does the
 * job still get done?
 *
 * Each case is a job typed the way a person types it, never naming a tool:
 * research long enough for a background task with a quick question while it
 * runs, a printable code a skill covers, earlier work to pick up, a folder the
 * chat does not reach, a small build in parts, two short jobs at once, a
 * folder of many files, and a read across 200 files
 * long enough to outlast a quick question asked partway through. This is a
 * measurement, not a target: each case scores the outcome, and `toolsChosen`
 * records which of the tools it used (tasks, the browser, skills, reading
 * other chats' records, `ask_permission`) as evidence without scoring it, so a
 * run that does the job without them passes.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ensureChat } from "../../src/lib/chat/chat-records";
import { chatOutputFolder } from "../../src/lib/chat/output-folder";
import { workDir } from "../../src/lib/work-dir";
import { ChatWrites } from "../../src/lib/chat-writes";
import { shellPath } from "../../src/lib/workspace-fs-layout";
import { type Session } from "../../src/schemas/session";
import { StoreId } from "../../src/schemas/store-id";
import { type Assertion, defineEval } from "../harness";
import {
  answeredTheQuickQuestion,
  type Context,
  fail,
  HOME,
  pass,
  QUICK_ANSWER,
  readText,
  recentFilesUnder,
  runStartedAt,
  said,
  treeSessions,
  workspaceFolder,
} from "./handoff";

// ---------------------------------------------------------------------------
// Reading a run back
// ---------------------------------------------------------------------------

/** Every bash command a set of sessions ran, oldest first. */
function commandsIn(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-bash" && typeof part.input?.command === "string"
          ? [part.input.command]
          : [],
      ),
    ),
  );
}

function count(commands: string[], pattern: RegExp): number {
  return commands.reduce(
    (sum, command) => sum + [...command.matchAll(pattern)].length,
    0,
  );
}

/**
 * Which of the measured tools the run chose, across the chat and its tasks.
 * Always passes: the choice is the finding, and the evidence carries it.
 */
const toolsChosen: Assertion = {
  check: async (ctx) => {
    const text = "tools chosen (recorded, not scored)";
    const children = await ctx.childSessions();
    const tree = await treeSessions(ctx);
    const commands = commandsIn(tree);
    const chatCalls = ctx.sessions
      .flatMap((session) => session.messages)
      .flatMap((message) => message.parts)
      .filter((part) => part.type.startsWith("tool-")).length;
    const parts = tree
      .flatMap((session) => session.messages)
      .flatMap((message) => message.parts);
    const skills = parts.flatMap((part) =>
      part.type === "tool-load_skill" && part.input?.name
        ? [part.input.name]
        : [],
    );
    const tally = {
      "task new": count(commands, /(?:^|[\n;&|])\s*instrument task new\b/g),
      "task send": count(commands, /(?:^|[\n;&|])\s*instrument task send\b/g),
      "task stop": count(commands, /(?:^|[\n;&|])\s*instrument task stop\b/g),
      "task list/log": count(
        commands,
        /(?:^|[\n;&|])\s*instrument task (?:list|log)\b/g,
      ),
      browser: count(commands, /\bagent-browser\b/g),
      window: count(
        commands,
        /(?:^|[\n;&|])\s*instrument (?:window show|tab (?:open|show|replace))\b/g,
      ),
      web_fetch: parts.filter((part) => part.type === "tool-web_fetch").length,
      "chat records": count(
        commands,
        /\bINSTRUMENT_CHATS\b|\.instrument\/chats\b/g,
      ),
      "permission asks": parts.filter(
        (part) => part.type === "tool-ask_permission",
      ).length,
    };
    const used = Object.entries(tally)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name}=${String(n)}`);
    return pass(
      text,
      [
        ...used,
        skills.length > 0 ? `skills=${skills.join("+")}` : "",
        `tasks=${String(children.length)}`,
        `chatCalls=${String(chatCalls)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  },
  text: "tools chosen (recorded, not scored)",
};

/**
 * Files the run wrote, wherever it put them. Assertions are scored once the
 * whole suite has run, so a file counts only between this run's first
 * message and its tree's last, or a later case's output would pass for it.
 */
async function filesWritten(
  ctx: Context,
  extra: string[] = [],
): Promise<string[]> {
  const since = runStartedAt(ctx.sessions);
  const until =
    Math.max(
      ...(await treeSessions(ctx))
        .flatMap((session) => session.messages)
        .map((message) =>
          Math.max(
            message.metadata.createdAt.getTime(),
            "finishedAt" in message.metadata && message.metadata.finishedAt
              ? message.metadata.finishedAt.getTime()
              : 0,
          ),
        ),
    ) + 2000;
  const files = new Set(
    [HOME, workDir(ctx.chatId), chatOutputFolder(ctx.chatId), ...extra].flatMap(
      (dir) => recentFilesUnder(dir, since),
    ),
  );
  return [...files].filter((file) => fs.statSync(file).mtimeMs <= until);
}

/** Text files the run wrote, with what they hold. */
async function writtenTexts(
  ctx: Context,
  extra: string[] = [],
): Promise<{ body: string; file: string }[]> {
  return (await filesWritten(ctx, extra))
    .filter((file) =>
      /\.(?:md|txt|csv|tsv|html?|json|py|ts|js|mjs|svg)$/i.test(file),
    )
    .map((file) => ({ body: readText(file), file }));
}

function replies(ctx: Context): string {
  return said(ctx.sessions)
    .map((one) => one.text)
    .join("\n");
}

function short(file: string): string {
  return path.relative(HOME, file).startsWith("..")
    ? path.basename(file)
    : path.relative(HOME, file);
}

// ---------------------------------------------------------------------------
// research-then-quick: a long research job, then an unrelated quick question
// ---------------------------------------------------------------------------

const GENERATORS = [
  /\bHugo\b/,
  /\bJekyll\b/,
  /\bGatsby\b/,
  /\bEleventy\b|\b11ty\b/,
  /\bAstro\b/,
  /\bHexo\b/,
  /\bDocusaurus\b/,
  /\bZola\b/,
  /\bVitePress\b/,
  /\bMkDocs\b/,
  /\bNext\.?js\b/,
  /\bNuxt\b/,
  /\bPelican\b/,
  /\bSphinx\b/,
  /\bStarlight\b/,
];

/** The comparison, in a file or in the reply: the user asked for neither. */
const comparedFiveGenerators: Assertion = {
  check: async (ctx) => {
    const text = "compared at least five generators, in a file or the reply";
    const best = [
      ...(await writtenTexts(ctx)),
      { body: replies(ctx), file: "(reply)" },
    ]
      .map((one) => ({
        ...one,
        named: GENERATORS.filter((name) => name.test(one.body)).length,
      }))
      .toSorted((a, b) => b.named - a.named)[0];
    return best && best.named >= 5 && best.body.length >= 800
      ? pass(
          text,
          `${short(best.file)}: ${String(best.named)} named, ${String(best.body.length)} chars`,
        )
      : fail(
          text,
          best
            ? `best ${short(best.file)}: ${String(best.named)} named`
            : "nothing",
        );
  },
  text: "compared at least five generators, in a file or the reply",
};

// ---------------------------------------------------------------------------
// wifi-qr: a printable code, which the barcodes skill covers
// ---------------------------------------------------------------------------

const madeAnImage: Assertion = {
  check: async (ctx) => {
    const text = "made a PNG or SVG of the code";
    const images = (await filesWritten(ctx))
      .filter((file) => /\.(?:png|svg)$/i.test(file))
      .filter((file) => {
        const head = fs.readFileSync(file).subarray(0, 512);
        return (
          head.subarray(1, 4).toString() === "PNG" ||
          head.toString("utf8").includes("<svg")
        );
      });
    return images.length > 0
      ? pass(text, images.map(short).join(", "))
      : fail(text, "no image written");
  },
  text: "made a PNG or SVG of the code",
};

// ---------------------------------------------------------------------------
// lease-pickup: earlier work, in a chat this one does not list
// ---------------------------------------------------------------------------

const LEASE_DIR = () => path.join(workspaceFolder(), "Lease");

const LEASE = `# Residential Lease: 418 Alder Street, Apt 3B

## 1. Term
Twelve months, from November 1, 2026 to October 31, 2027.

## 2. Rent
$2,450 per month, due on the 1st. A late fee of $75 applies after the 5th.

## 3. Security deposit
$2,450, returned within 21 days of move-out, less itemized deductions.

## 4. Pets
One cat or one dog under 30 pounds, with the landlord's written approval and a $300 refundable pet deposit. No other animals.

## 5. Subletting
No subletting or assignment without the landlord's prior written consent, which will not be unreasonably withheld. Short-term rentals (under 30 days) are prohibited.

## 6. Early termination
The tenant may end the lease early with 60 days' written notice and an early termination fee equal to two months' rent ($4,900).

## 7. Maintenance
The tenant handles light bulbs and smoke detector batteries; the landlord handles everything else within 7 days of a written request.
`;

const LEASE_SUMMARY = `# Lease summary: 418 Alder Street, Apt 3B

- **Term:** 12 months, Nov 1, 2026 to Oct 31, 2027.
- **Rent:** $2,450/month, due the 1st; $75 late fee after the 5th.
- **Deposit:** $2,450, back within 21 days of move-out, less itemized deductions.
`;

async function saveSeeded(
  chatId: Awaited<ReturnType<typeof ensureChat>>,
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  text: string,
  at: Date,
) {
  const id = StoreId.newMessageId();
  const parts = [
    {
      metadata: {
        createdAt: at,
        id: StoreId.newPartId(),
        messageId: id,
        sessionId,
      },
      text,
      type: "text" as const,
    },
  ];
  const message =
    role === "user"
      ? {
          id,
          metadata: { createdAt: at, sessionId },
          parts,
          role: "user" as const,
        }
      : {
          id,
          metadata: {
            createdAt: at,
            finishedAt: at,
            finishReason: "stop" as const,
            modelId: "seeded",
            providerId: "seeded",
            sessionId,
          },
          parts,
          role: "assistant" as const,
        };
  (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
}

/** The lease, the summary so far, and yesterday's chat that made it. */
async function seedLease() {
  fs.mkdirSync(LEASE_DIR(), { recursive: true });
  fs.writeFileSync(path.join(LEASE_DIR(), "lease.md"), LEASE);
  fs.writeFileSync(path.join(LEASE_DIR(), "lease-summary.md"), LEASE_SUMMARY);
  const yesterday = Date.now() - 86_400_000;
  const sessionId = StoreId.newSessionId();
  const ask =
    "Can you summarize my new apartment lease? It's lease.md in the Lease folder in my workspace. Do it section by section, start with the money stuff.";
  const chatId = await ensureChat(sessionId, ask);
  await saveSeeded(chatId, sessionId, "user", ask, new Date(yesterday));
  await saveSeeded(
    chatId,
    sessionId,
    "assistant",
    `Sections 1 to 3 are summarized: a 12-month term from Nov 1, $2,450 rent due the 1st with a $75 late fee after the 5th, and a $2,450 deposit back within 21 days. Pets, subletting, and early termination are next.\n\n\`\`\`files\n${shellPath(path.join(LEASE_DIR(), "lease-summary.md"))}\n\`\`\``,
    new Date(yesterday + 40_000),
  );
  await saveSeeded(
    chatId,
    sessionId,
    "user",
    "ok I have to run, let's finish the rest tomorrow",
    new Date(yesterday + 90_000),
  );
  await saveSeeded(
    chatId,
    sessionId,
    "assistant",
    "Sounds good.",
    new Date(yesterday + 95_000),
  );
}

const finishedTheLease: Assertion = {
  check: async (ctx) => {
    const text =
      "covered pets, subletting, and early termination with the lease's numbers";
    const sources = [
      ...(await writtenTexts(ctx)).map((one) => one.body),
      replies(ctx),
    ];
    const hit = sources.find(
      (body) =>
        /\$?300\b/.test(body) &&
        /sublet/i.test(body) &&
        /4,?900|two months/i.test(body),
    );
    return hit
      ? pass(text, hit.slice(0, 200))
      : fail(
          text,
          `nothing written or said had all three; replies: ${replies(ctx).slice(0, 200)}`,
        );
  },
  text: "covered pets, subletting, and early termination with the lease's numbers",
};

const keptTheEarlierSections: Assertion = {
  check: () => {
    const text = "the summary file still has the first three sections";
    const body = readText(path.join(LEASE_DIR(), "lease-summary.md"));
    const others = fs
      .readdirSync(LEASE_DIR())
      .filter((name) => name !== "lease.md")
      .map((name) => readText(path.join(LEASE_DIR(), name)));
    const kept = [body, ...others].some(
      (one) => /2,?450/.test(one) && /\$?300\b/.test(one),
    );
    return kept
      ? pass(text, "a summary in Lease/ holds rent and the pet deposit")
      : fail(text, body.slice(0, 200) || "no lease-summary.md");
  },
  text: "the summary file still has the first three sections",
};

// ---------------------------------------------------------------------------
// outside-folder: invoices in a folder the chat does not reach
// ---------------------------------------------------------------------------

/**
 * Outside every folder the chat reaches. On a Mac, the machine's shared
 * folder, since a path under the run's temp home reads to the model as
 * scratch space rather than somewhere a person keeps invoices; elsewhere,
 * beside the run's home. Read-only fixture, the same in every run.
 */
const INVOICES_DIR = () =>
  process.platform === "darwin"
    ? path.join("/Users/Shared", "Acme Invoices")
    : path.join(path.dirname(HOME), "Shared Drive", "Acme", "Invoices");

const INVOICES: { amount: number; client: string; number: number }[] = [
  { amount: 1200, client: "Northwind", number: 1041 },
  { amount: 850.5, client: "Bluefin Labs", number: 1042 },
  { amount: 2300, client: "Northwind", number: 1043 },
  { amount: 475, client: "Cedar & Co", number: 1044 },
  { amount: 1999.99, client: "Bluefin Labs", number: 1045 },
  { amount: 640, client: "Cedar & Co", number: 1046 },
  { amount: 3150, client: "Northwind", number: 1047 },
  { amount: 920, client: "Bluefin Labs", number: 1048 },
  { amount: 1385.25, client: "Cedar & Co", number: 1049 },
];

function seedInvoices() {
  fs.mkdirSync(INVOICES_DIR(), { recursive: true });
  for (const invoice of INVOICES) {
    fs.writeFileSync(
      path.join(INVOICES_DIR(), `INV-${String(invoice.number)}.txt`),
      `INVOICE ${String(invoice.number)}\nBill to: ${invoice.client}\nDate: 2026-09-${String(invoice.number - 1030)}\n\nConsulting services\nAmount due: $${invoice.amount.toFixed(2)}\n`,
    );
  }
}

const totaledEachClient: Assertion = {
  check: async (ctx) => {
    const text = "gave the right total for each client";
    const totals = new Map<string, number>();
    for (const invoice of INVOICES) {
      totals.set(
        invoice.client,
        (totals.get(invoice.client) ?? 0) + invoice.amount,
      );
    }
    const haystack = [
      replies(ctx),
      ...(await writtenTexts(ctx)).map((one) => one.body),
    ]
      .join("\n")
      .replaceAll(",", "");
    const missing = [...totals].filter(([, total]) => {
      const fixed = total.toFixed(2);
      const whole = fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
      return (
        !haystack.includes(fixed) &&
        !new RegExp(`\\b${whole.replace(".", "\\.")}\\b`).test(haystack)
      );
    });
    return missing.length === 0
      ? pass(
          text,
          [...totals].map(([c, t]) => `${c} ${t.toFixed(2)}`).join(", "),
        )
      : fail(
          text,
          `missing ${missing.map(([c, t]) => `${c} ${t.toFixed(2)}`).join(", ")}`,
        );
  },
  text: "gave the right total for each client",
};

// ---------------------------------------------------------------------------
// sales-demo: a script, its data, and a report with a chart
// ---------------------------------------------------------------------------

const builtTheDemo: Assertion = {
  check: async (ctx) => {
    const text = "made the script, a year of CSV data, a report, and a chart";
    const all = await filesWritten(ctx);
    const texts = await writtenTexts(ctx);
    const script = all.find((file) => /\.(?:py|ts|js|mjs)$/.test(file));
    const csv = texts.find(
      (one) =>
        one.file.endsWith(".csv") &&
        one.body.split("\n").length >= 365 &&
        /Downtown/.test(one.body),
    );
    const report = all.find(
      (file) =>
        /\.(?:md|html?|pdf|docx)$/i.test(file) &&
        (/\.(?:pdf|docx)$/i.test(file) || /Airport/.test(readText(file))),
    );
    const chart =
      all.find((file) => /\.(?:png|svg|jpe?g)$/i.test(file)) ??
      texts.find((one) =>
        /```mermaid|<svg|<canvas|chart\.js|plotly/i.test(one.body),
      )?.file;
    const parts = { chart, csv: csv?.file, report, script };
    const missing = Object.entries(parts)
      .filter(([, file]) => !file)
      .map(([name]) => name);
    return missing.length === 0
      ? pass(
          text,
          Object.entries(parts)
            .map(([name, file]) => `${name} ${short(file ?? "")}`)
            .join(", "),
        )
      : fail(text, `missing ${missing.join(", ")}`);
  },
  text: "made the script, a year of CSV data, a report, and a chart",
};

// ---------------------------------------------------------------------------
// two-jobs: a file and a quick answer in one message
// ---------------------------------------------------------------------------

const madeTheCapitals: Assertion = {
  check: async (ctx) => {
    const text = "wrote a CSV of the 50 state capitals";
    const csv = (await writtenTexts(ctx)).find(
      (one) =>
        one.file.endsWith(".csv") &&
        /Sacramento/.test(one.body) &&
        /Montpelier/.test(one.body) &&
        one.body.trim().split("\n").length >= 50,
    );
    return csv
      ? pass(
          text,
          `${short(csv.file)}: ${String(csv.body.trim().split("\n").length)} lines`,
        )
      : fail(text, "no CSV with the capitals");
  },
  text: "wrote a CSV of the 50 state capitals",
};

const countedToChristmas: Assertion = {
  check: async (ctx) => {
    const text = "said how many days until Christmas";
    const start = new Date(runStartedAt(ctx.sessions));
    const today = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    let christmas = new Date(start.getFullYear(), 11, 25);
    if (christmas < today) {
      christmas = new Date(start.getFullYear() + 1, 11, 25);
    }
    const days = Math.round(
      (christmas.getTime() - today.getTime()) / 86_400_000,
    );
    const reply = replies(ctx);
    const ok = [days - 1, days, days + 1].some((n) =>
      new RegExp(`\\b${String(n)}\\s+days\\b`).test(reply),
    );
    return (ok ? pass : fail)(
      text,
      `expected ${String(days)}; ${reply.slice(0, 200)}`,
    );
  },
  text: "said how many days until Christmas",
};

// ---------------------------------------------------------------------------
// meeting-index: a folder of thirty notes to index
// ---------------------------------------------------------------------------

const NOTES_DIR = () => path.join(HOME, "Documents", "Meeting Notes");
const PEOPLE = ["Priya", "Marcus", "Elena", "Tom"];
const TOPICS = [
  "pricing page",
  "onboarding emails",
  "Q4 roadmap",
  "support backlog",
  "mobile release",
  "hiring plan",
];

function noteDates(): string[] {
  const first = Date.UTC(2026, 7, 3);
  return Array.from({ length: 30 }, (_, i) =>
    new Date(first + i * 2 * 86_400_000).toISOString().slice(0, 10),
  );
}

function seedNotes() {
  fs.mkdirSync(NOTES_DIR(), { recursive: true });
  noteDates().forEach((date, i) => {
    const topic = TOPICS[i % TOPICS.length] ?? "";
    const there = PEOPLE.filter((_, p) => (i + p) % 4 !== 3);
    const owner = there[i % there.length] ?? "";
    fs.writeFileSync(
      path.join(NOTES_DIR(), `${date} sync.md`),
      `# Sync on ${date}\n\nPresent: ${there.join(", ")}\n\nWe went over the ${topic}. ${owner} walked through where it stands and the open questions.\n\n${i % 3 === 0 ? `Decided: ship the ${topic} changes by end of month.\n\n` : ""}Next steps:\n- ${owner} to draft the ${topic} update\n- ${there[(i + 1) % there.length] ?? ""} to review it by Friday\n`,
    );
  });
}

const indexedTheNotes: Assertion = {
  check: async (ctx) => {
    const text =
      "an index covering 28+ of the 30 meetings and a per-person checklist";
    const texts = (await writtenTexts(ctx, [NOTES_DIR()])).filter(
      (one) => !one.file.endsWith(" sync.md"),
    );
    const dates = noteDates();
    const index = texts
      .map((one) => ({
        ...one,
        covered: dates.filter((date) => {
          const [y, m, d] = date.split("-").map(Number);
          const month = new Date(
            Date.UTC(y ?? 0, (m ?? 1) - 1, d),
          ).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
          return (
            one.body.includes(date) ||
            new RegExp(`${month}\\w* ${String(d)}\\b`).test(one.body)
          );
        }).length,
      }))
      .toSorted((a, b) => b.covered - a.covered)[0];
    const checklist = texts.find((one) =>
      PEOPLE.every((person) =>
        new RegExp(
          `^#+.*${person}|\\*\\*${person}\\*\\*|^${person}:?$`,
          "m",
        ).test(one.body),
      ),
    );
    return index && index.covered >= 28 && checklist
      ? pass(
          text,
          `${short(index.file)} covers ${String(index.covered)}; checklist ${short(checklist.file)}`,
        )
      : fail(
          text,
          `${index ? `${short(index.file)} covers ${String(index.covered)}` : "no index"}; ${checklist ? short(checklist.file) : "no per-person checklist"}`,
        );
  },
  text: "an index covering 28+ of the 30 meetings and a per-person checklist",
};

// ---------------------------------------------------------------------------
// inspection-report: a long read across 200 files, then a quick question
// ---------------------------------------------------------------------------

const INSPECTIONS_DIR = () => path.join(HOME, "Documents", "Site Inspections");
const SITES = [
  "Alder Street",
  "Bayview Depot",
  "Cedar Mill",
  "Dockside",
  "Eastgate",
  "Foundry Row",
  "Granite Yard",
  "Harbor Point",
];

/**
 * 200 reports, 25 to a site, each written by a model as its own prose; the
 * 25 marked `unsafe` describe the `finding` in the writer's words, spread
 * across the sites, and the rest mostly say outright that nothing was unsafe.
 */
const InspectionsSchema = z.array(
  z.object({
    body: z.string(),
    date: z.string(),
    finding: z.string().optional(),
    inspector: z.string(),
    number: z.string(),
    site: z.string(),
    unsafe: z.boolean(),
  }),
);

function inspections(): z.output<typeof InspectionsSchema> {
  return InspectionsSchema.parse(
    JSON.parse(
      readText(
        path.resolve(import.meta.dirname, "../fixtures/site-inspections.json"),
      ),
    ),
  );
}

function seedInspections() {
  fs.mkdirSync(INSPECTIONS_DIR(), { recursive: true });
  for (const one of inspections()) {
    fs.writeFileSync(
      path.join(INSPECTIONS_DIR(), `${one.number}.txt`),
      `Inspection ${one.number}\nSite: ${one.site}\nDate: ${one.date}\nInspector: ${one.inspector}\n\n${one.body}\n`,
    );
  }
}

const reportedTheInspections: Assertion = {
  check: async (ctx) => {
    const text =
      "a report naming 23+ of the 25 unsafe inspections and the 25-per-site counts";
    const plan = inspections();
    const unsafe = plan.filter((one) => one.unsafe).map((one) => one.number);
    const report = (await writtenTexts(ctx, [INSPECTIONS_DIR()]))
      .filter((one) => !/INS-\d+\.txt$/.test(one.file))
      .map((one) => ({
        ...one,
        named: unsafe.filter((number) => one.body.includes(number)).length,
        wrong: plan.filter((p) => !p.unsafe && one.body.includes(p.number))
          .length,
      }))
      .toSorted((a, b) => b.named - b.wrong - (a.named - a.wrong))[0];
    const body = report?.body ?? replies(ctx);
    const named =
      report?.named ?? unsafe.filter((n) => body.includes(n)).length;
    const counted = SITES.every((site) =>
      new RegExp(`${site}[^\\n]{0,40}\\b25\\b`).test(body),
    );
    const evidence = `${report ? short(report.file) : "reply"}: ${String(named)}/${String(unsafe.length)} unsafe named${report ? `, ${String(report.wrong)} safe named` : ""}, per-site counts ${counted ? "right" : "missing or wrong"}`;
    return named >= unsafe.length - 2 && counted
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "a report naming 23+ of the 25 unsafe inspections and the 25-per-site counts",
};

// ---------------------------------------------------------------------------

export const UNPROMPTED_TOOL_EVALS = [
  defineEval({
    assertions: [comparedFiveGenerators, answeredTheQuickQuestion, toolsChosen],
    followUps: [
      { afterMs: 15_000, prompt: "unrelated, quick: what's 18% of 240?" },
    ],
    kind: "chat",
    marks: [{ after: "18% of 240", match: QUICK_ANSWER, name: "quick answer" }],
    name: "unprompted-research-then-quick",
    prompt:
      "We're picking a static site generator for our docs. Can you compare the five most popular ones for me? GitHub stars, language, latest release, and what each is best at.",
  }),
  defineEval({
    assertions: [madeAnImage, toolsChosen],
    kind: "chat",
    name: "unprompted-wifi-qr",
    prompt:
      "Can you make a QR code for our guest wifi so people can scan it to join? Network is Harbor Guest, password tidepool-42. I want to print it and stick it on the fridge.",
  }),
  defineEval({
    assertions: [finishedTheLease, keptTheEarlierSections, toolsChosen],
    kind: "chat",
    name: "unprompted-lease-pickup",
    prompt: "pick up where we left off on the lease summary",
    setup: seedLease,
  }),
  defineEval({
    assertions: [totaledEachClient, toolsChosen],
    allowsFolders: 1,
    kind: "chat",
    name: "unprompted-outside-folder",
    get prompt() {
      return `Can you total up the invoices in ${INVOICES_DIR()} by client? Accounting needs the numbers today.`;
    },
    setup: seedInvoices,
  }),
  defineEval({
    assertions: [builtTheDemo, toolsChosen],
    kind: "chat",
    name: "unprompted-sales-demo",
    prompt:
      "I need a quick demo for a meeting: a script that makes up a year of daily sales for three stores (Downtown, Airport, Mall), the data saved as a CSV, and a short report with monthly totals per store and a chart. Put it all in a folder in my workspace.",
  }),
  defineEval({
    assertions: [madeTheCapitals, countedToChristmas, toolsChosen],
    kind: "chat",
    name: "unprompted-two-jobs",
    prompt:
      "two things: make me a CSV of all the US state capitals in my workspace folder, and how many days until Christmas?",
  }),
  defineEval({
    assertions: [indexedTheNotes, toolsChosen],
    folders: [{ inPlace: true, path: NOTES_DIR() }],
    kind: "chat",
    name: "unprompted-meeting-index",
    prompt:
      "These are my meeting notes from the last two months. Can you make me an index, one line per meeting with the date, who was there, and any decision, and pull every action item into a checklist grouped by person?",
    setup: seedNotes,
  }),
  defineEval({
    assertions: [reportedTheInspections, answeredTheQuickQuestion, toolsChosen],
    folders: [{ inPlace: true, path: INSPECTIONS_DIR() }],
    followUps: [
      { afterMs: 20_000, prompt: "unrelated, quick: what's 18% of 240?" },
    ],
    kind: "chat",
    marks: [{ after: "18% of 240", match: QUICK_ANSWER, name: "quick answer" }],
    name: "unprompted-inspection-report",
    prompt:
      "These are this quarter's site inspection reports, about 200 of them. Can you go through them and write me a report: how many inspections each site had, and every visit where the inspector found something unsafe, with the report number and what it was?",
    setup: seedInspections,
  }),
];
