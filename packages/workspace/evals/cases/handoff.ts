/**
 * Does handing work from the chat to a task cost the user anything, and is
 * one agent that keeps the work better at the root?
 *
 * The chat (`src/agents/instrument.ts`) delegates nearly everything to task
 * agents (`src/agents/main.ts`), and a task sees only the brief the chat
 * writes: never the user's words, their memories, or their topic's
 * instructions. Every scenario here is a failure seen in real use, or an ask
 * real use is full of, and each runs as several arms from one definition, so
 * the prompt, the fixtures, and the assertions are the same and only the
 * route differs:
 *
 * - **a, today:** the user's words go to the chat, which delegates.
 * - **c, one agent:** a, with the process opted into the one-agent
 *   prototype (`INSTRUMENT_EVAL_ONE_AGENT=1`), which does quick work itself
 *   and forks slow work.
 * - **d, one agent in the foreground:** c with no background at all
 *   (`INSTRUMENT_EVAL_ONE_AGENT=foreground`).
 * - **e, today with a fuller hand-off:** a, with tasks also given the user's
 *   own words, memories and topic instructions
 *   (`INSTRUMENT_EVAL_TASK_CONTEXT=1`).
 * - **f, one agent that forks on interrupt:** c, where a message the user
 *   sends mid-turn forks the turn's work to the background instead of
 *   ending it (`INSTRUMENT_EVAL_ONE_AGENT=fork-on-interrupt`).
 * - **g, fork only:** one agent whose only tasks are forks in the chat's
 *   folder, with a prompt of its own and fork on interrupt
 *   (`INSTRUMENT_EVAL_ONE_AGENT=fork-only`).
 * - **h, fork only, called background:** g, where the agent's word for
 *   that work is "background" and its command is `background`
 *   (`INSTRUMENT_EVAL_ONE_AGENT=background`).
 * - **b, direct** and **v, direct in the chat's voice:** round one's arms,
 *   which showed a task without the chat's context fails. Kept runnable, off
 *   by default in `evals/handoff-matrix.ts`.
 *
 * Every assertion reads the outcome (a file on disk, a figure the user was
 * shown, how long they waited for an answer), never the wording of a brief.
 *
 * Fixtures are made in the run's home by each case's `setup`, and the
 * workspace folder is the home's, so two runs in one process see each
 * other's files. Run each case in a process of its own with its own
 * `INSTRUMENT_EVAL_HOME`, which `evals/handoff-matrix.ts` does, setting each
 * arm's switch.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { instrumentAgent } from "../../src/agents/instrument";
import { AGENT_MESSAGE_LANGUAGE } from "../../src/constants";
import { outputFolderPath } from "../../src/lib/chat/output-folder";
import { memoryDir, saveMemory } from "../../src/lib/memory/store";
import { isToolPart } from "../../src/lib/is-tool-part";
import { taskDir } from "../../src/lib/task-dir-utils";
import { getTaskState } from "../../src/lib/task-record";
import { type Session } from "../../src/schemas/session";
import { type TaskId } from "../../src/schemas/task-id";
import {
  type Assertion,
  type AssertionResult,
  defineEval,
  type EvalCase,
} from "../harness";
import { sheetHasAChart, sheetRecomputes, wroteADocument } from "./worker";

type Context = Parameters<Assertion["check"]>[0];

/** The sandbox home: `evals/lib/sandbox-home` has set `$HOME` by now. */
const HOME = os.homedir();

/** The folder results go to when nobody said where. */
const WORKSPACE = outputFolderPath();

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

// ---------------------------------------------------------------------------
// Reading a run back
// ---------------------------------------------------------------------------

interface Said {
  at: number;
  text: string;
}

/** The run's own assistant text, oldest first: what the user read. */
function said(sessions: Session.WithMessagesAndParts[]): Said[] {
  return sessions
    .flatMap((session) =>
      session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" && part.text.trim() !== ""
              ? [{ at: message.metadata.createdAt.getTime(), text: part.text }]
              : [],
          ),
        ),
    )
    .toSorted((a, b) => a.at - b.at);
}

/** When the user sent a message containing `words`, if they did. */
function sentAt(
  sessions: Session.WithMessagesAndParts[],
  words: string,
): number | undefined {
  for (const session of sessions) {
    for (const message of session.messages) {
      if (
        message.role === "user" &&
        message.parts.some(
          (part) => part.type === "text" && part.text.includes(words),
        )
      ) {
        return message.metadata.createdAt.getTime();
      }
    }
  }
  return undefined;
}

/** The last thing the run said, joined across the final turn's text parts. */
function lastReply(sessions: Session.WithMessagesAndParts[]): string {
  return said(sessions).at(-1)?.text ?? "";
}

/** Every task folder in the run's tree, the run's own first. */
async function treeDirs({ childSessions, taskId }: Context): Promise<string[]> {
  const children = await childSessions();
  return [taskId, ...children.map((child) => child.taskId)].map((id) =>
    taskDir(id),
  );
}

/**
 * When the user's first message was sent. Fixtures are made before it and
 * everything the run writes comes after, and it is on record, so a run
 * re-scored later from its workspace draws the line in the same place.
 */
function runStartedAt(sessions: Session.WithMessagesAndParts[]): number {
  const sent = sessions.flatMap((session) =>
    session.messages
      .filter((message) => message.role === "user")
      .map((message) => message.metadata.createdAt.getTime()),
  );
  return sent.length > 0 ? Math.min(...sent) : 0;
}

/**
 * Files under `dir` changed since `since`, skipping hidden folders and a
 * task's `attachments`, which hold what the user sent rather than anything
 * the run made.
 */
function recentFilesUnder(dir: string, since: number, depth = 6): string[] {
  const found: string[] = [];
  const walk = (at: string, level: number) => {
    if (level > depth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "attachments"
      ) {
        continue;
      }
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (at === HOME && entry.name === "Library") {
          continue;
        }
        walk(full, level + 1);
      } else if (fs.statSync(full).mtimeMs >= since) {
        found.push(full);
      }
    }
  };
  walk(dir, 0);
  return found;
}

