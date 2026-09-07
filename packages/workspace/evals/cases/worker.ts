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
 * What these cannot see: web search is stubbed in the harness, so research -- a
 * third of the real corpus -- is not scored here at all. The browser is real,
 * but it is one the CLI starts rather than the task's own view, so what is
 * scored is a task's ability to open a page, not the in-app browsing surface.
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

/** Six espresso machines whose specs decide the answer to the case below. */
const SHOPPING_FIXTURE = path.resolve(
  import.meta.dirname,
  "../fixtures/Shopping",
);

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
      const images = written.filter((file) =>
        file.toLowerCase().endsWith(".png"),
      );
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
      return fail(
        text,
        images.length === 0
          ? "no PNG written"
          : `${images.length} PNG(s), none usable`,
      );
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

/**
 * A figure only a real computation produces, in a document that has to be
 * unzipped to read. The same question `reportContains` asks of a Markdown
 * file, asked of the format a memo actually arrives in -- and the one where a
 * model can most easily write a confident sentence around a number it never
 * worked out.
 */
function documentContains(label: string, value: number): Assertion {
  const text = `got ${label} right`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      const docs = written.filter((file) =>
        file.toLowerCase().endsWith(".docx"),
      );
      const rounded = Math.round(value);
      const wanted = [
        rounded.toLocaleString("en-US"),
        String(rounded),
        value.toFixed(2),
        Math.round(value / 1000).toLocaleString("en-US"),
      ];
      for (const doc of docs) {
        const body = await docxText(doc);
        const flat = body.replaceAll(",", "").replaceAll("$", "");
        for (const candidate of wanted) {
          if (
            body.includes(candidate) ||
            flat.includes(candidate.replaceAll(",", ""))
          ) {
            return pass(text, `${path.basename(doc)} names ${candidate}`);
          }
        }
      }
      return fail(
        text,
        docs.length === 0
          ? "no Word document written"
          : `${docs.length} written, none naming ${wanted.join(" / ")}`,
      );
    },
    text,
  };
}

/** The readable text of a Word document, tags stripped. */
async function docxText(file: string): Promise<string> {
  const archive = await fs.readFile(file).catch(() => {});
  if (!archive) {
    return "";
  }
  return zipMembers(archive, (name) => name === "word/document.xml")
    .map((part) => part.toString("utf8"))
    .join("")
    .replaceAll(/<[^>]+>/g, " ");
}

/**
 * A file of the asked-for kind with enough in it to be worth looking at.
 *
 * Deliberately loose. These cases exist to be compared by eye, side by side,
 * and a threshold tight enough to rank them would be a threshold encoding one
 * person's taste into the suite. What it does catch is the failure that matters
 * -- nothing written, or a stub written and reported as finished.
 */
function wroteSomethingToLookAt(
  extension: string,
  minBytes: number,
): Assertion {
  const text = `wrote a ${extension} worth opening`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      const matches = written.filter(
        (file) =>
          file.toLowerCase().endsWith(extension) && !file.includes("templates"),
      );
      for (const file of matches) {
        const body = await fs.readFile(file).catch(() => {});
        if (body && body.length >= minBytes) {
          return pass(
            text,
            `${path.basename(file)}, ${Math.round(body.length / 1024)}KB`,
          );
        }
      }
      return fail(
        text,
        matches.length === 0
          ? `no ${extension} written`
          : `${matches.length} written, all under ${minBytes} bytes`,
      );
    },
    text,
  };
}

/**
 * A picture inside the document rather than beside it.
 *
 * Rendering a chart is one job and getting it into the file is another, and the
 * second is where a task quietly settles for a paragraph describing the chart
 * it made. OOXML puts embedded media under `<part>/media/`, so the archive
 * answers this without opening the document.
 */
const embeddedAnImage: Assertion = {
  check: async ({ taskId }) => {
    const text = "put the chart inside the document";
    const written = await deliverables(taskId);
    const docs = written.filter((file) => /\.(?:docx|pptx)$/i.test(file));
    for (const doc of docs) {
      const archive = await fs.readFile(doc).catch(() => {});
      if (!archive) {
        continue;
      }
      const media = zipMembers(archive, (name) =>
        /^(?:word|ppt)\/media\/.+\.(?:png|jpe?g|gif|emf)$/i.test(name),
      );
      if (media.length > 0) {
        const biggest = Math.max(...media.map((one) => one.length));
        return pass(
          text,
          `${path.basename(doc)} embeds ${media.length} image(s), largest ${Math.round(biggest / 1024)}KB`,
        );
      }
    }
    return fail(
      text,
      docs.length === 0 ? "no document written" : "document embeds no image",
    );
  },
  text: "put the chart inside the document",
};

