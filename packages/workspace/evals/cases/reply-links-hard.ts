/**
 * Harder places for a reply's links to go dead, each a request a person
 * would make: one file found among many alike, outputs a script writes from
 * a nested folder, a file renamed and moved after it was made, names with
 * spaces, brackets, accents and `#`, two files a task made, a file named
 * again a turn later, app links to a setting and to a memory saved in the
 * chat, and a request half of which cannot be done.
 *
 * Scored with the same link assertions as `reply-links.ts`, including
 * whether the end-of-turn check fired and whether a firing flagged links
 * that opened. Each case names its files apart from the others', since the
 * cases of one trial share a home; run each case as its own process when a
 * memory one case saves must not reach the next.
 *
 * **What it measured, 2026-10-21, three trials of each.** Haiku 5.5 on the
 * Claude account: one firing in 24 runs, a task's `instrument://file/` link
 * naming a bare filename, and every turn's last reply opened. GLM 5.3 Flash:
 * two firings in 24, each a fence line it shortened with `...`, both fixed in
 * the correction. No firing flagged a link that opened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { brokenLinksIn } from "../../src/lib/broken-links";
import { filesNamedIn } from "../../src/lib/parse-files-block";
import { type Assertion, defineEval } from "../harness";
import {
  assertHandedOverAFile,
  finishedReply,
  LINK_ASSERTIONS,
  textOf,
  turnsOf,
} from "./reply-links";

const NEEDLE = "Clients/Acme Corp/2026/03 March/Invoice 2026-03 (v2).md";

function invoice(client: string, month: string, total: string, status: string) {
  return `# Invoice ${month}\n\nBill to: ${client}\nTotal: ${total}\nStatus: ${status}\n`;
}

/** Forty-odd invoices alike in name, one of them the one asked for. */
function seedInvoices(): void {
  const documents = path.join(os.homedir(), "Documents");
  const write = (relative: string, body: string) => {
    const file = path.join(documents, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const clients = ["Acme Corp", "Acme Holdings", "Borealis Design"];
  const months = ["01 January", "02 February", "03 March", "04 April"];
  for (const client of clients) {
    for (const year of ["2025", "2026"]) {
      for (const [i, month] of months.entries()) {
        const stamp = `${year}-0${i + 1}`;
        for (const version of ["v1", "v2"]) {
          write(
            `Clients/${client}/${year}/${month}/Invoice ${stamp} (${version}).md`,
            invoice(
              client,
              stamp,
              `$${String(3200 + i * 410 + (version === "v2" ? 90 : 0))}`,
              version === "v2" ? "Sent" : "Draft",
            ),
          );
        }
      }
    }
  }
  // The decoys nearest the one asked for: the same month's draft with the
  // digits swapped, a copy of it never sent, and another Acme's sent one
  // for the same total.
  write(
    "Clients/Acme Corp/2026/03 March/Invoice 2026-03 (v1).md",
    invoice("Acme Corp", "2026-03", "$4,580", "Draft"),
  );
  write(NEEDLE, invoice("Acme Corp", "2026-03", "$4,850", "Sent 2026-04-02"));
  write(
    "Clients/Acme Corp/2026/03 March/Invoice 2026-03 (v2) copy.md",
    invoice("Acme Corp", "2026-03", "$4,850", "Draft, not sent"),
  );
  write(
    "Clients/Acme Holdings/2026/03 March/Invoice 2026-03 (v2).md",
    invoice("Acme Holdings", "2026-03", "$4,850", "Sent 2026-04-03"),
  );
}

/** The text of each turn's last reply, the chat's and every task's. */
async function lastReplies(
  ctx: Parameters<Assertion["check"]>[0],
): Promise<string[]> {
  const turns = await turnsOf(ctx);
  return turns.flatMap((turn) => {
    const last = turn.findLast(finishedReply);
    return last ? [textOf(last)] : [];
  });
}

function decodedText(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const assertLinkedTheNeedle: Assertion = {
  check: async (ctx) => {
    const text = "Linked the sent Acme Corp invoice, and no decoy";
    // What the replies link, fence lines and link targets, since a decoy
    // named in passing as the one not meant is fine.
    const targets = (await lastReplies(ctx)).flatMap((reply) => [
      ...filesNamedIn(reply),
      ...[...reply.matchAll(/\]\(\s*<?([^)>]+)/gu)].flatMap((match) =>
        match[1] === undefined ? [] : [decodedText(match[1])],
      ),
    ]);
    const linked = targets.some((target) => target.endsWith(NEEDLE));
    const decoy = targets.some(
      (target) =>
        target.includes("Acme Holdings/2026/03 March") ||
        target.endsWith("(v2) copy.md") ||
        target.endsWith("Acme Corp/2026/03 March/Invoice 2026-03 (v1).md"),
    );
    return {
      evidence: linked
        ? decoy
          ? "named the invoice beside a decoy"
          : "named the invoice"
        : "the invoice's path is not in a last reply",
      passed: linked && !decoy,
      text,
    };
  },
  text: "Linked the sent Acme Corp invoice, and no decoy",
};

/** A last reply names a file under `folder` (relative to the home) that is there. */
function assertLinksUnder(folder: string, what: string): Assertion {
  const text = `Linked ${what}`;
  return {
    check: async (ctx) => {
      const replies = (await lastReplies(ctx)).map(decodedText).join("\n\n");
      const root = path.join(os.homedir(), folder);
      const named = fs.existsSync(root)
        ? fs
            .readdirSync(root, { recursive: true })
            .map(String)
            .filter((entry) => replies.includes(entry))
        : [];
      const broken = await brokenLinksIn({ chatId: ctx.chatId, text: replies });
      return {
        evidence: `under ${folder}: ${named.join(", ") || "nothing named"}${broken.length > 0 ? `; broken: ${broken.map(({ link }) => link).join(", ")}` : ""}`,
        passed: named.length > 0 && broken.length === 0,
        text,
      };
    },
    text,
  };
}

const ODD_FOLDER = "Documents/Résumé drafts (2026)";
const ODD_NAMES = ["Lettre à Zoë.txt", "Q3 plan [v2].txt", "notes #1 & 2.txt"];

const assertMadeTheOddNames: Assertion = {
  check: () => {
    const text = "Made the folder and files under the names asked for";
    const root = path.join(os.homedir(), ODD_FOLDER);
    const missing = ODD_NAMES.filter(
      (name) => !fs.existsSync(path.join(root, name)),
    );
    return {
      evidence:
        missing.length === 0
          ? "all three there"
          : `missing: ${missing.join(", ")}; found: ${fs.existsSync(root) ? fs.readdirSync(root).join(", ") : "no folder"}`,
      passed: missing.length === 0,
      text,
    };
  },
  text: "Made the folder and files under the names asked for",
};

/** Some last reply has an app link of this noun. */
function assertAppLink(noun: string): Assertion {
  const text = `Linked a ${noun} by its app address`;
  return {
    check: async (ctx) => {
      const pattern = new RegExp(`instrument://${noun}/[^)\\s]+`, "gu");
      const found = (await lastReplies(ctx)).flatMap((reply) =>
        [...reply.matchAll(pattern)].map((match) => match[0]),
      );
      return {
        evidence: found.join(", ") || "none",
        passed: found.length > 0,
        text,
      };
    },
    text,
  };
}

const CHART_AGAIN = "send me that chart again";

/** The follow-up's reply hands the chart over again, in a fence that opens. */
const assertSentTheChartAgain: Assertion = {
  check: async (ctx) => {
    const text = "The follow-up's reply handed the chart over again";
    const messages = ctx.sessions.flatMap((session) => session.messages);
    const asked = messages.findIndex(
      (message) =>
        message.role === "user" && textOf(message).includes(CHART_AGAIN),
    );
    const next = messages.findIndex(
      (message, i) => i > asked && message.role === "user",
    );
    const last =
      asked === -1
        ? undefined
        : messages
            .slice(asked + 1, next === -1 ? undefined : next)
            .findLast(finishedReply);
    const reply = last ? textOf(last) : "";
    const fenced = /```files\n[^`]*\.(png|svg|jpe?g|pdf|html)\s*\n/iu.test(
      reply,
    );
    const broken = await brokenLinksIn({ chatId: ctx.chatId, text: reply });
    return {
      evidence: `${fenced ? "fenced an image" : "no image in a fence"}${broken.length > 0 ? `; broken: ${broken.map(({ link }) => link).join(", ")}` : ""}`,
      passed: fenced && broken.length === 0,
      text,
    };
  },
  text: "The follow-up's reply handed the chart over again",
};

export const REPLY_LINKS_HARD_EVALS = [
  defineEval({
    assertions: [...LINK_ASSERTIONS, assertLinkedTheNeedle],
    allowsFolders: 2,
    kind: "chat",
    name: "reply-links-needle",
    prompt:
      "I need the March invoice I actually sent to Acme Corp this year. It's somewhere in my Documents under Clients, and I think it came to $4,850. Can you find it and give me a link?",
    setup: seedInvoices,
  }),
  defineEval({
    // A script run from inside its own folder, writing next to itself and
    // into a sibling, which the reply then names from the work folder.
    assertions: [...LINK_ASSERTIONS, assertHandedOverAFile],
    allowsFolders: 2,
    kind: "chat",
    name: "reply-links-nested-project",
    prompt:
      "Set up a little project in my Documents called running-log: a data folder with a CSV of 8 weeks of sample runs (date, miles, minutes), and a scripts folder with a Python script that reads it and writes a weekly summary text file and an SVG chart of miles per week into an output folder in the project. Run it and send me the summary, the chart and the script.",
  }),
  defineEval({
    // Made under one name and place, then renamed and moved: a link to
    // where it was first is dead.
    assertions: [
      ...LINK_ASSERTIONS,
      assertLinksUnder("Documents/Applications", "the moved cover letter"),
    ],
    allowsFolders: 2,
    kind: "chat",
    name: "reply-links-renamed-file",
    prompt:
      "Write me a short cover letter for a barista job at a café called Little Owl, as a Markdown file. Once it's written, rename it to include today's date and move it into a new Applications folder in my Documents. Send me the final file.",
  }),
  defineEval({
    // Spaces, parentheses, brackets, accents and `#` in the names, and a
    // folder handed over beside its files.
    assertions: [...LINK_ASSERTIONS, assertMadeTheOddNames],
    allowsFolders: 2,
    kind: "chat",
    name: "reply-links-odd-names",
    prompt:
      "In my Documents, make a folder called 'Résumé drafts (2026)' with three short text files in it named exactly 'Lettre à Zoë.txt', 'Q3 plan [v2].txt' and 'notes #1 & 2.txt'. Put a line or two in each. Then give me links to the folder and the three files.",
  }),
  defineEval({
    // Two files a task made, which the chat names when the task reports.
    assertions: [...LINK_ASSERTIONS, assertHandedOverAFile],
    kind: "chat",
    name: "reply-links-task-two-files",
    prompt:
      "In the background, plan a 4-day trip to Lisbon for me: a day-by-day itinerary as a Markdown file and a budget spreadsheet as a CSV. Tell me when both are ready.",
  }),
  defineEval({
    // A file from an earlier turn, asked for again by a description.
    assertions: [...LINK_ASSERTIONS, assertSentTheChartAgain],
    followUps: [
      {
        prompt: `Thanks! Can you ${CHART_AGAIN}? I closed it and can't find it.`,
        settled: true,
      },
    ],
    kind: "chat",
    name: "reply-links-earlier-file",
    prompt:
      "Make me a bar chart of my monthly spending: rent 1800, groceries 600, transport 200, eating out 350, subscriptions 90.",
  }),
  defineEval({
    // A setting the guide names, then a memory saved in the chat, each
    // linked by its app address.
    assertions: [
      ...LINK_ASSERTIONS,
      assertAppLink("settings"),
      assertAppLink("memory"),
    ],
    followUps: [
      {
        prompt:
          "Please remember that I have low vision and prefer large text everywhere.",
        settled: true,
      },
      {
        prompt:
          "Can you show me that memory you just saved, so I can check it?",
        settled: true,
      },
    ],
    kind: "chat",
    name: "reply-links-setting-and-memory",
    prompt:
      "The text in this app is too small for me. How do I make everything bigger?",
  }),
  defineEval({
    // Half of it cannot be done: the reply says so of the file it could not
    // make, which must not read as a dead link.
    assertions: [...LINK_ASSERTIONS, assertHandedOverAFile],
    // A folder asked for in search of the health data is answered not now,
    // so the turn ends on a reply rather than on the card.
    declinesFolders: true,
    kind: "chat",
    name: "reply-links-half-done",
    prompt:
      "Make me two CSVs: one with the 2026 US federal holidays and their dates, and one with my Apple Health step counts for every day this year.",
  }),
];