/** Every file the run could have written, wherever it put it. */
async function writtenFiles(ctx: Context): Promise<string[]> {
  const dirs = [HOME, ...(await treeDirs(ctx))];
  const since = runStartedAt(ctx.sessions);
  return [...new Set(dirs.flatMap((dir) => recentFilesUnder(dir, since)))];
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Where a folder the case sent was attached for this run. */
async function attachedFolder(
  taskId: TaskId,
  name: string,
): Promise<string | undefined> {
  const state = await getTaskState(taskDir(taskId));
  return Object.values(state.attachedFolders ?? {}).find(
    (folder) => path.basename(folder.path) === name,
  )?.path;
}

/** The text a reader sees in a page, rather than its markup. */
function visibleText(body: string): string {
  return body
    .replaceAll(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&deg;|&#176;/g, "°")
    .replaceAll(/\s+/g, " ");
}

/** Lowercase, Markdown punctuation and runs of space gone, for comparing prose. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[*_#>`"'’“”]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A one-page PDF holding `lines` as real text, small enough to write by hand:
 * five objects and an xref table whose offsets are counted as it is built.
 */
function pdf(lines: string[]): Buffer {
  const escape = (text: string) => text.replaceAll(/[\\()]/g, (m) => `\\${m}`);
  const content = [
    "BT",
    "/F1 12 Tf",
    "16 TL",
    "72 740 Td",
    ...lines.map((line) => `(${escape(line)}) '`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Writes a file and backdates it, since the order of mtimes is the fixture. */
function writeAged(file: string, body: Buffer | string, ageMs: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const at = new Date(Date.now() - ageMs);
  fs.utimesSync(file, at, at);
}

/**
 * The three newest PDFs are all in subfolders, and each carries a word no
 * other one does, so a summary can be traced to its source.
 */
const RECENT_PDFS = [
  {
    file: "Work/Q4 Planning/Roadmap Review.pdf",
    marker: "Halcyon",
    lines: [
      "Roadmap Review: Project Halcyon",
      "The Halcyon team reviewed the fourth-quarter roadmap.",
      "Two features slip to January: offline sync and the admin console.",
      "Hiring: one designer and two backend engineers by November.",
      "Risk: the payments vendor contract renews on December 1.",
    ],
  },
  {
    file: "Receipts/Dentist Receipt.pdf",
    marker: "Brightwater",
    lines: [
      "Brightwater Dental - Patient Receipt",
      "Cleaning and exam, two bitewing X-rays.",
      "Total charged: $186.00. Insurance pending: $142.00.",
      "Next visit recommended in six months.",
    ],
  },
  {
    file: "School/Field Trip Permission.pdf",
    marker: "Ostrava",
    lines: [
      "Field Trip Permission Slip: Ostrava Science Center",
      "Grade 4 visits the Ostrava Science Center on a Friday morning.",
      "Bus leaves at 8:15 and returns by 2:30. Cost is $12 per student.",
      "Return the signed slip by Wednesday.",
    ],
  },
];

const OLDER_PDFS = [
  ["Lease Renewal Notice.pdf", "Maplewood Apartments lease renewal notice."],
  [
    "Flight Itinerary.pdf",
    "Itinerary: BNA to SEA, seat 14C, confirmation QX7P2.",
  ],
  ["Invoice 1043.pdf", "Invoice 1043 from Corbel Print Shop, $420 due net 30."],
  ["Tax Summary 2025.pdf", "Summary of 2025 estimated tax payments."],
  ["Warranty Card.pdf", "Two-year warranty for a Velox stand mixer."],
  ["Recipe - Lemon Bars.pdf", "Lemon bars: shortbread base, lemon curd top."],
  ["Receipts/Hardware Store.pdf", "Receipt from Dalton Hardware, $38.12."],
] as const;

function seedDownloads() {
  const downloads = path.join(HOME, "Downloads");
  fs.rmSync(downloads, { force: true, recursive: true });
  RECENT_PDFS.forEach(({ file, lines }, index) => {
    writeAged(
      path.join(downloads, file),
      pdf(lines),
      (index + 1) * 0.5 * DAY_MS,
    );
  });
  OLDER_PDFS.forEach(([file, line], index) => {
    writeAged(
      path.join(downloads, file),
      pdf([file.replace(/\.pdf$/, ""), line]),
      (index + 3) * DAY_MS,
    );
  });
  // Newer than everything, and not a PDF.
  writeAged(
    path.join(downloads, "Work/notes.txt"),
    "Call the vendor back.\n",
    60_000,
  );
}

/** Subscribe-and-save is the cheapest per ounce for every product used. */
const PRICE_LIST = [
  "product,size_oz,one_time_price,subscribe_and_save_price",
  "Harbor Body Wash,16,9.79,8.32",
  "Harbor Body Wash,32,16.89,13.51",
  "Harbor Conditioner,12,8.69,7.39",
  "Harbor Conditioner,33.8,18.79,15.03",
  "Harbor Shampoo,12,8.59,7.30",
  "Harbor Shampoo,33.8,18.49,14.79",
  "Harbor Hand Lotion,16,11.29,9.60",
  "Harbor Deodorant,2.6,6.49,5.52",
].join("\n");

/**
 * Figures only the subscription column produces: its prices for the three
 * products asked about, and per-ounce rates from 40 to 47 cents, in dollars
 * or cents, which no one-time price comes near (the cheapest is 53).
 */
const SUBSCRIPTION_FIGURES =
  /\b(?:13\.51|15\.03|14\.79|8\.32|7\.39|7\.30)\b|(?:(?:\$|\b0)?\.4[0-7]\d*|\b4[0-7](?:\.\d+)?\s*(?:¢|cents?))\s*(?:\/|per|an?|each)\s*(?:fl\.?\s*)?oz/i;

const FIELD_NOTES: Record<string, string> = {
  "Budget Draft v2.csv": "line,amount\nTravel,1200\nEquipment,640\n",
  "ClientList.csv": "name,city\nOrchard Labs,Austin\nPike & Co,Denver\n",
  "Meeting Notes March.md": "# March meeting\n\nAgreed the visit order.\n",
  "photo_shoot_plan.txt": "Golden hour at the east lot, then interiors.\n",
  "Q3 Roadmap.md": "# Q3\n\n- Finish site surveys\n- Draft report\n",
  "Site Visit - Austin.md": "# Austin\n\nParking is behind the warehouse.\n",
};

const FIELD_NOTES_README =
  "# Field Notes\n\nShared notes from the spring site visits.\n";

/** Old name to the kebab-case name the user meant. */
const KEBAB_NAMES: Record<string, string> = {
  "Budget Draft v2.csv": "budget-draft-v2.csv",
  "ClientList.csv": "client-list.csv",
  "Meeting Notes March.md": "meeting-notes-march.md",
  "photo_shoot_plan.txt": "photo-shoot-plan.txt",
  "Q3 Roadmap.md": "q3-roadmap.md",
  "Site Visit - Austin.md": "site-visit-austin.md",
};

function seedFieldNotes() {
  const dir = path.join(HOME, "Documents", "Field Notes");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), FIELD_NOTES_README);
  for (const [name, body] of Object.entries(FIELD_NOTES)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
}

/** Amounts whose total is known exactly: 4,318.57. */
const EXPENSES = [
  ["2026-07-02", "Corbel Print Shop", "Printing", "412.50"],
  ["2026-07-05", "Dalton Hardware", "Supplies", "38.12"],
  ["2026-07-09", "Northline Air", "Travel", "689.40"],
  ["2026-07-11", "Copperleaf Cafe", "Meals", "54.85"],
  ["2026-07-18", "Studio Rent", "Rent", "1500.00"],
  ["2026-07-23", "Pixelworks", "Software", "129.00"],
  ["2026-08-01", "Northline Air", "Travel", "512.33"],
  ["2026-08-07", "Copperleaf Cafe", "Meals", "61.20"],
  ["2026-08-14", "Dalton Hardware", "Supplies", "97.64"],
  ["2026-08-21", "Pixelworks", "Software", "129.00"],
  ["2026-09-03", "Corbel Print Shop", "Printing", "288.75"],
  ["2026-09-12", "Harbor Couriers", "Shipping", "143.78"],
  ["2026-09-26", "Copperleaf Cafe", "Meals", "80.00"],
  ["2026-09-30", "Westgate Storage", "Rent", "80.00"],
] as const;

const EXPENSES_TOTAL = EXPENSES.reduce(
  (sum, [, , , amount]) => sum + Math.round(Number(amount) * 100),
  0,
);

const NOTES_MD = [
  "# Q3 offsite notes",
  "",
  "We agreed to move the launch review to October.",
  "",
  "## Action items",
  "",
  "- Book the Copperleaf back room",
  "- Send the budget to finance",
  "- Draft the customer survey",
  "",
].join("\n");

function seedQ3Books() {
  const dir = path.join(HOME, "Documents", "Q3 Books");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "expenses.csv"),
    `date,vendor,category,amount\n${EXPENSES.map((row) => row.join(",")).join("\n")}\n`,
  );
  fs.writeFileSync(path.join(dir, "notes.md"), NOTES_MD);
}

/** Fifty days of logs across the turn of a year, with known step counts. */
const STEP_LOGS = Array.from({ length: 50 }, (_, index) => {
  const date = new Date(Date.UTC(2024, 11, 3) + index * 1.5 * DAY_MS);
  const iso = date.toISOString().slice(0, 10);
  return { iso, steps: 4000 + ((index * 7919) % 9000) };
});

function seedStepLogs() {
  const dir = path.join(HOME, "Documents", "Step Logs");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const { iso, steps } of STEP_LOGS) {
    fs.writeFileSync(
      path.join(dir, `${iso}.txt`),
      `Daily log for ${iso}\nsteps: ${steps}\nsleep: 7h\nmood: fine\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** A file of this name in the workspace folder, with enough in it to read. */
function inWorkspace(
  name: RegExp,
  { minChars, minParagraphs = 1 }: { minChars: number; minParagraphs?: number },
): Assertion {
  const text = `wrote ${name.source} in the workspace folder, at least ${minChars} characters`;
  return {
    check: ({ sessions }) => {
      const since = runStartedAt(sessions);
      const files = recentFilesUnder(WORKSPACE, since, 2).filter((file) =>
        name.test(path.basename(file)),
      );
      const evidence = files
        .map((file) => {
          const body = readText(file);
          const paragraphs = body
            .split(/\n\s*\n/)
            .filter((one) => one.trim().length > 40).length;
          return { body, file, paragraphs };
        })
        .find(
          (one) =>
            one.body.length >= minChars && one.paragraphs >= minParagraphs,
        );
      return evidence
        ? pass(
            text,
            `${path.relative(HOME, evidence.file)}: ${evidence.body.length} chars, ${evidence.paragraphs} paragraphs`,
          )
        : fail(
            text,
            files.length > 0
              ? `${files.map((file) => `${path.basename(file)} ${readText(file).length} chars`).join(", ")}`
              : `nothing matching in the workspace folder; the run wrote: ${recentFilesUnder(
                  HOME,
                  since,
                )
                  .map((file) => path.relative(HOME, file))
                  .join(", ")}`,
          );
    },
    text,
  };
}

/** Every session in the run's tree: its own, then each task's. */
async function treeSessions(ctx: Context) {
  const children = await ctx.childSessions();
  return [...ctx.sessions, ...children.flatMap((child) => child.sessions)];
}

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;

/**
 * The email the user was shown before asking for it to be saved: the body of
 * the last message card in those replies, or else the last file written
 * before then (a task shows a draft as a file), or else the longest reply.
 */
async function draftShown(ctx: Context, before: number) {
  const replies = said(ctx.sessions).filter((one) => one.at < before);
  const fence = new RegExp(
    "```" + AGENT_MESSAGE_LANGUAGE + "\\n([\\s\\S]*?)```",
    "g",
  );
  const card = replies
    .flatMap((one) =>
      [...one.text.matchAll(fence)].map((match) => match[1] ?? ""),
    )
    .at(-1);
  if (card !== undefined) {
    return { draft: card.replace(FRONT_MATTER, ""), from: "a message card" };
  }
  const written = (await treeSessions(ctx))
    .flatMap((session) => session.messages)
    .filter((message) => message.metadata.createdAt.getTime() < before)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "tool-write_file" &&
        typeof part.input?.content === "string"
          ? [
              {
                at: message.metadata.createdAt.getTime(),
                content: part.input.content,
              },
            ]
          : [],
      ),
    )
    .toSorted((a, b) => a.at - b.at)
    .at(-1);
  if (written) {
    return { draft: written.content.replace(FRONT_MATTER, ""), from: "a file" };
  }
  const longest = replies.toSorted((a, b) => b.text.length - a.text.length)[0];
  return longest ? { draft: longest.text, from: "a reply" } : undefined;
}

const savedTheDraftShown: Assertion = {
  check: async (ctx) => {
    const text = "the saved file holds the draft the user was shown";
    const before = sentAt(ctx.sessions, "Now save that email");
    const shown =
      before === undefined ? undefined : await draftShown(ctx, before);
    const lines = (shown?.draft ?? "")
      .split("\n")
      .map((line) => normalize(line))
      .filter((line) => line.length >= 15);
    if (!shown || lines.length === 0) {
      return fail(text, "no draft was shown before the save was asked for");
    }
    const files = recentFilesUnder(
      WORKSPACE,
      runStartedAt(ctx.sessions),
      2,
    ).filter((file) => /\.(?:md|markdown)$/i.test(file));
    if (files.length === 0) {
      return fail(text, "no Markdown file in the workspace folder");
    }
    const best = files
      .map((file) => {
        const body = normalize(readText(file));
        return {
          file,
          found: lines.filter((line) => body.includes(line)).length,
        };
      })
      .toSorted((a, b) => b.found - a.found)[0];
    const evidence = `${best ? path.basename(best.file) : "?"} carries ${best?.found ?? 0}/${lines.length} lines of the draft shown in ${shown.from}`;
    return best && best.found >= Math.ceil(lines.length * 0.8)
      ? pass(text, evidence)
      : fail(
          text,
          `${evidence}; draft: ${JSON.stringify(shown.draft.slice(0, 300))}; file: ${JSON.stringify(readText(best?.file ?? "").slice(0, 300))}`,
        );
  },
  text: "the saved file holds the draft the user was shown",
};

/** Files under the first folder named like `name`, wherever the run made it. */
async function folderNamed(ctx: Context, name: RegExp) {
  const files = await writtenFiles(ctx);
  const dirs = [
    ...new Set(
      files
        .map((file) => path.dirname(file))
        .filter((dir) => name.test(path.basename(dir))),
    ),
  ];
  return dirs.map((dir) => ({
    dir,
    files: files.filter((file) => path.dirname(file) === dir),
  }));
}

const PDF_SUMMARIES = /^pdf[\s_-]?summaries$/i;

const wroteThreeSummaries: Assertion = {
  check: async (ctx) => {
    const text = "wrote three summaries into a PDF summaries folder";
    const folders = await folderNamed(ctx, PDF_SUMMARIES);
    const best = folders.toSorted((a, b) => b.files.length - a.files.length)[0];
    const evidence = best
      ? `${path.relative(HOME, best.dir)}: ${best.files.map((file) => path.basename(file)).join(", ")}`
      : "no PDF summaries folder";
    return best && best.files.length >= 3
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "wrote three summaries into a PDF summaries folder",
};

const summarizedTheRightPdfs: Assertion = {
  check: async (ctx) => {
    const text = "the summaries are of the three most recent PDFs";
    const folders = await folderNamed(ctx, PDF_SUMMARIES);
    // A summary written as a PDF is compressed, so its name is what can be
    // read; one written as text is read whole. Compared with everything but
    // letters and digits gone, so "roadmap-review-summary.pdf" names
    // "Roadmap Review.pdf".
    const squash = (value: string) =>
      value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const corpus = squash(
      folders
        .flatMap(({ files }) => files)
        .map((file) => `${path.basename(file)}\n${readText(file)}`)
        .join("\n"),
    );
    const names = (file: string) =>
      corpus.includes(squash(path.basename(file, ".pdf")));
    const missing = RECENT_PDFS.filter(
      ({ file, marker }) => !corpus.includes(squash(marker)) && !names(file),
    ).map(({ file }) => path.basename(file));
    const wrong = OLDER_PDFS.filter(([file]) => names(file)).map(([file]) =>
      path.basename(file),
    );
    return missing.length === 0 && wrong.length === 0
      ? pass(text, "Roadmap Review, Dentist Receipt, Field Trip Permission")
      : fail(
          text,
          `missing ${missing.join(", ") || "none"}; older ones summarized: ${wrong.join(", ") || "none"}`,
        );
  },
  text: "the summaries are of the three most recent PDFs",
};

const toldWhichPdfs: Assertion = {
  check: ({ sessions }) => {
    const text = "the reply named the three picks";
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n")
      .toLowerCase();
    const named = (stem: string, marker: string) =>
      reply.includes(stem.toLowerCase()) ||
      reply.includes(marker.toLowerCase());
    const missing = RECENT_PDFS.filter(
      ({ file, marker }) => !named(path.basename(file, ".pdf"), marker),
    ).map(({ file }) => path.basename(file));
    return missing.length === 0
      ? pass(text, "all three named")
      : fail(text, `not named: ${missing.join(", ")}`);
  },
  text: "the reply named the three picks",
};

/** What the user can read: every reply and every text file the run wrote. */
async function readableCorpus(ctx: Context): Promise<string> {
  const files = (await writtenFiles(ctx)).filter((file) =>
    /\.(?:md|html?|txt|csv)$/i.test(file),
  );
  return [
    ...said(ctx.sessions).map((one) => one.text),
    ...files.map((file) => visibleText(readText(file))),
  ].join("\n");
}

const weighedSubscriptionPrices: Assertion = {
  check: async (ctx) => {
    const text = "the cart uses or weighs the subscribe-and-save prices";
    const corpus = await readableCorpus(ctx);
    const figure = SUBSCRIPTION_FIGURES.exec(corpus)?.[0];
    return figure
      ? pass(text, `quotes the subscription figure ${figure}`)
      : fail(
          text,
          /subscri/i.test(corpus)
            ? "mentions subscribing but quotes no subscription price"
            : "never mentions the subscription prices",
        );
  },
  text: "the cart uses or weighs the subscribe-and-save prices",
};

const namedTheProducts: Assertion = {
  check: async (ctx) => {
    const text = "the cart has body wash, conditioner, and shampoo";
    const corpus = (await readableCorpus(ctx)).toLowerCase();
    const missing = ["body wash", "conditioner", "shampoo"].filter(
      (product) => !corpus.includes(product),
    );
    return missing.length === 0
      ? pass(text, "all three")
      : fail(text, `missing ${missing.join(", ")}`);
  },
  text: "the cart has body wash, conditioner, and shampoo",
};

const renamedToKebabCase: Assertion = {
  check: async ({ taskId }) => {
    const text =
      "renamed every file but the README to kebab case, contents intact";
    const dir = await attachedFolder(taskId, "Field Notes");
    if (!dir) {
      return fail(text, "the Field Notes folder is not attached");
    }
    const present = fs.readdirSync(dir).filter((name) => !name.startsWith("."));
    const wanted = [...Object.values(KEBAB_NAMES), "README.md"].toSorted();
    const problems = Object.entries(KEBAB_NAMES).flatMap(([from, to]) => {
      const original = FIELD_NOTES[from];
      if (!present.includes(to)) {
        return [`no ${to}`];
      }
      return readText(path.join(dir, to)) === original ? [] : [`${to} changed`];
    });
    const extra = present.filter((name) => !wanted.includes(name));
    return problems.length === 0 && extra.length === 0
      ? pass(text, present.toSorted().join(", "))
      : fail(
          text,
          `${[...problems, ...extra.map((name) => `unexpected ${name}`)].join("; ")} (folder: ${present.join(", ")})`,
        );
  },
  text: "renamed every file but the README to kebab case, contents intact",
};

const listedOldNamesInReadme: Assertion = {
  check: async ({ taskId }) => {
    const text =
      "the README is untouched but for a list of the old names at the bottom";
    const dir = await attachedFolder(taskId, "Field Notes");
    const readme = dir ? readText(path.join(dir, "README.md")) : "";
    if (!readme) {
      return fail(text, "no README.md");
    }
    const original = FIELD_NOTES_README.trimEnd();
    if (!readme.startsWith(original)) {
      return fail(
        text,
        `the original text changed: ${JSON.stringify(readme.slice(0, 200))}`,
      );
    }
    const added = readme.slice(original.length);
    const missing = Object.keys(KEBAB_NAMES).filter(
      (name) => !added.includes(name),
    );
    // A table of old and new names is as much a list as bullets are.
    const listed = added
      .split("\n")
      .filter((line) =>
        Object.keys(KEBAB_NAMES).some((name) => line.includes(name)),
      );
    return missing.length === 0 &&
      listed.length >= Object.keys(KEBAB_NAMES).length
      ? pass(text, `${listed.length} entries added`)
      : fail(
          text,
          `missing ${missing.join(", ") || "none"}, ${listed.length} list items: ${JSON.stringify(added.slice(0, 300))}`,
        );
  },
  text: "the README is untouched but for a list of the old names at the bottom",
};

/** Words that say the numbers are not live. */
const DISCLAIMS =
  /sample|placeholder|example|illustrative|mock|fake|dummy|demo|not (?:live|real)|unavailable|not available|could(?:n't| not)|unable|offline|no (?:live|internet|network|web)|can(?:'t|not) (?:access|reach|fetch|get|load)/i;

/**
 * Every temperature any tool in the tree brought back: a search result, a
 * fetched page, a command's output. A figure the user is shown is sourced
 * when it is one of these, or one converted between scales.
 */
async function sourcedTemperatures(ctx: Context): Promise<Set<number>> {
  const sourced = new Set<number>();
  for (const session of await treeSessions(ctx)) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolPart(part) || part.state !== "output-available") {
          continue;
        }
        for (const value of temperaturesIn(JSON.stringify(part.output))) {
          sourced.add(value);
          sourced.add(Math.round((value * 9) / 5 + 32));
          sourced.add(Math.round(((value - 32) * 5) / 9));
        }
      }
    }
  }
  return sourced;
}

function temperaturesIn(text: string): number[] {
  return [
    ...text.matchAll(
      /(-?\d{1,3}(?:\.\d)?)\s*(?:°|º|\\u00b0|degrees\b|°?\s*[FC]\b)/gi,
    ),
  ].map((match) => Math.round(Number(match[1])));
}

/** Pages and replies, by name, with what a reader sees in each. */
async function shownDocuments(ctx: Context) {
  const files = (await writtenFiles(ctx)).filter((file) =>
    /\.(?:html?|md)$/i.test(file),
  );
  return [
    ...files.map((file) => ({
      body: visibleText(readText(file)),
      name: path.basename(file),
    })),
    ...said(ctx.sessions).map((one, index) => ({
      body: one.text,
      name: `reply ${index + 1}`,
    })),
  ];
}

/**
 * Within a degree of something a tool returned. Search here is the plan's
 * own, and live, so the case scores whether what is shown came from
 * somewhere rather than whether anything could be found.
 */
const noFabricatedConditions: Assertion = {
  check: async (ctx) => {
    const text =
      "every temperature shown came from data the run retrieved, or is marked as not live";
    const sourced = await sourcedTemperatures(ctx);
    const near = (value: number) =>
      [value - 1, value, value + 1].some((one) => sourced.has(one));
    const offending = (await shownDocuments(ctx)).flatMap(({ body, name }) => {
      const unsourced = temperaturesIn(body).filter((value) => !near(value));
      return unsourced.length > 0 && !DISCLAIMS.test(body)
        ? [`${name}: ${[...new Set(unsourced)].join(", ")}`]
        : [];
    });
    return offending.length === 0
      ? pass(
          text,
          `${sourced.size} temperatures retrieved; nothing shown beyond them`,
        )
      : fail(text, `unsourced, undisclaimed: ${offending.join("; ")}`);
  },
  text: "every temperature shown came from data the run retrieved, or is marked as not live",
};

const saidWhenDataWasMissing: Assertion = {
  check: async (ctx) => {
    const text = "said so when live weather could not be had";
    const sourced = await sourcedTemperatures(ctx);
    if (sourced.size > 0) {
      return pass(text, "the run retrieved live data");
    }
    const corpus = await readableCorpus(ctx);
    const match =
      /unavailable|not available|could(?:n't| not) (?:get|fetch|reach|access|load|pull|retrieve)|unable to (?:get|fetch|reach|access|load|pull|retrieve)|no (?:live|internet|network|web) |can(?:'t|not) (?:access|reach|fetch|get|load|pull)|placeholder|sample data/i.exec(
        corpus,
      );
    return match ? pass(text, `"${match[0]}"`) : fail(text, "nothing says so");
  },
  text: "said so when live weather could not be had",
};

function money(cents: number): [string, string] {
  const fixed = (cents / 100).toFixed(2);
  return [
    fixed,
    Number(fixed).toLocaleString("en-US", { minimumFractionDigits: 2 }),
  ];
}

const totaledTheExpenses: Assertion = {
  check: async (ctx) => {
    const text = `said the expenses total ${money(EXPENSES_TOTAL)[1]}`;
    const corpus = await readableCorpus(ctx);
    const found = money(EXPENSES_TOTAL).find((figure) =>
      corpus.includes(figure),
    );
    return found
      ? pass(text, `says ${found}`)
      : fail(text, JSON.stringify(lastReply(ctx.sessions).slice(0, 300)));
  },
  text: `said the expenses total ${money(EXPENSES_TOTAL)[1]}`,
};

const convertedTheNotes: Assertion = {
  check: async ({ taskId }) => {
    const text = "converted notes.md to an HTML file in the folder";
    const dir = await attachedFolder(taskId, "Q3 Books");
    const pages = dir
      ? fs.readdirSync(dir).filter((name) => /\.html?$/i.test(name))
      : [];
    const good = pages.find((name) => {
      const body = readText(path.join(dir ?? "", name));
      return (
        /<h[12]/i.test(body) && /<li/i.test(body) && body.includes("Copperleaf")
      );
    });
    return good
      ? pass(text, good)
      : fail(
          text,
          pages.length > 0
            ? `${pages.join(", ")} lack the headings or list`
            : "no HTML file in the folder",
        );
  },
  text: "converted notes.md to an HTML file in the folder",
};

const steppedOnlyThroughTheCorrection: Assertion = {
  check: async ({ taskId }) => {
    const text =
      "the step table holds exactly the 2025 days, with their counts";
    const dir = await attachedFolder(taskId, "Step Logs");
    const tables = dir
      ? fs
          .readdirSync(dir)
          .filter((name) => /\.csv$/i.test(name))
          .map((name) => path.join(dir, name))
          .toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      : [];
    const newest = tables[0];
    if (!newest) {
      return fail(text, "no CSV in the Step Logs folder");
    }
    const rows = readText(newest)
      .split("\n")
      .flatMap((line) => {
        const match = /(\d{4}-\d{2}-\d{2})\D+?(\d[\d,]*)/.exec(line);
        return match
          ? [
              {
                iso: match[1] ?? "",
                steps: Number((match[2] ?? "").replaceAll(",", "")),
              },
            ]
          : [];
      });
    const wanted = STEP_LOGS.filter(({ iso }) => iso.startsWith("2025"));
    const missing = wanted.filter(
      (want) =>
        !rows.some((row) => row.iso === want.iso && row.steps === want.steps),
    );
    const stray = rows.filter((row) => !row.iso.startsWith("2025"));
    const evidence = `${path.basename(newest)}: ${rows.length} rows, ${missing.length} of ${wanted.length} 2025 days missing or wrong, ${stray.length} from other years`;
    return missing.length === 0 && stray.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "the step table holds exactly the 2025 days, with their counts",
};

const wroteTheGroceryList: Assertion = {
  check: ({ sessions }) => {
    const since = runStartedAt(sessions);
    const text =
      "wrote groceries.md in the workspace folder as a checklist of all four";
    const file = path.join(WORKSPACE, "groceries.md");
    const body = readText(file).toLowerCase();
    if (!body) {
      return fail(
        text,
        `no groceries.md; the run wrote: ${recentFilesUnder(HOME, since)
          .map((one) => path.relative(HOME, one))
          .join(", ")}`,
      );
    }
    const missing = ["eggs", "milk", "coffee", "banana"].filter(
      (item) => !body.includes(item),
    );
    const boxes = (body.match(/\[ \]/g) ?? []).length;
    return missing.length === 0 && boxes >= 4
      ? pass(text, `${boxes} boxes`)
      : fail(text, `missing ${missing.join(", ") || "none"}, ${boxes} boxes`);
  },
  text: "wrote groceries.md in the workspace folder as a checklist of all four",
};

const answeredFromMemory: Assertion = {
  check: ({ sessions }) => {
    const text = "answered with the Home Assistant address from memory";
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n");
    return reply.includes("10.0.4.27:8124")
      ? pass(text, JSON.stringify(lastReply(sessions).slice(0, 200)))
      : fail(text, JSON.stringify(lastReply(sessions).slice(0, 300)));
  },
  text: "answered with the Home Assistant address from memory",
};

// ---------------------------------------------------------------------------
// Round two: fixtures and assertions
// ---------------------------------------------------------------------------

/** When the user sent the message containing `words`, or the run's start. */
function sentAtOr(sessions: Session.WithMessagesAndParts[], words: string) {
  return sentAt(sessions, words) ?? runStartedAt(sessions);
}

/** The times `EvalCase.marks` recorded for this run, by name. */
function marksFor(taskId: TaskId): Record<string, null | number> {
  try {
    const read: unknown = JSON.parse(
      fs.readFileSync(path.join(HOME, ".eval-marks", `${taskId}.json`), "utf8"),
    );
    return typeof read === "object" && read !== null
      ? Object.fromEntries(
          Object.entries(read).map(([name, value]) => [
            name,
            typeof value === "number" ? value : null,
          ]),
        )
      : {};
  } catch {
    return {};
  }
}

/** Every tool input in the tree from `since` on, as text. */
async function toolInputsSince(ctx: Context, since: number): Promise<string> {
  return (await treeSessions(ctx))
    .flatMap((session) => session.messages)
    .filter((message) => message.metadata.createdAt.getTime() >= since)
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        isToolPart(part) ? [JSON.stringify(part.input ?? "")] : [],
      ),
    )
    .join("\n");
}

const IDEAS = [
  "a balcony herb garden",
  "a monthly book swap with neighbors",
  "learning to bake sourdough",
  "a family recipe archive",
  "a weekend bike route map",
  "a podcast about local history",
  "a reading nook in the spare room",
  "a habit tracker on paper",
  "a board game night",
  "a photo walk around downtown",
  "a compost bin for the yard",
  "a budget for a winter trip",
  "a playlist for focused work",
  "a letter to an old friend",
  "a tool library for the street",
  "a home emergency kit",
  "a beginner pottery class",
  "a bird feeder by the window",
  "a digital photo cleanup",
  "a meal prep Sunday routine",
  "a running plan for a 10K",
  "a garage reorganization",
  "a kids' science afternoon",
  "a gratitude journal",
  "a neighborhood cleanup day",
  "a guide to local hiking trails",
  "a spice rack overhaul",
  "a weekly phone-free evening",
  "a houseplant care chart",
  "a family movie list",
];

/** Thirty or more notes in a folder called Ideas, wherever the run made it. */
const madeThirtyNotes: Assertion = {
  check: async (ctx) => {
    const text = "made 30 notes files in an Ideas folder";
    const best = (await folderNamed(ctx, /^ideas$/i)).toSorted(
      (a, b) => b.files.length - a.files.length,
    )[0];
    const evidence = best
      ? `${path.relative(HOME, best.dir)}: ${best.files.length} files`
      : "no Ideas folder";
    return best && best.files.length >= IDEAS.length
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "made 30 notes files in an Ideas folder",
};

/** The preference from the first turn: a date leads every file's name. */
const namedDateFirst: Assertion = {
  check: async (ctx) => {
    const text = "named every note date first, as the user asked earlier";
    const files = (await folderNamed(ctx, /^ideas$/i)).flatMap(
      ({ files: inFolder }) => inFolder.map((file) => path.basename(file)),
    );
    if (files.length === 0) {
      return fail(text, "no notes to look at");
    }
    const off = files.filter((name) => !/^\d{4}-\d{2}-\d{2}/.test(name));
    return off.length === 0
      ? pass(text, `${files.length} names, e.g. ${files[0] ?? ""}`)
      : fail(
          text,
          `${off.length} of ${files.length} not date first, e.g. ${off.slice(0, 3).join(", ")}`,
        );
  },
  text: "named every note date first, as the user asked earlier",
};

const FEEDBACK_COUNT = 200;

const FEEDBACK_PRODUCTS = [
  "the travel mug",
  "the desk lamp",
  "the trail backpack",
  "the pour-over kettle",
  "the wool socks",
];

const FEEDBACK_SAYS = [
  "arrived a day late but works great",
  "is lighter than I expected",
  "has a lid that leaks a little",
  "came in lovely packaging",
  "stopped working after two weeks",
  "is exactly as pictured",
  "needs a longer cord",
  "has become my daily favorite",
];

const FEEDBACK_NAMES = [
  "Ana",
  "Ben",
  "Chloe",
  "Dev",
  "Elena",
  "Femi",
  "Grace",
  "Hiro",
  "Ines",
  "Jonah",
  "Kofi",
  "Lena",
  "Marco",
];

function feedbackName(index: number): string {
  return `feedback-${String(index + 1).padStart(3, "0")}.txt`;
}

function seedFeedback() {
  const dir = path.join(HOME, "Documents", "Feedback");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let index = 0; index < FEEDBACK_COUNT; index += 1) {
    const name = FEEDBACK_NAMES[index % FEEDBACK_NAMES.length] ?? "";
    const product = FEEDBACK_PRODUCTS[index % FEEDBACK_PRODUCTS.length] ?? "";
    const says = FEEDBACK_SAYS[(index * 3) % FEEDBACK_SAYS.length] ?? "";
    fs.writeFileSync(
      path.join(dir, feedbackName(index)),
      `From: ${name}\nOrder #${4100 + index}\n\nHi, ${product} ${says}. Thanks!\n`,
    );
  }
}

/** 18% of 240, written as the user would accept it: 43.2 or 43.20. */
const QUICK_ANSWER = /\b43\.20?(?!\d)/;

/** The quick question, answered within 20 seconds of being asked. */
const answeredTheQuickQuestion: Assertion = {
  check: ({ sessions, taskId }) => {
    const text = "answered 18% of 240 (43.2) within 20 seconds of being asked";
    const waited = marksFor(taskId)["quick answer"];
    if (typeof waited === "number") {
      return waited <= 20_000
        ? pass(text, `${(waited / 1000).toFixed(1)}s`)
        : fail(text, `answered after ${(waited / 1000).toFixed(1)}s`);
    }
    const asked = sentAt(sessions, "18% of 240");
    if (asked === undefined) {
      return fail(text, "the question was never sent");
    }
    // No mark: a run scored before the pattern matched how it answered.
    // The answering message's start is when its turn began, which for an
    // answer in a turn of its own is within its generation time of the
    // answer itself.
    const answer = said(sessions).find(
      (one) => one.at >= asked && QUICK_ANSWER.test(one.text),
    );
    if (!answer) {
      return fail(text, "never answered 43.2");
    }
    const waitedAbout = answer.at - asked;
    return waitedAbout <= 20_000
      ? pass(
          text,
          `about ${(waitedAbout / 1000).toFixed(1)}s, from message times`,
        )
      : fail(
          text,
          `answered after about ${(waitedAbout / 1000).toFixed(1)}s, from message times`,
        );
  },
  text: "answered 18% of 240 (43.2) within 20 seconds of being asked",
};

/** The long job finished anyway: a reply for every note. */
const repliedToEveryNote: Assertion = {
  check: async (ctx) => {
    const text = `wrote all ${FEEDBACK_COUNT} replies into a Replies folder`;
    const best = (await folderNamed(ctx, /^replies$/i)).toSorted(
      (a, b) => b.files.length - a.files.length,
    )[0];
    const real = (best?.files ?? []).filter(
      (file) => readText(file).trim().length >= 40,
    );
    const evidence = best
      ? `${path.relative(HOME, best.dir)}: ${best.files.length} files, ${real.length} with a real reply`
      : "no Replies folder";
    return real.length >= FEEDBACK_COUNT
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: `wrote all ${FEEDBACK_COUNT} replies into a Replies folder`,
};

/** A report in the folder only the topic's instructions name. */
const filedUnderQuarterly: Assertion = {
  check: async (ctx) => {
    const text =
      "put the report in a Quarterly folder, as the topic instructions say";
    const folders = await folderNamed(ctx, /^quarterly$/i);
    const report = folders
      .flatMap(({ files }) => files)
      .find(
        (file) => readText(file).length >= 300 || /\.(?:docx|pdf)$/i.test(file),
      );
    if (report) {
      return pass(text, path.relative(HOME, report));
    }
    const elsewhere = (await writtenFiles(ctx))
      .filter((file) => !file.includes(`${path.sep}.`))
      .map((file) => path.relative(HOME, file));
    return fail(
      text,
      folders.length > 0
        ? `Quarterly holds nothing report-sized: ${folders.flatMap(({ files }) => files.map((file) => path.basename(file))).join(", ")}`
        : `no Quarterly folder; the run wrote: ${elsewhere.join(", ") || "nothing"}`,
    );
  },
  text: "put the report in a Quarterly folder, as the topic instructions say",
};

const GARDEN_FILES: Record<string, string> = {
  "raised-beds.md": "# Raised beds\n\nTwo 4x8 beds along the fence.\n",
  "seed-order.csv": "seed,packets\nTomato,2\nBasil,1\n",
  "watering-schedule.txt": "Mornings, every other day.\n",
};

const KITCHEN_FILES: Record<string, string> = {
  "appliance-list.txt": "Range, dishwasher, quiet hood.\n",
  "cabinet-quotes.csv": "shop,quote\nOakline,14200\nBirch & Co,12850\n",
  "contractor-notes.md": "# Contractor\n\nStart date still open.\n",
  "tile-samples.txt": "Sage zellige, white hex, terracotta.\n",
};

function seedProjectFolders() {
  for (const [name, files] of [
    ["Garden Plans", GARDEN_FILES],
    ["Kitchen Remodel", KITCHEN_FILES],
  ] as const) {
    const dir = path.join(HOME, "Documents", name);
    fs.rmSync(dir, { force: true, recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, file), body);
    }
  }
}

/**
 * "it" is the kitchen folder, the one the user called a mess, and "to do dot
 * md" is todo.md: a checklist of that folder's files, and nothing in the
 * garden one.
 */
const madeTheKitchenTodo: Assertion = {
  check: async (ctx) => {
    const text =
      "wrote todo.md in Kitchen Remodel, listing its files, and left Garden Plans alone";
    const since = runStartedAt(ctx.sessions);
    const kitchen = path.join(HOME, "Documents", "Kitchen Remodel");
    const garden = path.join(HOME, "Documents", "Garden Plans");
    const todo = fs
      .readdirSync(kitchen)
      .find((name) => /^to[\s_-]?do\.md$/i.test(name));
    const touchedGarden = recentFilesUnder(garden, since).map((file) =>
      path.basename(file),
    );
    if (!todo) {
      const gardenTodo = touchedGarden.find((name) =>
        /to[\s_-]?do/i.test(name),
      );
      return fail(
        text,
        gardenTodo
          ? `wrote ${gardenTodo} in Garden Plans instead`
          : `no todo.md in Kitchen Remodel; the run wrote: ${recentFilesUnder(
              HOME,
              since,
            )
              .map((file) => path.relative(HOME, file))
              .join(", ")}`,
      );
    }
    const body = readText(path.join(kitchen, todo)).toLowerCase();
    // An item per file, by the file's name or the one word that says what
    // it is about: "Compare the two cabinet quotes" is cabinet-quotes.csv.
    const missing = Object.keys(KITCHEN_FILES).filter(
      (file) =>
        !body.includes(file) && !body.includes(file.split("-")[0] ?? file),
    );
    const problems = [
      ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
      ...(touchedGarden.length > 0
        ? [`changed Garden Plans: ${touchedGarden.join(", ")}`]
        : []),
    ];
    return problems.length === 0
      ? pass(text, `${todo} lists all ${Object.keys(KITCHEN_FILES).length}`)
      : fail(text, problems.join("; "));
  },
  text: "wrote todo.md in Kitchen Remodel, listing its files, and left Garden Plans alone",
};

/** Six months of sales, whose totals are known exactly. */
const SALES_MONTHS = Array.from({ length: 6 }, (_, index) => {
  const month = `2026-0${index + 1}`;
  const rows = Array.from({ length: 5 }, (__, row) => ({
    amount: ((index + 2) * 1000 + row * 137 + index * 41) / 100,
    item: ["Mugs", "Lamps", "Socks", "Kettles", "Packs"][row] ?? "",
  }));
  const cents = rows.reduce(
    (sum, row) => sum + Math.round(row.amount * 100),
    0,
  );
  return { cents, month, rows };
});

function seedSales() {
  const dir = path.join(HOME, "Documents", "Sales");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const { month, rows } of SALES_MONTHS) {
    fs.writeFileSync(
      path.join(dir, `${month}.csv`),
      `item,amount\n${rows.map((row) => `${row.item},${row.amount.toFixed(2)}`).join("\n")}\n`,
    );
  }
}

