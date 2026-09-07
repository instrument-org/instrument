/**
 * Can a model do the work, as opposed to decide who should?
 *
 * The conversation and the tasks under it are two different jobs, and a model
 * good at one is not thereby good at the other: the conversation has four tools
 * and has to choose, while a task has every file tool, a shell with real
 * binaries, a browser and skills, and has to finish something. Measuring only
 * the conversation picks models that delegate beautifully to workers that
 * cannot deliver.
 *
 * These are the deliverables the transcript is actually full of. Documents come
 * first because they are the hardest honest test in the suite: nothing here can
 * be answered from the model's own text, each needs a real subprocess and a
 * third-party library, and the file either opens or it does not. A model that
 * writes a confident paragraph about the spreadsheet it made and leaves a
 * 0-byte file fails in a way no text assertion would catch.
 *
 * Two things beyond "the file opens" are scored, because both are where the
 * eligible models actually separate. A deck is checked for having been designed
 * rather than left on the library's blank default -- measured, one model that
 * passes every validity check ships five white slides of centered Times. And a
 * deliverable is checked for having been looked at: the prompt already tells a
 * task to open its result the way the user will see it before reporting done,
 * and whether a model obeys that is the difference between a report and a guess.
 *
 * What these cannot see: web search and the browser are stubbed in the harness,
 * so research and page-driving -- a third of the real corpus -- are not scored
 * here at all.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { taskDir } from "../../src/lib/task-dir-utils";
import { type TaskId } from "../../src/schemas/task-id";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

/** The four bytes every OOXML file starts with, being a zip. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A year of sales by region and month, whose totals the case knows exactly. */
const DATA_FIXTURE = path.resolve(import.meta.dirname, "../fixtures/Data");

/** Below this a document exists but holds nothing worth opening. */
const MIN_DOCUMENT_BYTES = 4000;

/**
 * Every file this task could have written: its own folder, and the workspace
 * folder, since a brief naming one is answered in the other about as often.
 */
async function deliverables(taskId: TaskId): Promise<string[]> {
  const home = process.env.HOME ?? "";
  return [
    ...(await filesUnder(taskDir(taskId))),
    ...(home
      ? await filesUnder(path.join(home, "Documents", "Instrument"))
      : []),
  ];
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (at: string, depth: number) => {
    if (depth > 4) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        await walk(full, depth + 1);
      } else {
        found.push(full);
      }
    }
  };
  await walk(dir, 0);
  return found;
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

/**
 * A real document of the asked-for kind: the right extension, the zip header
 * every OOXML file starts with, and enough bytes to hold something. Checked on
 * disk rather than in the transcript because the claim and the artifact come
 * apart exactly here.
 */
function wroteADocument(extension: string): Assertion {
  const text = `wrote a ${extension} that is a real document`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      const candidates = written.filter((file) =>
        file.toLowerCase().endsWith(extension),
      );
      if (candidates.length === 0) {
        return fail(text, `no ${extension} anywhere the task could write`);
      }
      for (const candidate of candidates) {
        const body = await fs.readFile(candidate).catch(() => {});
        if (!body || body.length < MIN_DOCUMENT_BYTES) {
          continue;
        }
        if (!body.subarray(0, 4).equals(ZIP_MAGIC)) {
          continue;
        }
        return pass(
          text,
          `${path.basename(candidate)}, ${Math.round(body.length / 1024)}KB`,
        );
      }
      const sizes = await Promise.all(
        candidates.map(async (file) => {
          const stat = await fs.stat(file).catch(() => {});
          return `${path.basename(file)} ${stat?.size ?? "?"}B`;
        }),
      );
      return fail(text, `found but not openable: ${sizes.join(", ")}`);
    },
    text,
  };
}

/**
 * The named members of a zip, inflated.
 *
 * OOXML is a zip and the interesting part is the slide XML inside it, so a
 * check that never opens the archive can only ever weigh the file. Written out
 * rather than taken as a dependency because it is thirty lines and the eval
 * suite has no other reason to carry an unzip: walk the local file headers,
 * which is enough for archives written by the Python libraries these tasks use.
 */
function zipMembers(archive: Buffer, matches: (name: string) => boolean) {
  const members: Buffer[] = [];
  let at = 0;
  while (at + 30 <= archive.length) {
    if (archive.readUInt32LE(at) !== 0x04_03_4b_50) {
      break;
    }
    const method = archive.readUInt16LE(at + 8);
    const compressed = archive.readUInt32LE(at + 18);
    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const name = archive.toString("utf8", at + 30, at + 30 + nameLength);
    const start = at + 30 + nameLength + extraLength;
    // A streamed entry puts its sizes in a trailing descriptor, so the length
    // is not knowable from the header; those are skipped rather than guessed.
    if (compressed === 0 && method !== 0) {
      break;
    }
    if (matches(name)) {
      const body = archive.subarray(start, start + compressed);
      try {
        members.push(method === 0 ? body : inflateRawSync(body));
      } catch {
        // A member we cannot inflate is one this check cannot speak for.
      }
    }
    at = start + compressed;
  }
  return members;
}