/**
 * A spreadsheet that recomputes, rather than a table of answers typed into
 * cells.
 *
 * Counting formulas is not enough, and neither is counting sheets. Measured
 * across seven workbooks, there were three separate ways to look computed and
 * not be: the per-row revenue typed in as literals with a live summary over
 * them, a live per-row revenue under a summary of literals, and both at once.
 * An edit to a unit price only reaches the totals when the rows compute *and*
 * the aggregation points back at them, so the rule is both -- formulas on more
 * than one sheet, and at least one of them reaching across a sheet boundary.
 * That splits the same seven cleanly, with the three near-misses on the
 * failing side.
 */
const sheetRecomputes: Assertion = {
  check: async ({ taskId }) => {
    const text = "built a workbook that recomputes when an input changes";
    const written = await deliverables(taskId);
    for (const book of written.filter((one) => /\.xlsx$/i.test(one))) {
      const archive = await fs.readFile(book).catch(() => {});
      if (!archive) {
        continue;
      }
      const sheets = zipMembers(archive, (name) =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
      ).map((sheet) =>
        [...sheet.toString("utf8").matchAll(/<f[^>]*>([^<]*)<\/f>/g)].map(
          (match) => match[1] ?? "",
        ),
      );
      const live = sheets.filter((formulas) => formulas.length > 0);
      // A reference carrying a sheet name is the link between the rows and the
      // totals; without one the summary is a picture of the rows at write time.
      const across = sheets.flat().filter((formula) => formula.includes("!"));
      const evidence = `${path.basename(book)}, formulas per sheet: ${sheets.map((one) => one.length).join(", ") || "none"}, ${across.length} reaching another sheet`;
      return live.length >= 2 && across.length > 0
        ? pass(text, evidence)
        : fail(text, evidence);
    }
    return fail(text, "no workbook written");
  },
  text: "built a workbook that recomputes when an input changes",
};

/**
 * A chart the spreadsheet owns, rather than a picture pasted beside it.
 *
 * A native chart part redraws when the numbers change and an embedded PNG does
 * not, which is the same live-versus-dead distinction the formulas check makes.
 * Either counts as having produced something to look at; only one of them is a
 * spreadsheet doing its job, so the evidence says which.
 */
const sheetHasAChart: Assertion = {
  check: async ({ taskId }) => {
    const text = "put a chart in the workbook";
    const written = await deliverables(taskId);
    for (const book of written.filter((one) => /\.xlsx$/i.test(one))) {
      const archive = await fs.readFile(book).catch(() => {});
      if (!archive) {
        continue;
      }
      const charts = zipMembers(archive, (name) =>
        /^xl\/charts\/chart\d+\.xml$/.test(name),
      ).length;
      const images = zipMembers(archive, (name) =>
        /^xl\/media\/.+\.(?:png|jpe?g)$/i.test(name),
      ).length;
      const evidence = `${charts} native chart(s), ${images} embedded image(s)`;
      return charts > 0 || images > 0
        ? pass(text, evidence)
        : fail(text, "no chart and no image");
    }
    return fail(text, "no workbook written");
  },
  text: "put a chart in the workbook",
};

/** Every option the brief supplied, so a comparison cannot quietly drop half. */
function comparedEvery(names: string[]): Assertion {
  const text = `compared all ${names.length} of them`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      for (const file of written.filter((one) =>
        /\.(?:html?|md)$/i.test(one),
      )) {
        const body = visibleText(
          await fs.readFile(file, "utf8").catch(() => ""),
        );
        const missing = names.filter((name) => !body.includes(name));
        if (body.length > 500 && missing.length === 0) {
          return pass(text, `${path.basename(file)} names every one`);
        }
        if (body.length > 500) {
          return fail(
            text,
            `${path.basename(file)} omits ${missing.join(", ")}`,
          );
        }
      }
      return fail(text, "nothing written to compare in");
    },
    text,
  };
}

/** Whichever of `names` appears earliest, so a runner-up cannot be read as the pick. */
function firstNamed(window: string, names: string[]): string | undefined {
  return names
    .map((name) => [window.indexOf(name), name] as const)
    .filter(([at]) => at !== -1)
    .sort(([a], [b]) => a - b)[0]?.[1];
}

/**
 * The pick the supplied data actually supports.
 *
 * A shopping comparison is only worth anything if the recommendation survives
 * the constraints in the brief, and those constraints have exactly one or two
 * right answers here. Read from the recommendation itself rather than the whole
 * page, because every option is named somewhere on a comparison page by
 * definition; the run of text after the word "recommend" is where the model
 * commits.
 */