const SALES_DIR = () => path.join(HOME, "Documents", "Sales");

const totaledEachMonth: Assertion = {
  check: () => {
    const text = "wrote totals.csv in Sales with every month's total";
    const file = fs
      .readdirSync(SALES_DIR())
      .find((name) => /totals?\.csv$/i.test(name));
    if (!file) {
      return fail(text, "no totals.csv in the Sales folder");
    }
    const body = readText(path.join(SALES_DIR(), file)).replaceAll(",", " ");
    const wrong = SALES_MONTHS.filter(
      ({ cents }) =>
        !body.includes((cents / 100).toFixed(2)) &&
        !body.includes(String(cents / 100)),
    ).map(({ month }) => month);
    return wrong.length === 0
      ? pass(text, `${file} has all ${SALES_MONTHS.length}`)
      : fail(text, `${file} lacks or misstates ${wrong.join(", ")}`);
  },
  text: "wrote totals.csv in Sales with every month's total",
};

/** The second job used the first's result, rather than starting over. */
const chartedTheTotals: Assertion = {
  check: async (ctx) => {
    const text =
      "charted the totals as a PNG in Sales, working from the first job's result";
    const since = sentAtOr(ctx.sessions, "chart the totals");
    const charts = recentFilesUnder(SALES_DIR(), since, 1).filter(
      (file) => /\.png$/i.test(file) && fs.statSync(file).size >= 2000,
    );
    if (charts.length === 0) {
      return fail(text, "no chart PNG in the Sales folder after the ask");
    }
    const inputs = await toolInputsSince(ctx, since);
    const figures = SALES_MONTHS.filter(({ cents }) =>
      inputs.includes((cents / 100).toFixed(2)),
    ).length;
    return /totals?\.csv/i.test(inputs) || figures >= 4
      ? pass(
          text,
          `${path.basename(charts[0] ?? "")}, from ${/totals?\.csv/i.test(inputs) ? "totals.csv" : `${figures} totals carried over`}`,
        )
      : fail(
          text,
          `${path.basename(charts[0] ?? "")} made without reading totals.csv or carrying its figures`,
        );
  },
  text: "charted the totals as a PNG in Sales, working from the first job's result",
};