/**
 * A deck somebody designed, rather than the library's blank default.
 *
 * The gate is deliberately low: a background fill on every slide, three
 * explicit colors anywhere, and three shapes a slide. python-pptx's untouched
 * template scores zero, zero and two -- a title and a subtitle on white -- and
 * everything with any visual intent at all clears it comfortably. Measured
 * across four models the split was total: 0/0/2.0 against 7/5/4.0 and better,
 * with no model near the line.
 */
const deckWasDesigned: Assertion = {
  check: async ({ taskId }) => {
    const text =
      "designed the deck rather than leaving it on the blank default";
    const written = await deliverables(taskId);
    const decks = written.filter(
      (file) =>
        file.toLowerCase().endsWith(".pptx") && !file.includes("templates"),
    );
    for (const deck of decks) {
      const archive = await fs.readFile(deck).catch(() => {});
      if (!archive) {
        continue;
      }
      const slides = zipMembers(archive, (name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      ).map((slide) => slide.toString("utf8"));
      if (slides.length === 0) {
        continue;
      }
      const colors = new Set(
        slides.flatMap((slide) =>
          [...slide.matchAll(/srgbClr val="([\da-f]{6})"/gi)].map(
            (match) => match[1]?.toLowerCase() ?? "",
          ),
        ),
      );
      const shapes = slides.reduce(
        (total, slide) => total + [...slide.matchAll(/<p:(?:sp|pic)>/g)].length,
        0,
      );
      const filled = slides.filter((slide) => slide.includes("<p:bg>")).length;
      const perSlide = shapes / slides.length;
      const evidence = `${slides.length} slides, ${perSlide.toFixed(1)} shapes each, ${colors.size} colors, ${filled} with a background`;
      return filled === slides.length && colors.size >= 3 && perSlide >= 3
        ? pass(text, evidence)
        : fail(text, evidence);
    }
    return fail(text, "no deck to look at");
  },
  text: "designed the deck rather than leaving it on the blank default",
};

/**
 * Did it look at what it made before saying it was done?
 *
 * The task prompt already asks for this in as many words -- open the result the
 * way the user will see it and confirm it satisfies the request -- and it is
 * the habit that separates a report from a guess. Scored as a read of a file
 * the task itself produced, by any means: the file tool, or a shell command
 * that opens it.
 */
const checkedItsOwnWork: Assertion = {
  check: ({ sessions }) => {
    const text = "opened its own deliverable before reporting it done";
    const made = new Set<string>();
    const verified: string[] = [];
    for (const session of sessions) {
      for (const message of session.messages) {
        for (const part of message.parts) {
          if (
            part.type === "tool-write_file" ||
            part.type === "tool-edit_file"
          ) {
            const wrote: unknown = part.input?.filePath;
            if (typeof wrote === "string") {
              made.add(path.basename(wrote));
            }
          }
          const looked =
            part.type === "tool-read_file"
              ? String(part.input?.filePath ?? "")
              : part.type === "tool-bash"
                ? String(part.input?.command ?? "")
                : "";
          for (const name of made) {
            if (looked.includes(name)) {
              verified.push(name);
            }
          }
          // A file made by a script rather than a file tool still counts as
          // made, so a later read of it is still a check of its own work.
          if (part.type === "tool-bash") {
            for (const [, name] of String(part.input?.command ?? "").matchAll(
              /([\w-]+\.(?:docx|xlsx|pptx|png|pdf|csv|md))/g,
            )) {
              if (name) {
                made.add(name);
              }
            }
          }
        }
      }
    }
    return verified.length > 0
      ? pass(text, `read back: ${[...new Set(verified)].join(", ")}`)
      : fail(
          text,
          `made ${[...made].join(", ") || "nothing"}, opened none of it`,
        );
  },
  text: "opened its own deliverable before reporting it done",
};

/** A PNG, by its magic bytes, and big enough to be a real plot. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * A rendered image the model made, rather than a placeholder or a broken write.
 * The floor is low but not zero: matplotlib's smallest real chart is tens of
 * kilobytes, and a truncated write is a few hundred bytes.
 */
const MIN_IMAGE_BYTES = 8000;

/**
 * A figure only a real computation produces, in whatever the model wrote.
 *
 * Written with and without thousands separators, because which one a model
 * reaches for says nothing about whether it did the arithmetic.
 */
function reportContains(label: string, value: number): Assertion {
  const text = `got ${label} right`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      const readable = written.filter((file) =>
        /\.(?:md|txt|csv|html)$/i.test(file),
      );
      const rounded = Math.round(value);
      const wanted = [
        rounded.toLocaleString("en-US"),
        String(rounded),
        value.toFixed(2),
        Math.round(value / 1000).toLocaleString("en-US"),
      ];
      for (const file of readable) {
        const body = await fs.readFile(file, "utf8").catch(() => "");
        const flat = body.replaceAll(",", "").replaceAll("$", "");
        for (const candidate of wanted) {
          if (
            body.includes(candidate) ||
            flat.includes(candidate.replaceAll(",", ""))
          ) {
            return pass(text, `${path.basename(file)} names ${candidate}`);
          }
        }
      }
      return fail(
        text,
        readable.length === 0
          ? "no readable report written"
          : `${readable.map((file) => path.basename(file)).join(", ")} name none of ${wanted.join(" / ")}`,
      );
    },
    text,
  };
}