function recommended(allowed: string[], rejected: string[]): Assertion {
  const text = `recommended one the constraints allow`;
  return {
    check: async ({ taskId }) => {
      const written = await deliverables(taskId);
      for (const file of written.filter((one) =>
        /\.(?:html?|md)$/i.test(one),
      )) {
        const body = await fs.readFile(file, "utf8").catch(() => "");
        if (body.length < 500) {
          continue;
        }
        const flat = visibleText(body);
        const windows = [...flat.matchAll(/recommend/gi)].map((match) =>
          flat.slice(match.index, match.index + 300),
        );
        if (windows.length === 0) {
          return fail(text, `${path.basename(file)} never recommends anything`);
        }
        // The first product a window names is the one it is recommending;
        // anything after that is the runner-up or the reason. Any window may
        // carry the verdict, because a page is as likely to head the panel
        // "Our recommendation" as to end a paragraph with one.
        const picks = windows
          .map((window) => firstNamed(window, [...allowed, ...rejected]))
          .filter((name) => name !== undefined);
        const right = picks.find((name) => allowed.includes(name));
        return right
          ? pass(text, `picked ${right}`)
          : fail(
              text,
              picks.length > 0
                ? `picked ${picks[0]}, which the brief rules out`
                : `named none of ${allowed.join(" or ")}`,
            );
      }
      return fail(text, "nothing written to recommend in");
    },
    text,
  };
}

/**
 * What a reader sees, which is not what the file contains.
 *
 * A styled single-file page is mostly CSS, and CSS is full of the vocabulary
 * these checks look for: a rule for `tr.recommended` put the word "recommend"
 * 4KB before the verdict and cost one model a passing run it had earned. Drop
 * the head, the style and the script blocks before reading anything as prose.
 */