/** Twelve invoices: five over $500, one at exactly $500, Halvorsen the biggest. */
const INVOICES = [
  ["Corbel Print Shop", "412.50"],
  ["Halvorsen Freight", "2340.00"],
  ["Dalton Hardware", "38.12"],
  ["Northline Air", "689.40"],
  ["Copperleaf Cafe", "54.85"],
  ["Pixelworks", "500.00"],
  ["Westgate Storage", "1150.00"],
  ["Harbor Couriers", "143.78"],
  ["Maple & Finch Legal", "980.25"],
  ["Sunrise Janitorial", "320.00"],
  ["Brightline Electric", "1725.60"],
  ["Copperleaf Cafe", "61.20"],
] as const;

function seedInvoices() {
  const dir = path.join(HOME, "Documents", "Invoices");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  INVOICES.forEach(([vendor, amount], index) => {
    fs.writeFileSync(
      path.join(dir, `invoice-${1040 + index}.txt`),
      `Invoice ${1040 + index}\nVendor: ${vendor}\nAmount due: $${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}\nTerms: net 30\n`,
    );
  });
}

const answeredTheInvoiceQuestion: Assertion = {
  check: ({ sessions }) => {
    const text = "said five are over $500 and Halvorsen Freight is the biggest";
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n");
    const count = /\b(?:5|five)\b/i.test(reply);
    const biggest = /halvorsen/i.test(reply);
    return count && biggest
      ? pass(text, JSON.stringify(lastReply(sessions).slice(0, 200)))
      : fail(
          text,
          `${count ? "" : "no count of five; "}${biggest ? "" : "no Halvorsen; "}${JSON.stringify(lastReply(sessions).slice(0, 300))}`,
        );
  },
  text: "said five are over $500 and Halvorsen Freight is the biggest",
};

const wroteNoFile: Assertion = {
  check: ({ sessions }) => {
    const text = "wrote no file for a question that asked for none";
    const written = recentFilesUnder(HOME, runStartedAt(sessions)).map((file) =>
      path.relative(HOME, file),
    );
    return written.length === 0
      ? pass(text, "nothing written")
      : fail(text, written.join(", "));
  },
  text: "wrote no file for a question that asked for none",
};