function wroteAnImage(): Assertion {
  const text = "wrote a PNG that is a real rendered image";
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      const images = written.filter((file) => file.toLowerCase().endsWith(".png"));
      for (const image of images) {
        const body = await fs.readFile(image).catch(() => {});
        if (
          body &&
          body.length >= MIN_IMAGE_BYTES &&
          body.subarray(0, 4).equals(PNG_MAGIC)
        ) {
          return pass(
            text,
            `${path.basename(image)}, ${Math.round(body.length / 1024)}KB`,
          );
        }
      }
      return fail(text, images.length === 0 ? "no PNG written" : `${images.length} PNG(s), none usable`);
    },
    text,
  };
}

/** Something a browser would render, rather than a stub. */
const wroteAWebPage: Assertion = {
  check: async ({ taskId }) => {
    const text = "wrote an HTML page with its styling inside it";
    const written = await deliverables(taskId);
    for (const file of written.filter((one) => /\.html?$/i.test(one))) {
      const body = await fs.readFile(file, "utf8").catch(() => "");
      const styled = /<style[\s>]/i.test(body) || /style="/i.test(body);
      if (body.length > 1500 && /<body[\s>]/i.test(body) && styled) {
        return pass(
          text,
          `${path.basename(file)}, ${Math.round(body.length / 1024)}KB, styling inline`,
        );
      }
    }
    return fail(text, "no styled HTML page written");
  },
  text: "wrote an HTML page with its styling inside it",
};

export const WORKER_EVALS = [
  defineEval({
    // A visual deliverable, and the one that most needs looking at: a chart is
    // either legible or it is not, and only opening it tells you which.
    assertions: [wroteAnImage(), checkedItsOwnWork],
    name: "worker-chart",
    prompt:
      "From this data -- Q1 412, Q2 388, Q3 561, Q4 730 -- make a clean bar chart as a PNG called quarters.png in your output folder. Label the axes, title it 'Units shipped by quarter', and make it something you would put in a deck.",
  }),
  defineEval({
    assertions: [wroteAWebPage, checkedItsOwnWork],
    name: "worker-web-page",
    prompt:
      "Build a single-file landing page called index.html in your output folder for a made-up app that tracks houseplant watering. One page: a headline, three feature blurbs, and a sign-up form that does not need to submit anywhere. Style it inside the file; no external stylesheets.",
  }),
  defineEval({
    assertions: [
      reportContains("total revenue", 742_370.74),
      reportContains("the best region's revenue", 215_748.97),
      checkedItsOwnWork,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "worker-data-report",
    prompt:
      "The regional-sales.csv in my Data folder has a year of sales by region and month, with units and a unit price per row. Work out total revenue for the year, revenue per region, and which region did best, and write it up as summary.md in your output folder with a short table. Revenue is units times unit price.",
  }),

  defineEval({
    assertions: [wroteADocument(".docx"), checkedItsOwnWork],
    name: "worker-word-document",
    prompt:
      "Write a one-page company overview for Meridian Robotics, a made-up industrial robotics firm, as a Word document called overview.docx in your output folder. Invent plausible details: what they make, who buys it, roughly how big they are. Headings and a couple of short sections.",
  }),
  defineEval({
    assertions: [wroteADocument(".xlsx"), checkedItsOwnWork],
    name: "worker-spreadsheet",
    prompt:
      "Build a simple 12-month budget for a made-up coffee shop as an Excel file called budget.xlsx in your output folder. Months down the side, a few expense categories across the top, plausible numbers, and a total row that actually sums the columns with a formula.",
  }),
  defineEval({
    assertions: [wroteADocument(".pptx"), deckWasDesigned, checkedItsOwnWork],
    name: "worker-deck",
    prompt:
      "Make a 5-slide PowerPoint called pitch.pptx in your output folder introducing a made-up meal-kit startup: title slide, the problem, the product, the market, and how they make money. A title and a few bullets per slide.",
  }),
];