function visibleText(html: string): string {
  return html
    .replaceAll(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ");
}

export const WORKER_EVALS = [
  defineEval({
    // Drawing from nothing, in a format the model writes by hand rather than
    // through a library: no toolchain to lean on, only whether it can picture
    // the thing and lay out coordinates for it.
    assertions: [wroteSomethingToLookAt(".svg", 1200), checkedItsOwnWork],
    name: "worker-svg-drawing",
    prompt:
      "Draw a pelican riding a bicycle as a single SVG file called pelican.svg in your output folder, about 800 by 600. Hand-written SVG, no libraries and no embedded images. It should be recognizable as both a pelican and a bicycle.",
  }),
  defineEval({
    // The same skill as the pelican, asked for a subject no model has drawn
    // before. Two familiar things in an arrangement nobody publishes, so what
    // comes back is composition rather than recall -- and the count is the
    // tell: five pins in flight is a spatial problem, and a model working from
    // a remembered picture has no picture to remember.
    assertions: [wroteSomethingToLookAt(".svg", 1200), checkedItsOwnWork],
    name: "worker-svg-juggling",
    prompt:
      "Draw an octopus juggling five bowling pins as a single SVG file called juggler.svg in your output folder, about 800 by 600. Hand-written SVG, no libraries and no embedded images. All eight arms visible, all five pins in the air on an arc above it, and the pins should be different sizes.",
  }),
  defineEval({
    // A creature and a machine, where the machine has parts that have to be in
    // the right places relative to each other and to the animal using it.
    assertions: [wroteSomethingToLookAt(".svg", 1200), checkedItsOwnWork],
    name: "worker-svg-sewing",
    prompt:
      "Draw an axolotl using a sewing machine as a single SVG file called sewing.svg in your output folder, about 800 by 600. Hand-written SVG, no libraries and no embedded images. The axolotl's frilly gills should be visible, and the sewing machine needs a needle over the fabric, a spool of thread on top and a hand wheel on the side.",
  }),
  defineEval({
    assertions: [wroteSomethingToLookAt(".pdf", 20_000), checkedItsOwnWork],
    name: "worker-poster",
    prompt:
      "Make a one-page A4 poster as a PDF called poster.pdf in your output folder, advertising a made-up neighborhood record shop's weekend sale. Big type, a couple of colors, the date and address readable from across a room. It should look designed, not like a memo.",
  }),
  defineEval({
    // The shape of work this product is used for most: a screen drawn to be
    // argued about, where the judgment is layout and hierarchy rather than
    // whether anything runs.
    assertions: [wroteSomethingToLookAt(".html", 2000), checkedItsOwnWork],
    name: "worker-wireframe",
    prompt:
      "Draw a wireframe of a mobile expense-tracking app's home screen as a single HTML file called wireframe.html in your output folder. Greyscale boxes and placeholder text, phone-sized frame centered on the page: a balance header, a filter row, a scrollable list of recent transactions with category icons, and a floating add button. Annotate two or three parts with short callouts beside the frame. No libraries.",
  }),
  defineEval({
    assertions: [wroteSomethingToLookAt(".html", 2500), checkedItsOwnWork],
    name: "worker-visual-explainer",
    prompt:
      "Explain how a CDN cache miss works as a single HTML page called explainer.html in your output folder. It has to be visual: a diagram you draw in SVG showing browser, edge server and origin with the request path across them, numbered steps beside it, and a short caption. One page, styling inside the file, no libraries.",
  }),
  defineEval({
    assertions: [wroteSomethingToLookAt(".html", 2000), checkedItsOwnWork],
    name: "worker-dashboard",
    prompt:
      "Build a single-file HTML dashboard called dashboard.html in your output folder for a made-up bike-share service: four headline stat tiles, a bar chart of rides by day of week, and a table of the five busiest stations. Invent plausible numbers. Draw the chart yourself in SVG or CSS; no chart libraries and no external files.",
  }),

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
    // Data in, a document out, with the chart inside it. Three jobs that fail
    // separately: the arithmetic, the plot, and getting the plot into the file
    // rather than describing it in a sentence beside one.
    assertions: [
      wroteADocument(".docx"),
      documentContains("total revenue", 742_370.74),
      embeddedAnImage,
      checkedItsOwnWork,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "worker-data-memo",
    prompt:
      "The regional-sales.csv in my Data folder has a year of sales by region and month, with units and a unit price per row -- revenue is units times unit price. Write it up as a one-page memo called memo.docx in your output folder for someone who will not open the spreadsheet: the total for the year up top, a table of revenue by region, a chart of monthly revenue actually embedded in the document, and one sentence saying what you would do about it. Lay it out so the point lands without reading every number.",
  }),
  defineEval({
    // The same data as the memo, asked for as a thing the user can drive rather
    // than a thing they read. What separates the two is whether the totals are
    // formulas and whether the chart is the workbook's own.
    assertions: [
      wroteADocument(".xlsx"),
      sheetRecomputes,
      sheetHasAChart,
      checkedItsOwnWork,
    ],
    folders: [{ access: "read-only", path: DATA_FIXTURE }],
    name: "worker-data-workbook",
    prompt:
      "The regional-sales.csv in my Data folder has a year of sales by region and month, with units and a unit price per row -- revenue is units times unit price. Turn it into a workbook called sales.xlsx in your output folder that I can actually work in: the rows with revenue worked out per row, a summary of revenue by region and by month that totals with real formulas rather than pasted numbers, and a chart of the monthly trend. Lay it out so I can find things, and make it so that changing a unit price updates everything downstream.",
  }),
  defineEval({
    // Shopping, with the research already done, which is how the product is
    // actually used: the data is supplied and the work is laying it out and
    // committing to a pick. The constraints leave exactly two defensible
    // answers, so the recommendation is scoreable rather than a matter of
    // taste.
    assertions: [
      wroteSomethingToLookAt(".html", 3000),
      comparedEvery([
        "Lumen Uno",
        "Lumen Duo Pro",
        "Corvo Bar 9",
        "Marlow M1",
        "Aster Compact",
        "Verano Studio",
      ]),
      recommended(
        ["Corvo Bar 9", "Marlow M1"],
        ["Lumen Uno", "Lumen Duo Pro", "Aster Compact", "Verano Studio"],
      ),
      checkedItsOwnWork,
    ],
    folders: [{ access: "read-only", path: SHOPPING_FIXTURE }],
    name: "worker-product-comparison",
    prompt:
      "espresso-machines.csv in my Shopping folder has six machines I am choosing between. Build me a single-file comparison page called compare.html in your output folder that lets me see the differences at a glance and ends with a clear recommendation. My budget is $700, I want a 58mm portafilter so my accessories fit, and I want PID temperature control. Everything else is a trade-off I want you to make for me: I pull one shot on a weekday morning and I am usually in a hurry. Style it inside the file, no libraries and no external images.",
  }),
  defineEval({
    // A visual explanation of a mechanism, which is the shape of a good half of
    // the real corpus: something with parts that move, two states worth
    // contrasting, a number where the answer flips, and a verdict at the end.
    assertions: [wroteSomethingToLookAt(".html", 3000), checkedItsOwnWork],
    name: "worker-mechanism-explainer",
    prompt:
      "Explain to me, someone with no engineering background, how a heat pump heats a house and when it stops beating a gas furnace. One HTML page called heat-pump.html in your output folder. It has to be visual: draw the refrigerant loop in SVG with the four parts labeled and arrows showing which way heat moves, show the same loop again running backwards for cooling, and put in a small chart of efficiency against outside temperature with the crossover point marked. End with a plain-language verdict. Styling inside the file, no libraries.",
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