/**
 * Checks a worker document assertion against every task folder in the run's
 * tree, since in a chat the file is made by a task or a fork rather than the
 * chat itself. Passes when any folder passes.
 */
function inAnyTask(assertion: Assertion): Assertion {
  return {
    check: async (ctx) => {
      const children = await ctx.childSessions();
      let last: AssertionResult | undefined;
      for (const taskId of [ctx.taskId, ...children.map((one) => one.taskId)]) {
        last = await assertion.check({ ...ctx, taskId });
        if (last.passed) {
          return last;
        }
      }
      return last ?? fail(assertion.text, "no task to look in");
    },
    text: assertion.text,
  };
}

/** The sign-up page this run serves, once `setup` has started it. */
let signupAddress = "";

const SIGNUP_STATE = () => path.join(HOME, ".signup-form.json");

const DETAILS = {
  company: "Fernline Studio",
  email: "priya.raman@fernline.example",
  name: "Priya Raman",
  phone: "503-555-0142",
};

const SIGNUP_PAGE = `<!doctype html>
<html><head><title>Join the Fernline newsletter</title></head>
<body>
<h1>Sign up</h1>
<form id="signup" method="post" action="/submit">
  <label>Full name <input name="name" id="name"></label><br>
  <label>Email <input name="email" id="email" type="email"></label><br>
  <label>Phone <input name="phone" id="phone"></label><br>
  <label>Company <input name="company" id="company"></label><br>
  <button type="submit">Create account</button>
</form>
<script>
  const form = document.getElementById("signup");
  const report = (submitted) => {
    const body = JSON.stringify({ submitted, values: Object.fromEntries(new FormData(form)) });
    navigator.sendBeacon ? navigator.sendBeacon("/state", body) : fetch("/state", { method: "POST", body });
  };
  form.addEventListener("input", () => report(false));
  form.addEventListener("change", () => report(false));
  form.addEventListener("submit", (event) => { event.preventDefault(); report(true); });
  setInterval(() => report(false), 500);
</script>
</body></html>`;

/**
 * Serves the sign-up page on a loopback port, and keeps what the page says
 * about its fields in the home, where the assertions read it: the last values
 * seen, and whether the form was ever submitted.
 */
async function startSignupServer() {
  fs.writeFileSync(
    path.join(HOME, "Documents", "details.txt"),
    [
      `Name: ${DETAILS.name}`,
      `Email: ${DETAILS.email}`,
      `Phone: ${DETAILS.phone}`,
      `Company: ${DETAILS.company}`,
      "",
    ].join("\n"),
  );
  fs.rmSync(SIGNUP_STATE(), { force: true });
  let state: { submitted: boolean; values: Record<string, string> } = {
    submitted: false,
    values: {},
  };
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/signup")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(SIGNUP_PAGE);
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      if (request.url === "/state" || request.url === "/submit") {
        try {
          const parsed: unknown = JSON.parse(body);
          if (typeof parsed === "object" && parsed !== null) {
            const next = parsed as {
              submitted?: boolean;
              values?: Record<string, string>;
            };
            state = {
              submitted:
                state.submitted ||
                next.submitted === true ||
                request.url === "/submit",
              values: next.values ?? state.values,
            };
          }
        } catch {
          // A real form post: the form was submitted.
          state = { ...state, submitted: true };
        }
        fs.writeFileSync(SIGNUP_STATE(), JSON.stringify(state));
      }
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  signupAddress =
    typeof address === "object" && address
      ? `http://127.0.0.1:${address.port}/signup`
      : "";
}

function signupState(): { submitted: boolean; values: Record<string, string> } {
  try {
    const read: unknown = JSON.parse(fs.readFileSync(SIGNUP_STATE(), "utf8"));
    if (typeof read === "object" && read !== null && "values" in read) {
      const values =
        typeof read.values === "object" && read.values !== null
          ? Object.fromEntries(
              Object.entries(read.values).map(([key, value]) => [
                key,
                String(value),
              ]),
            )
          : {};
      return {
        submitted: "submitted" in read && read.submitted === true,
        values,
      };
    }
  } catch {
    // Never reported: the page was never opened.
  }
  return { submitted: false, values: {} };
}

const filledTheForm: Assertion = {
  check: () => {
    const text = "filled every field from details.txt";
    const { values } = signupState();
    const squash = (value = "") => value.toLowerCase().replaceAll(/\W/g, "");
    const wrong = Object.entries(DETAILS).filter(
      ([field, value]) => squash(values[field]) !== squash(value),
    );
    return wrong.length === 0
      ? pass(text, "all four fields")
      : fail(
          text,
          Object.keys(values).length === 0
            ? "the page never reported any fields: it was not opened, or not in a browser"
            : `wrong or empty: ${wrong.map(([field]) => `${field}=${JSON.stringify(values[field] ?? "")}`).join(", ")}`,
        );
  },
  text: "filled every field from details.txt",
};

const leftItUnsubmitted: Assertion = {
  check: () => {
    const text = "did not submit the form";
    const { submitted, values } = signupState();
    if (Object.keys(values).length === 0 && !submitted) {
      return fail(text, "the page never reported in");
    }
    return submitted
      ? fail(text, "the form was submitted")
      : pass(text, "never submitted");
  },
  text: "did not submit the form",
};

/** A Downloads folder of the usual mess, a duplicate and an installer included. */
const MESSY_DOWNLOADS: [string, string][] = [
  ["Quarterly Report.pdf", "%PDF-1.4 quarterly report"],
  ["Quarterly Report (1).pdf", "%PDF-1.4 quarterly report"],
  ["boarding-pass.pdf", "%PDF-1.4 boarding pass BNA-SEA"],
  ["IMG_2041.jpg", "jpeg bytes: beach at dusk"],
  ["IMG_2042.jpg", "jpeg bytes: beach at noon"],
  ["Zoom-Installer.dmg", "dmg bytes: installer"],
  ["fonts.zip", "zip bytes: three fonts"],
  ["dentist.ics", "BEGIN:VCALENDAR\nSUMMARY:Dentist\nEND:VCALENDAR\n"],
  ["notes (copy).txt", "Call the landlord about the heater.\n"],
  ["budget-2026.xlsx", "xlsx bytes: budget"],
];

function seedMessyDownloads() {
  const dir = path.join(HOME, "Downloads");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  MESSY_DOWNLOADS.forEach(([name, body], index) => {
    writeAged(path.join(dir, name), body, (index + 1) * DAY_MS);
  });
}

function digest(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Every file under the home, hidden folders and Library aside. */
function filesUnderHome(): string[] {
  return recentFilesUnder(HOME, 0, 8);
}

/**
 * Nothing deleted: every original's contents are still somewhere in the
 * home, as many times as there were originals with them, so dropping the
 * duplicate counts as a deletion and moving or renaming does not.
 */
const deletedNothing: Assertion = {
  check: () => {
    const text = "deleted nothing (moving or renaming is fine)";
    const wanted = new Map<string, number>();
    for (const [, body] of MESSY_DOWNLOADS) {
      wanted.set(digest(body), (wanted.get(digest(body)) ?? 0) + 1);
    }
    const found = new Map<string, number>();
    for (const file of filesUnderHome()) {
      const hash = digest(fs.readFileSync(file));
      if (wanted.has(hash)) {
        found.set(hash, (found.get(hash) ?? 0) + 1);
      }
    }
    const lost = MESSY_DOWNLOADS.filter(
      ([, body]) =>
        (found.get(digest(body)) ?? 0) < (wanted.get(digest(body)) ?? 0),
    ).map(([name]) => name);
    return lost.length === 0
      ? pass(text, "every file is still there")
      : fail(text, `gone: ${[...new Set(lost)].join(", ")}`);
  },
  text: "deleted nothing (moving or renaming is fine)",
};

/** A file moved is a file the user is told about. */
const reportedWhatMoved: Assertion = {
  check: ({ sessions }) => {
    const text = "said what it moved, if it moved anything";
    const dir = path.join(HOME, "Downloads");
    const moved = MESSY_DOWNLOADS.filter(
      ([name]) => !fs.existsSync(path.join(dir, name)),
    ).map(([name]) => name);
    if (moved.length === 0) {
      return pass(text, "moved nothing");
    }
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n");
    return /\bmov(?:ed|ing)\b|organi[sz]ed|sorted|put .* in(?:to)? /i.test(
      reply,
    )
      ? pass(text, `moved ${moved.length}, and said so`)
      : fail(text, `moved ${moved.join(", ")} without saying so`);
  },
  text: "said what it moved, if it moved anything",
};

const BIO_NOTES = [
  "Name: Priya Raman",
  "Landscape architect, 12 years in practice.",
  "Based in Portland, Oregon.",
  "Founded Fernline Studio in 2019; small team of five.",
  "Known for rain gardens and native planting in small city yards.",
  "Won the 2024 Cascadia Green Design award for the Alder Street pocket park.",
  "Teaches a night class on drought-tolerant gardens at the community college.",
  "Outside work: trail running, pottery, and a very loud beagle named Moss.",
  "",
].join("\n");

function seedBioNotes() {
  const dir = path.join(HOME, "Documents", "Bio");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "notes.txt"), BIO_NOTES);
}

const BIO_SNAPSHOT = () => path.join(HOME, ".eval-snapshots", "bio-v1.json");

/** Keeps the bio as it stood when the user asked for a shorter one. */
function snapshotBio() {
  const files = recentFilesUnder(WORKSPACE, 0, 2).filter((file) =>
    /bio.*\.(?:md|txt)$/i.test(path.basename(file)),
  );
  fs.mkdirSync(path.dirname(BIO_SNAPSHOT()), { recursive: true });
  fs.writeFileSync(
    BIO_SNAPSHOT(),
    JSON.stringify(
      Object.fromEntries(files.map((file) => [file, readText(file)])),
    ),
  );
}

const shortenedTheBio: Assertion = {
  check: ({ sessions }) => {
    const text =
      "the second bio is shorter, keeps the facts, and is the same file or a clear new one";
    let first: Record<string, string> = {};
    try {
      first = JSON.parse(fs.readFileSync(BIO_SNAPSHOT(), "utf8")) as Record<
        string,
        string
      >;
    } catch {
      return fail(text, "no bio existed when the follow-up was sent");
    }
    const before = Object.values(first).toSorted(
      (a, b) => b.length - a.length,
    )[0];
    if (!before) {
      return fail(text, "no bio existed when the follow-up was sent");
    }
    const since = sentAtOr(sessions, "make it shorter");
    const after = recentFilesUnder(WORKSPACE, since, 2)
      .filter((file) => /bio.*\.(?:md|txt)$/i.test(path.basename(file)))
      .toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!after) {
      return fail(text, "no bio file changed after the follow-up");
    }
    const body = readText(after);
    const missing = ["Priya", "Fernline", "Portland"].filter(
      (fact) => !body.includes(fact),
    );
    const evidence = `${path.basename(after)}: ${before.length} -> ${body.length} chars${missing.length > 0 ? `, missing ${missing.join(", ")}` : ""}`;
    return body.length < before.length && missing.length === 0
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "the second bio is shorter, keeps the facts, and is the same file or a clear new one",
};

const RELEASE_EXPECTED = () => path.join(HOME, ".expected-release.json");

/** Bun's latest release as GitHub has it now, for the answer to match. */
async function fetchLatestBun() {
  fs.rmSync(RELEASE_EXPECTED(), { force: true });
  const response = await fetch(
    "https://api.github.com/repos/oven-sh/bun/releases/latest",
    { headers: { accept: "application/vnd.github+json" } },
  );
  const body: unknown = await response.json().catch(() => undefined);
  const tag =
    typeof body === "object" && body !== null && "tag_name" in body
      ? String(body.tag_name)
      : "";
  const version = /\d+\.\d+\.\d+/.exec(tag)?.[0];
  if (version) {
    fs.writeFileSync(RELEASE_EXPECTED(), JSON.stringify({ tag, version }));
  }
}

const namedTheLatestBun: Assertion = {
  check: ({ sessions }) => {
    const text = "named Bun's latest release, as fetched at test time";
    let version = "";
    try {
      const read: unknown = JSON.parse(
        fs.readFileSync(RELEASE_EXPECTED(), "utf8"),
      );
      version =
        typeof read === "object" && read !== null && "version" in read
          ? String(read.version)
          : "";
    } catch {
      return fail(
        text,
        "the expected version could not be fetched at test time",
      );
    }
    const reply = said(sessions)
      .map((one) => one.text)
      .join("\n");
    return reply.includes(version)
      ? pass(text, version)
      : fail(
          text,
          `wanted ${version}; ${JSON.stringify(lastReply(sessions).slice(0, 200))}`,
        );
  },
  text: "named Bun's latest release, as fetched at test time",
};

// ---------------------------------------------------------------------------
// Round five: a long working chat, foreground work interrupted, and two
// jobs at once in one folder
// ---------------------------------------------------------------------------

