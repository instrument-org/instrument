/**
 * Does handing work from the chat to a task cost the user anything?
 *
 * The chat (`src/agents/instrument.ts`) delegates nearly everything to task
 * agents (`src/agents/main.ts`), and a task sees only the brief the chat
 * writes: never the user's words, their memories, or their topic's
 * instructions. Every scenario here is a failure seen in real use where the
 * brief lost something the user said, and each runs three ways from one
 * definition, so the prompt, the fixtures, and the assertions are the same
 * and only the route differs:
 *
 * - **a, today:** the user's words go to the chat, which delegates.
 * - **b, direct:** the same words go straight to a task agent that reaches
 *   what the chat reaches (the home folder and the workspace folder, plus
 *   any folder the user sent).
 * - **c, one agent:** a, with the process opted into the one-agent
 *   prototype (`INSTRUMENT_EVAL_ONE_AGENT=1`), which does quick work itself
 *   and forks a task for slow work.
 * - **v, direct in the chat's voice:** b with the chat's "How you speak"
 *   section appended to the task agent's system prompt, so reply length is
 *   compared like for like. The prompt is the agent's rather than the
 *   task's, so a v run cannot share a process with any other arm.
 *
 * Every assertion reads the outcome (a file on disk, a figure the user was
 * shown), never the wording of a brief.
 *
 * Fixtures are made in the run's home by each case's `setup`, and the
 * workspace folder is the home's, so two runs in one process see each
 * other's files. Run each case in a process of its own with its own
 * `INSTRUMENT_EVAL_HOME`, which `evals/handoff-matrix.ts` does, setting the
 * one-agent flag for arm c.
 */
import fs from "node:fs";
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
// Scenarios
// ---------------------------------------------------------------------------

/** One scenario, run as each arm. */
interface Scenario {
  assertions: Assertion[];
  files?: EvalCase["files"];
  followUps?: EvalCase["followUps"];
  prompt: string;
  /** Folders the user sent with the message, by path. */
  sent?: string[];
  setup?: EvalCase["setup"];
  slug: string;
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
 * Arm c is the one-agent prototype, which a process opts into as a whole
 * (`INSTRUMENT_EVAL_ONE_AGENT=1`); without it, a c case would quietly run
 * today's chat and be scored as the prototype.
 */
function requireOneAgent() {
  if (process.env.INSTRUMENT_EVAL_ONE_AGENT !== "1") {
    throw new Error(
      "Arm c runs the one-agent prototype: set INSTRUMENT_EVAL_ONE_AGENT=1.",
    );
  }
}

/**
 * Every arm of one scenario: a, today's chat; b, a task given the words
 * directly; c, the one-agent prototype; v, b in the chat's voice.
 */
function arms(scenario: Scenario): EvalCase[] {
  const shared = {
    assertions: scenario.assertions,
    files: scenario.files,
    followUps: scenario.followUps,
    prompt: scenario.prompt,
    setup: scenario.setup,
  };
  const sent = (scenario.sent ?? []).map((folder) => ({
    access: "read-write" as const,
    inPlace: true,
    path: folder,
  }));
  const direct = [
    ...REACH.map((folder) => ({
      access: "read-write" as const,
      inPlace: true,
      path: folder,
    })),
    ...sent,
  ];
  return [
    defineEval({
      ...shared,
      folders: sent.length > 0 ? sent : undefined,
      kind: "chat",
      name: `handoff-${scenario.slug}-a`,
    }),
    defineEval({
      ...shared,
      folders: direct,
      kind: "task",
      name: `handoff-${scenario.slug}-b`,
    }),
    defineEval({
      ...shared,
      folders: sent.length > 0 ? sent : undefined,
      kind: "chat",
      name: `handoff-${scenario.slug}-c`,
      setup: async () => {
        requireOneAgent();
        await scenario.setup?.();
      },
    }),
    defineEval({
      ...shared,
      folders: direct,
      kind: "task",
      name: `handoff-${scenario.slug}-v`,
      taskSystemAppend: chatVoice,
    }),
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
];

export const HANDOFF_EVALS = SCENARIOS.flatMap((scenario) => arms(scenario));