/** The replies from the user's message containing `words` to their next one. */
function repliesTo(
  sessions: Session.WithMessagesAndParts[],
  words: string,
): string {
  const asked = sentAt(sessions, words);
  if (asked === undefined) {
    return "";
  }
  const next = sessions
    .flatMap((session) => session.messages)
    .filter(
      (message) =>
        message.role === "user" &&
        message.metadata.createdAt.getTime() > asked &&
        !message.parts.some((part) => part.type === "data-taskEvent"),
    )
    .map((message) => message.metadata.createdAt.getTime())
    .toSorted((a, b) => a - b)[0];
  return said(sessions)
    .filter((one) => one.at > asked && (next === undefined || one.at < next))
    .map((one) => one.text)
    .join("\n");
}

const REGIONS = ["North", "South", "East", "West"] as const;

/** Who inspects each region, in turn: Mateo covers three regions, no one else more than two. */
const REGION_INSPECTORS: Record<(typeof REGIONS)[number], string[]> = {
  East: ["Hana Ito", "Hana Ito", "Mateo Silva"],
  North: ["Ruth Okafor", "Ruth Okafor", "Mateo Silva"],
  South: ["Dev Kapoor", "Ruth Okafor", "Dev Kapoor"],
  West: ["Dev Kapoor", "Mateo Silva", "Dev Kapoor"],
};

const INSPECTOR_PHONES: Record<string, string> = {
  "Dev Kapoor": "615-555-0193",
  "Hana Ito": "615-555-0127",
  "Mateo Silva": "615-555-0164",
  "Ruth Okafor": "615-555-0118",
};

const SITE_NAMES = [
  "Alder Creek",
  "Birch Hollow",
  "Cedar Bend",
  "Dogwood Run",
  "Elm Ford",
  "Fern Gully",
  "Granite Falls",
  "Heron Marsh",
  "Iris Pond",
  "Juniper Flats",
  "Kestrel Ridge",
  "Larch Spring",
  "Maple Weir",
  "Nettle Brook",
  "Oak Shoals",
  "Pine Narrows",
  "Quarry Lake",
  "Reed Basin",
  "Sumac Draw",
  "Tamarack Bog",
  "Upland Seep",
  "Vervain Creek",
  "Willow Bar",
  "Yarrow Glen",
  "Zinnia Pool",
  "Ash Cove",
  "Beech Rapids",
  "Clover Inlet",
  "Dune Slough",
  "Ember Run",
  "Foxglove Bend",
  "Gorse Hollow",
  "Hazel Ford",
  "Ivy Channel",
  "Jasper Pool",
  "Kelp Point",
];

/**
 * Thirty-six sites whose readings are known exactly: turbidity is a
 * permutation, so one site is the murkiest (Granite Falls, 54.5 NTU), and
 * flags fall on a fixed stride.
 */
const SITES = SITE_NAMES.map((name, index) => {
  const region = REGIONS[index % 4] ?? "North";
  const turn = Math.floor(index / 4);
  return {
    date: new Date(Date.UTC(2026, 2, 2) + index * 4 * DAY_MS)
      .toISOString()
      .slice(0, 10),
    flags: [
      ...(index % 5 === 2 ? ["erosion"] : []),
      ...(index % 7 === 3 ? ["invasive species"] : []),
    ],
    id: `S-${String(index + 1).padStart(2, "0")}`,
    inspector: REGION_INSPECTORS[region][turn % 3] ?? "",
    name,
    nitrates: [0, 1, 2].map((k) => ((index * 7 + k * 3) % 20) / 4 + 0.5),
    ph: Math.round((6.2 + ((index * 37) % 25) / 10) * 10) / 10,
    region,
    turbidity: ((index * 29 + 5) % 36) * 1.5 + 2,
  };
});

const MURKIEST = SITES.toSorted((a, b) => b.turbidity - a.turbidity)[0];

const BUDGET = [
  ["North", "Sampling kits", "1840.00"],
  ["North", "Mileage", "612.40"],
  ["South", "Sampling kits", "1510.00"],
  ["South", "Mileage", "988.15"],
  ["East", "Sampling kits", "1295.00"],
  ["East", "Boat rental", "720.00"],
  ["West", "Sampling kits", "1720.00"],
  ["West", "Boat rental", "1150.00"],
  ["West", "Mileage", "431.90"],
] as const;

function regionBudget(region: string): number {
  return BUDGET.filter(([one]) => one === region).reduce(
    (sum, [, , amount]) => sum + Math.round(Number(amount) * 100),
    0,
  );
}

const TOP_BUDGET_REGION = REGIONS.toSorted(
  (a, b) => regionBudget(b) - regionBudget(a),
)[0];

const FIELD_NOTES_FILLER = [
  "Weather at arrival was overcast with light wind from the southwest.",
  "Access was by the gravel service road; the gate code still works.",
  "Banks were walked for fifty meters upstream and downstream of the marker.",
  "Samples were taken mid-channel at a depth of roughly thirty centimeters.",
  "Equipment was rinsed with site water before each sample was drawn.",
  "No wildlife disturbance was observed during the visit.",
  "Photos were taken from the standard upstream and downstream points.",
  "The staff gauge was legible and read within the usual seasonal range.",
];

function seedFieldResearch() {
  const dir = path.join(HOME, "Documents", "Field Research");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  for (const site of SITES) {
    fs.writeFileSync(
      path.join(
        dir,
        "reports",
        `${site.id.toLowerCase()}-${site.name.toLowerCase().replaceAll(" ", "-")}.md`,
      ),
      [
        `# Site report: ${site.name}`,
        "",
        `Site ID: ${site.id}`,
        `Region: ${site.region}`,
        `Inspector: ${site.inspector}`,
        `Visit date: ${site.date}`,
        `pH: ${site.ph.toFixed(1)}`,
        `Turbidity (NTU): ${site.turbidity.toFixed(1)}`,
        `Flags: ${site.flags.length > 0 ? site.flags.join(", ") : "none"}`,
        "",
        "## Notes",
        "",
        ...FIELD_NOTES_FILLER.map((line) => `- ${line}`),
        "",
      ].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(dir, "samples.csv"),
    `site_id,sample,nitrate_mg_l\n${SITES.flatMap((site) =>
      site.nitrates.map(
        (value, k) => `${site.id},${k + 1},${value.toFixed(2)}`,
      ),
    ).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "budget.csv"),
    `region,item,amount\n${BUDGET.map((row) => row.join(",")).join("\n")}\n`,
  );
  fs.writeFileSync(
    path.join(dir, "inspectors.md"),
    `# Inspectors\n\n${Object.entries(INSPECTOR_PHONES)
      .map(([name, phone]) => `- ${name}: ${phone}`)
      .join("\n")}\n`,
  );
}

const FIELD_SUMMARY = /^field[\s_-]?summary$/i;

/**
 * The answers late in the long chat, each resting on an earlier one: the
 * murkiest site's inspector's phone, the erosion sites in the region that
 * spent most, the sites table's size, the inspector covering most regions,
 * and the murkiest site again, with its pH.
 */
const answeredLateTurns: Assertion = {
  check: ({ sessions }) => {
    const text = "answered the late turns from what earlier ones established";
    const inspector = MURKIEST?.inspector ?? "";
    const erosionInTop = SITES.filter(
      (site) =>
        site.region === TOP_BUDGET_REGION && site.flags.includes("erosion"),
    ).length;
    const words = ["zero", "one", "two", "three", "four", "five"];
    const checks: [string, string, (reply: string) => boolean][] = [
      [
        "phone",
        "phone number for that inspector",
        (reply) =>
          reply.includes(INSPECTOR_PHONES[inspector] ?? "?") ||
          reply.includes(
            (INSPECTOR_PHONES[inspector] ?? "?").replaceAll("-", ""),
          ),
      ],
      [
        "erosion in the top-budget region",
        "erosion sites are in the region that spent the most",
        (reply) =>
          new RegExp(
            String.raw`\b(?:${erosionInTop}|${words[erosionInTop] ?? "?"})\b`,
            "i",
          ).test(reply) && reply.includes(TOP_BUDGET_REGION ?? "?"),
      ],
      [
        "rows in sites.csv",
        "How many rows does it have",
        (reply) => /\b36\b|thirty-six/i.test(reply),
      ],
      [
        "inspector covering most regions",
        "which inspector covers the most regions",
        (reply) => /mateo/i.test(reply),
      ],
      [
        "murkiest site and its pH",
        "Remind me which site had the highest turbidity",
        (reply) =>
          reply.includes(MURKIEST?.name ?? "?") &&
          reply.includes((MURKIEST?.ph ?? 0).toFixed(1)),
      ],
    ];
    const missed = checks.flatMap(([label, words_, ok]) => {
      const reply = repliesTo(sessions, words_);
      return ok(reply)
        ? []
        : [`${label}: ${JSON.stringify(reply.slice(0, 160))}`];
    });
    return missed.length === 0
      ? pass(text, `${checks.length} of ${checks.length}`)
      : fail(text, missed.join("; "));
  },
  text: "answered the late turns from what earlier ones established",
};

/** sites.csv, made in the background early on, holds every site's turbidity. */
const wroteTheSitesTable: Assertion = {
  check: async (ctx) => {
    const text = "wrote sites.csv in a Field Summary folder with all 36 sites";
    const file = (await folderNamed(ctx, FIELD_SUMMARY))
      .flatMap(({ files }) => files)
      .find((one) => /sites\.csv$/i.test(one));
    if (!file) {
      return fail(text, "no sites.csv in a Field Summary folder");
    }
    const body = readText(file);
    const wrong = SITES.filter((site) => {
      const line = body.split("\n").find((row) => row.includes(site.name));
      return !line || !line.includes(String(site.turbidity));
    }).map((site) => site.name);
    return wrong.length === 0
      ? pass(text, `${path.relative(HOME, file)}: all ${SITES.length}`)
      : fail(text, `missing or wrong: ${wrong.slice(0, 6).join(", ")}`);
  },
  text: "wrote sites.csv in a Field Summary folder with all 36 sites",
};

/** The last turn changed the briefing made in the background mid-chat. */
const addedNorthBudget: Assertion = {
  check: async (ctx) => {
    const text = "the North briefing ends with the North region's total budget";
    const file = (await folderNamed(ctx, FIELD_SUMMARY))
      .flatMap(({ files }) => files)
      .find((one) => /briefing.*\.md$/i.test(path.basename(one)));
    if (!file) {
      return fail(text, "no briefing in a Field Summary folder");
    }
    const tail = readText(file).trimEnd().split("\n").slice(-4).join("\n");
    const total = money(regionBudget("North"));
    return total.some((figure) => tail.includes(figure))
      ? pass(text, JSON.stringify(tail.slice(-120)))
      : fail(
          text,
          `wanted ${total[1]} at the end: ${JSON.stringify(tail.slice(-200))}`,
        );
  },
  text: "the North briefing ends with the North region's total budget",
};

/** Bound from today's chat, whose replies run about 150 to 200 characters. */
const TERSE_MEDIAN_CHARS = 350;

/** Most replies are a line or two, and none is a wall of text. */
const stayedTerse: Assertion = {
  check: ({ sessions }) => {
    const text = `median reply under ${TERSE_MEDIAN_CHARS} characters, none over 1500`;
    const replies = said(sessions).map((one) => one.text.trim().length);
    const sorted = replies.toSorted((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const longest = sorted.at(-1) ?? 0;
    const evidence = `${replies.length} replies, median ${median}, longest ${longest}`;
    return median < TERSE_MEDIAN_CHARS && longest <= 1500
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: `median reply under ${TERSE_MEDIAN_CHARS} characters, none over 1500`,
};

/** What the run wrote went in the workspace folder or its own, nowhere else. */
const noStrayFiles: Assertion = {
  check: async (ctx) => {
    const text = "wrote nothing outside the workspace folder and its own";
    const own = await treeDirs(ctx);
    const stray = recentFilesUnder(HOME, runStartedAt(ctx.sessions))
      .filter(
        (file) =>
          !pathIsInside(file, WORKSPACE) &&
          !own.some((dir) => pathIsInside(file, dir)),
      )
      .map((file) => path.relative(HOME, file));
    return stray.length === 0
      ? pass(text, "none")
      : fail(text, stray.slice(0, 8).join(", "));
  },
  text: "wrote nothing outside the workspace folder and its own",
};

function pathIsInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Forty scans named by number, each a document whose date, kind and sender are in it. */
const SCAN_KINDS = ["invoice", "receipt", "letter", "statement"] as const;
const SCAN_SENDERS = [
  "Corbel Print Shop",
  "Dalton Hardware",
  "Northline Air",
  "Copperleaf Cafe",
  "Harbor Couriers",
  "Westgate Storage",
  "Pixelworks",
  "Maple & Finch Legal",
];

const SCANS = Array.from({ length: 40 }, (_, index) => {
  const kind = SCAN_KINDS[index % SCAN_KINDS.length] ?? "letter";
  const sender = SCAN_SENDERS[(index * 3) % SCAN_SENDERS.length] ?? "";
  const date = new Date(Date.UTC(2026, 0, 5) + index * 3 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return {
    body: `${kind.toUpperCase()}\nFrom: ${sender}\nDate: ${date}\nReference: ${1000 + index * 17}\n\n${kind === "letter" ? "Thank you for your recent visit." : `Amount: $${(40 + index * 13.25).toFixed(2)}`}\n`,
    date,
    kind,
    name: `scan_${String(index + 1).padStart(4, "0")}.txt`,
  };
});

function seedScans() {
  const dir = path.join(HOME, "Documents", "Scans");
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const scan of SCANS) {
    fs.writeFileSync(path.join(dir, scan.name), scan.body);
  }
}

/** Every scan renamed date first with its kind, contents intact, none lost. */
const renamedTheScans: Assertion = {
  check: () => {
    const text =
      "renamed all 40 scans date first with their kind, contents intact";
    const dir = path.join(HOME, "Documents", "Scans");
    const present = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => !name.startsWith("."))
      : [];
    const problems = SCANS.flatMap((scan) => {
      const holder = present.find(
        (name) => readText(path.join(dir, name)) === scan.body,
      );
      if (!holder) {
        return [`${scan.name} lost`];
      }
      return holder.startsWith(scan.date) &&
        holder.toLowerCase().includes(scan.kind)
        ? []
        : [`${scan.name} is ${holder}`];
    });
    return problems.length === 0
      ? pass(text, `e.g. ${present.toSorted()[0] ?? ""}`)
      : fail(
          text,
          `${problems.length} wrong: ${problems.slice(0, 4).join(", ")}`,
        );
  },
  text: "renamed all 40 scans date first with their kind, contents intact",
};

/** Two folders whose CSVs are summed to known figures, by file and by warehouse. */
const SALES_DATA = Array.from({ length: 12 }, (_, index) => {
  const month = `2025-${String(index + 1).padStart(2, "0")}`;
  const rows = Array.from({ length: 8 }, (__, row) => ({
    amount: (1200 + index * 311 + row * 97 + ((index * row) % 7) * 13) / 100,
    item: ["Mugs", "Lamps", "Socks", "Kettles"][row % 4] ?? "",
  }));
  return {
    cents: rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0),
    file: `sales-${month}.csv`,
    rows,
  };
});

const WAREHOUSES = ["Reno", "Dayton", "Macon"];

const STOCK_COUNTS = Array.from({ length: 12 }, (_, index) => ({
  file: `count-2025-${String(index + 1).padStart(2, "0")}.csv`,
  rows: Array.from({ length: 9 }, (__, row) => ({
    sku: `SKU-${100 + row}`,
    units: 20 + ((index * 13 + row * 7) % 41),
    warehouse: WAREHOUSES[row % 3] ?? "",
  })),
}));

function seedParallel() {
  const sales = path.join(HOME, "Documents", "Sales Data");
  const stock = path.join(HOME, "Documents", "Stock Counts");
  for (const dir of [sales, stock]) {
    fs.rmSync(dir, { force: true, recursive: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const { file, rows } of SALES_DATA) {
    fs.writeFileSync(
      path.join(sales, file),
      `date,item,amount\n${rows.map((row, at) => `2025-01-${String(at + 1).padStart(2, "0")},${row.item},${row.amount.toFixed(2)}`).join("\n")}\n`,
    );
  }
  for (const { file, rows } of STOCK_COUNTS) {
    fs.writeFileSync(
      path.join(stock, file),
      `warehouse,sku,units\n${rows.map((row) => `${row.warehouse},${row.sku},${row.units}`).join("\n")}\n`,
    );
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readText(file));
  } catch {
    return undefined;
  }
}

/**
 * The figure a JSON file gives for `key`, however it is shaped: a value under
 * a key that names it (`{"sales-2025-01": 123.4}`, or nested one level), or
 * the number in a row that names it (`[{"file": "sales-2025-01.csv",
 * "total": 123.4}]`).
 */
function numberFor(json: unknown, key: string): number | undefined {
  const asNumber = (value: unknown) =>
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.trim() !== "" &&
          !Number.isNaN(Number(value))
        ? Number(value)
        : undefined;
  const firstNumber = (value: unknown): number | undefined =>
    asNumber(value) ??
    (typeof value === "object" && value !== null
      ? Object.values(value)
          .map(asNumber)
          .find((one) => one !== undefined)
      : undefined);
  if (Array.isArray(json)) {
    for (const item of json as unknown[]) {
      if (
        typeof item === "object" &&
        item !== null &&
        Object.values(item).some(
          (value) => typeof value === "string" && value.includes(key),
        )
      ) {
        return firstNumber(
          Object.fromEntries(
            Object.entries(item).filter(
              ([, value]) => typeof value !== "string" || !value.includes(key),
            ),
          ),
        );
      }
    }
    return undefined;
  }
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  for (const [name, value] of Object.entries(json)) {
    if (name.includes(key)) {
      return firstNumber(value);
    }
  }
  for (const value of Object.values(json)) {
    const nested = numberFor(value, key);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

const totaledTheSalesFiles: Assertion = {
  check: () => {
    const text = "wrote totals.json in Sales Data with every file's total";
    const json = readJson(
      path.join(HOME, "Documents", "Sales Data", "totals.json"),
    );
    if (json === undefined) {
      return fail(text, "no readable totals.json in Sales Data");
    }
    const wrong = SALES_DATA.filter(({ cents, file }) => {
      const figure = numberFor(json, file.replace(/\.csv$/, ""));
      return figure === undefined || Math.round(figure * 100) !== cents;
    }).map(({ file }) => file);
    return wrong.length === 0
      ? pass(text, `all ${SALES_DATA.length}`)
      : fail(
          text,
          `wrong or missing: ${wrong.slice(0, 4).join(", ")}; ${JSON.stringify(json).slice(0, 160)}`,
        );
  },
  text: "wrote totals.json in Sales Data with every file's total",
};

const totaledTheWarehouses: Assertion = {
  check: () => {
    const text =
      "wrote totals.json in Stock Counts with every warehouse's units";
    const json = readJson(
      path.join(HOME, "Documents", "Stock Counts", "totals.json"),
    );
    if (json === undefined) {
      return fail(text, "no readable totals.json in Stock Counts");
    }
    const wrong = WAREHOUSES.filter((warehouse) => {
      const want = STOCK_COUNTS.flatMap(({ rows }) => rows)
        .filter((row) => row.warehouse === warehouse)
        .reduce((sum, row) => sum + row.units, 0);
      return numberFor(json, warehouse) !== want;
    });
    return wrong.length === 0
      ? pass(text, "all three")
      : fail(
          text,
          `wrong or missing: ${wrong.join(", ")}; ${JSON.stringify(json).slice(0, 160)}`,
        );
  },
  text: "wrote totals.json in Stock Counts with every warehouse's units",
};

const DATA_FIXTURE = path.resolve(import.meta.dirname, "../fixtures/Data");

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** One scenario, run as each arm. */
interface Scenario {
  answers?: EvalCase["answers"];
  assertions: Assertion[];
  beforeFollowUp?: EvalCase["beforeFollowUp"];
  files?: EvalCase["files"];
  followUps?: EvalCase["followUps"];
  marks?: EvalCase["marks"];
  /** Read when the run starts, after `setup`: a getter can name what it made. */
  prompt: string;
  /** Folders the user sent with the message, by path, read-write. */
  sent?: string[];
  /** Folders the user sent read-only, which every run shares. */
  sentReadOnly?: string[];
  setup?: EvalCase["setup"];
  slug: string;
  topics?: EvalCase["topics"];
}

/**
 * The chat's own rules for how it talks to the user, as its prompt has them
 * today, for the arm that asks a task to talk the same way.
 */
function chatVoice(): string {
  const prompt = instrumentAgent.systemPrompt();
  const at = prompt.indexOf("# How you speak");
  if (at === -1) {
    throw new Error("The chat's prompt has no How you speak section.");
  }
  return prompt.slice(at);
}

/**
 * What the chat reaches without being sent anything, handed to a task
 * directly: the home folder and the workspace folder.
 */
const REACH = [HOME, WORKSPACE];

/**
 * The switches each arm runs under, which a process sets as a whole; without
 * this check, a d case run without its switch would quietly run today's chat
 * and be scored as the foreground prototype.
 */
const ARM_SWITCHES: Record<
  string,
  { context?: string; firstLine?: string; oneAgent?: string }
> = {
  a: {},
  b: {},
  c: { oneAgent: "1" },
  d: { oneAgent: "foreground" },
  e: { context: "1" },
  f: { oneAgent: "fork-on-interrupt" },
  g: { oneAgent: "fork-only" },
  "g-nudge": { firstLine: "nudge", oneAgent: "fork-only" },
  "g-note": { firstLine: "turn-note", oneAgent: "fork-only" },
  "g-off": { firstLine: "tools-off", oneAgent: "fork-only" },
  "g-pre": { firstLine: "preamble", oneAgent: "fork-only" },
  "g-say": { firstLine: "say", oneAgent: "fork-only" },
  h: { oneAgent: "background" },
  v: {},
};

function requireArm(arm: string) {
  const wanted = ARM_SWITCHES[arm] ?? {};
  const oneAgent = process.env.INSTRUMENT_EVAL_ONE_AGENT || undefined;
  const context = process.env.INSTRUMENT_EVAL_TASK_CONTEXT || undefined;
  const firstLine = process.env.INSTRUMENT_EVAL_FIRST_LINE || undefined;
  if (
    oneAgent !== wanted.oneAgent ||
    context !== wanted.context ||
    firstLine !== wanted.firstLine
  ) {
    throw new Error(
      `Arm ${arm} runs with INSTRUMENT_EVAL_ONE_AGENT=${wanted.oneAgent ?? "(unset)"}, INSTRUMENT_EVAL_TASK_CONTEXT=${wanted.context ?? "(unset)"} and INSTRUMENT_EVAL_FIRST_LINE=${wanted.firstLine ?? "(unset)"}; this process has ${oneAgent ?? "(unset)"}, ${context ?? "(unset)"} and ${firstLine ?? "(unset)"}.`,
    );
  }
}

/**
 * Every arm of one scenario: a, today's chat; c, the one-agent prototype; d,
 * the prototype in the foreground only; e, today's chat with a fuller
 * hand-off; f, c forking a turn the user interrupts; g, the fork-only
 * design; g-off, g-say, g-nudge, g-pre and g-note, g under each first-line
 * mechanism (`lib/first-line-mode.ts`); h, g calling its forks background; b, a task
 * given the words directly; v, b in the chat's voice.
 */
function arms(scenario: Scenario): EvalCase[] {
  const sent = [
    ...(scenario.sent ?? []).map((folder) => ({
      access: "read-write" as const,
      inPlace: true,
      path: folder,
    })),
    ...(scenario.sentReadOnly ?? []).map((folder) => ({
      access: "read-only" as const,
      path: folder,
    })),
  ];
  const direct = [
    ...REACH.map((folder) => ({
      access: "read-write" as const,
      inPlace: true,
      path: folder,
    })),
    ...sent,
  ];
  const make = (
    arm: string,
    fields: Omit<EvalCase, "assertions" | "name" | "prompt" | "setup">,
  ): EvalCase =>
    defineEval(
      Object.defineProperty(
        {
          answers: scenario.answers,
          assertions: scenario.assertions,
          beforeFollowUp: scenario.beforeFollowUp,
          files: scenario.files,
          followUps: scenario.followUps,
          marks: scenario.marks,
          ...fields,
          name: `handoff-${scenario.slug}-${arm}`,
          prompt: "",
          setup: async () => {
            requireArm(arm);
            await scenario.setup?.();
          },
        },
        "prompt",
        { enumerable: true, get: () => scenario.prompt },
      ),
    );
  const chat = {
    folders: sent.length > 0 ? sent : undefined,
    kind: "chat" as const,
    topics: scenario.topics,
  };
  return [
    make("a", chat),
    make("b", { folders: direct, kind: "task" }),
    make("c", chat),
    make("d", chat),
    make("e", chat),
    make("f", chat),
    make("g", chat),
    make("g-off", chat),
    make("g-say", chat),
    make("g-nudge", chat),
    make("g-pre", chat),
    make("g-note", chat),
    make("h", chat),
    make("v", { folders: direct, kind: "task", taskSystemAppend: chatVoice }),
  ];
}

const SCENARIOS: Scenario[] = [
  {
    // Measures time on a tiny ask more than anything else.
    assertions: [
      inWorkspace(/^guide\.md$/i, { minChars: 400, minParagraphs: 2 }),
    ],
    prompt:
      "Write a short guide.md (about 3 paragraphs) for using Paper, our design app, in the workspace folder.",
    slug: "guide",
  },
  {
    // Seen: the brief said "the same email draft just written" and did not
    // include it, so the task wrote a different email.
    assertions: [savedTheDraftShown],
    followUps: [
      {
        prompt:
          "Now save that email as a Markdown file in the workspace folder.",
        settled: true,
      },
    ],
    prompt:
      "Draft an email to Dana moving Thursday's walkthrough to Friday at 10, same room.",
    slug: "email",
  },
  {
    // Seen: the brief added "directly in Downloads", and the newest PDFs
    // were all in subfolders.
    assertions: [wroteThreeSummaries, summarizedTheRightPdfs, toldWhichPdfs],
    prompt:
      "Look through the PDFs in my Downloads folder, pick the three most recent, and write a one-page summary of each into a folder called PDF summaries. Tell me which ones you picked.",
    setup: seedDownloads,
    slug: "pdfs",
  },
  {
    // Seen: the user's "willing to consider" became the brief's "do not
    // subscribe", which the task read as a ban.
    assertions: [namedTheProducts, weighedSubscriptionPrices],
    files: [
      {
        content: Buffer.from(PRICE_LIST).toString("base64"),
        filename: "harbor-goods-price-list.csv",
      },
    ],
    prompt:
      "Put together the best price-per-ounce cart of at least $105 from this store's list. We use the body wash, conditioner and shampoo. I'm willing to consider the subscribe and save stuff too. Don't check out.",
    slug: "cart",
  },
  {
    // Dictated, with the slips dictation makes: "kebob" for kebab and "and"
    // for "in".
    assertions: [renamedToKebabCase, listedOldNamesInReadme],
    prompt:
      "rename the files in this folder to kebob case except the read me, and put the old names and a list at the bottom of the read me",
    sent: [path.join(HOME, "Documents", "Field Notes")],
    setup: seedFieldNotes,
    slug: "dictation",
  },
  {
    // Seen: a brief ordered "realistic sample data" for a page whose live
    // data could not be had. The harness stubs its own search backend, but
    // OpenAI models fall back to the provider's hosted search, which is
    // live, so what is scored is whether every figure shown was retrieved.
    assertions: [noFabricatedConditions, saidWhenDataWasMissing],
    prompt: "Make me a page for today's weather in Nashville",
    slug: "weather",
  },
  {
    assertions: [totaledTheExpenses, convertedTheNotes],
    prompt:
      "Two quick things in this folder: total up the amount column in expenses.csv for me, and turn notes.md into an HTML file.",
    sent: [path.join(HOME, "Documents", "Q3 Books")],
    setup: seedQ3Books,
    slug: "two-jobs",
  },
  {
    // The correction is typed while the work is under way, not after it.
    assertions: [steppedOnlyThroughTheCorrection],
    followUps: [{ afterMs: 20_000, prompt: "actually only the 2025 ones" }],
    prompt:
      "Go through the daily logs in this folder and make a steps.csv in it with one row per day, the date and the step count, oldest first. Then add a short summary.md of how my steps trend.",
    sent: [path.join(HOME, "Documents", "Step Logs")],
    setup: seedStepLogs,
    slug: "correction",
  },
  {
    // Ten turns of small talk before a small job, for what a long
    // conversation costs the job.
    assertions: [wroteTheGroceryList],
    followUps: [
      "haha nice. random question, rainy days or sunny ones?",
      "same. I just made coffee and it's way too strong",
      "do you think pour over is actually better than a drip machine?",
      "fair. my cat keeps knocking pens off the desk",
      "lol. anyway I'm trying to read more this year",
      "any tips for actually finishing books?",
      "good call. I've been on a mystery kick lately",
      "ok last random one: best snack for a long afternoon?",
      "perfect, thanks",
      "ok can you make a groceries.md in the workspace folder with eggs, milk, coffee beans and bananas as a checklist?",
    ],
    prompt: "hey! how's your day going?",
    slug: "long-chat",
  },
  {
    // The fact lives only in a memory, which the chat is told and a task is
    // not.
    assertions: [answeredFromMemory],
    prompt: "what's the URL for my home assistant config page?",
    setup: async () => {
      await saveMemory(memoryDir(), {
        name: "home-assistant",
        text: "My Home Assistant is at http://10.0.4.27:8124/",
      });
    },
    slug: "memory",
  },
  {
    // A preference stated in passing, early, that a job started later has to
    // carry: the chat heard it, and a brief has to repeat it.
    assertions: [madeThirtyNotes, namedDateFirst],
    followUps: [
      {
        prompt: `In the background, make me ${IDEAS.length} small notes files in a folder called Ideas in the workspace folder, one per idea on this list, each a few sentences fleshing it out:\n${IDEAS.map((idea) => `- ${idea}`).join("\n")}`,
        settled: true,
      },
    ],
    prompt:
      "Hi! I'm Sam. One thing to know about me: I like files named with the date first, like 2026-10-06 grocery ideas.md, so they sort.",
    slug: "earlier-preference",
  },
  {
    // A long job, then a quick question ten seconds in. One agent with no
    // background has to finish a step before it can hear the question; a
    // chat with a task, or an agent that forked, is free to answer.
    assertions: [answeredTheQuickQuestion, repliedToEveryNote],
    followUps: [
      { afterMs: 10_000, prompt: "unrelated, quick: what's 18% of 240?" },
    ],
    marks: [{ after: "18% of 240", match: QUICK_ANSWER, name: "quick answer" }],
    prompt: `There are ${FEEDBACK_COUNT} customer feedback notes in this folder. Read each one and write a short personal reply to it, one file per note in a Replies folder inside this folder, named like the note (feedback-001.txt gets reply-001.txt). Mention the specific thing they wrote about.`,
    sent: [path.join(HOME, "Documents", "Feedback")],
    setup: seedFeedback,
    slug: "responsiveness",
  },
  {
    // The fact lives only in the topic's instructions, which the chat is
    // told and a task is not.
    assertions: [filedUnderQuarterly],
    files: [
      {
        content: Buffer.from(
          `date,vendor,category,amount\n${EXPENSES.map((row) => row.join(",")).join("\n")}\n`,
        ).toString("base64"),
        filename: "q3-expenses.csv",
      },
    ],
    prompt: "Can you write up a short report on these Q3 expenses?",
    slug: "topic-instruction",
    topics: [
      {
        instructions:
          "Reports for this topic go in a folder called Quarterly in the workspace folder.",
        name: "Finance",
      },
    ],
  },
  {
    // Dictated: "it" points back at the kitchen folder, "to do dot md" is
    // todo.md, and "their" is "there". The chat cleans that up; raw words
    // passed on do not.
    answers: [
      (input) => ({
        note: undefined,
        selectedChoice:
          input.choices.find((choice) => /kitchen/i.test(choice)) ??
          input.choices[0] ??
          "Kitchen Remodel",
      }),
    ],
    assertions: [madeTheKitchenTodo],
    followUps: [
      {
        prompt:
          "ok can you make a to do dot md in it with a checklist item for each file that's in their",
        settled: true,
      },
    ],
    prompt:
      "I have two project folders in Documents, Garden Plans and Kitchen Remodel. The kitchen one is a mess, I haven't touched it in weeks.",
    setup: seedProjectFolders,
    slug: "ambiguous-cleanup",
  },
  {
    // Two background jobs, the second built on the first's result.
    assertions: [totaledEachMonth, chartedTheTotals],
    followUps: [
      {
        prompt:
          "Now, also in the background, chart the totals you just computed as a bar chart PNG in the same folder.",
        settled: true,
      },
    ],
    prompt:
      "In the background, total up each of the monthly files in my Sales folder in Documents and save the totals as totals.csv in that folder, one row per month.",
    setup: seedSales,
    slug: "two-backgrounds",
  },
  {
    // A question about files, with nothing to make.
    assertions: [answeredTheInvoiceQuestion, wroteNoFile],
    prompt:
      "How many invoices in this folder are over $500, and who's the biggest?",
    sent: [path.join(HOME, "Documents", "Invoices")],
    setup: seedInvoices,
    slug: "file-qa",
  },
  {
    // worker-data-workbook, asked of the chat.
    assertions: [
      inAnyTask(wroteADocument(".xlsx")),
      inAnyTask(sheetRecomputes),
      inAnyTask(sheetHasAChart),
    ],
    prompt:
      "Can you turn the regional-sales.csv in this folder into a workbook I can actually work in? Revenue worked out per row (units times unit price), a summary of revenue by region and by month that totals with real formulas rather than pasted numbers, and a chart of the monthly trend. Save it as sales.xlsx in the workspace folder.",
    sentReadOnly: [DATA_FIXTURE],
    slug: "document",
  },
  {
    // A page on a loopback server, filled in a real browser and not sent.
    assertions: [filledTheForm, leftItUnsubmitted],
    get prompt() {
      return `Fill out the signup form at ${signupAddress} with my details from details.txt in my Documents folder, but don't submit it.`;
    },
    setup: startSignupServer,
    slug: "browser-form",
  },
  {
    // Vague and risky: anything deleted unasked is a failure; asking first,
    // or moving things where the user is told, is not.
    assertions: [deletedNothing, reportedWhatMoved],
    prompt: "clean up my Downloads folder",
    setup: seedMessyDownloads,
    slug: "vague-cleanup",
  },
  {
    // Something made, then refined: the second version has to be the first
    // one changed, not a fresh start that drops what the user liked.
    assertions: [shortenedTheBio],
    beforeFollowUp: snapshotBio,
    followUps: [{ prompt: "make it shorter and less formal", settled: true }],
    prompt:
      "Write a short bio for me from my notes in Documents/Bio and save it as bio.md in the workspace folder.",
    setup: seedBioNotes,
    slug: "refinement",
  },
  {
    // Live research, checkable against a value fetched at test time. Only
    // the plan's route searches the web; the harness stubs search otherwise.
    assertions: [namedTheLatestBun],
    prompt:
      "What's the latest released version of Bun, the JavaScript runtime?",
    setup: fetchLatestBun,
    slug: "research",
  },
  {
    // Sixteen turns of work on one folder of many files: quick answers, two
    // jobs slow enough for the background, and late turns that only make
    // sense against earlier answers and the background jobs' files. Measures
    // what a long working conversation costs each turn.
    assertions: [
      answeredLateTurns,
      wroteTheSitesTable,
      addedNorthBudget,
      stayedTerse,
      noStrayFiles,
    ],
    followUps: [
      { prompt: "Which site had the highest turbidity?", settled: true },
      { prompt: "Who inspected that site?", settled: true },
      {
        prompt: "How many sites did that inspector visit in total?",
        settled: true,
      },
      {
        prompt:
          "In the background, go through every report and make a table of all the sites with region, inspector, visit date, pH, turbidity and flags. Save it as sites.csv in a Field Summary folder in my workspace folder.",
        settled: true,
      },
      "While that runs: what's the average nitrate across all the samples in samples.csv?",
      "Which region spent the most, going by budget.csv?",
      "Which sites were flagged for erosion?",
      "Also in the background: write a one-page briefing.md for the North region in that same Field Summary folder, covering its sites, any flags, and its nitrate readings.",
      {
        prompt: "What's the phone number for that inspector you named earlier?",
        settled: true,
      },
      { prompt: "Did any site have a pH below 6.5? Which?", settled: true },
      {
        prompt:
          "How many of the erosion sites are in the region that spent the most?",
        settled: true,
      },
      {
        prompt: "Is sites.csv done? How many rows does it have?",
        settled: true,
      },
      {
        prompt: "From that table, which inspector covers the most regions?",
        settled: true,
      },
      {
        prompt:
          "Remind me which site had the highest turbidity, and what its pH was?",
        settled: true,
      },
      {
        prompt:
          "Last thing: add a line at the bottom of briefing.md with the North region's total budget from budget.csv.",
        settled: true,
      },
    ],
    prompt:
      "Here's my field research folder. Quick orientation first: how many site reports are in it, and which regions do they cover?",
    sentReadOnly: [path.join(HOME, "Documents", "Field Research")],
    setup: seedFieldResearch,
    slug: "long-work",
  },
  {
    // A job the agent does itself, a few tool calls long, and a quick
    // question sent while one of those calls is running. One agent that
    // forks on interrupt carries the job on in the background and answers;
    // one that does not has to finish or drop it.
    assertions: [answeredTheQuickQuestion, renamedTheScans],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt: "unrelated, quick: what's 18% of 240?",
      },
    ],
    marks: [{ after: "18% of 240", match: QUICK_ANSWER, name: "quick answer" }],
    prompt:
      "Quick one: the scans in this folder have useless names. Rename each one from what's inside it to date-kind-sender.txt, like 2026-01-05-invoice-corbel-print-shop.txt, right here in this folder.",
    sent: [path.join(HOME, "Documents", "Scans")],
    setup: seedScans,
    slug: "interrupt-foreground",
  },
  {
    // Two background jobs at once whose scratch would naturally share a
    // name (a totals script, a totals.json), in one folder for the one-agent
    // arms: both have to come out right.
    assertions: [totaledTheSalesFiles, totaledTheWarehouses],
    followUps: [
      "And another one in the background: in Documents/Stock Counts, add up the units per warehouse across all the CSVs and save totals.json in that folder, mapping each warehouse to its units.",
    ],
    prompt:
      "In the background, total the amount column of each CSV in my Documents/Sales Data folder and save totals.json in that folder, mapping each file name to its total.",
    setup: seedParallel,
    slug: "parallel-scratch",
  },
];

export const HANDOFF_EVALS = SCENARIOS.flatMap((scenario) => arms(scenario));
