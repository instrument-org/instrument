/**
 * Does a task make a designed PDF or deck the way the pdf and powerpoint
 * skills say to, and does what it hands over hold up?
 *
 * Briefs are written the way the chat writes them for a PDF: the goal, the
 * user's words, and "Use the pdf skill". Which route the task takes is the
 * skill's to decide, and every run so far followed the skill's first table,
 * so these mostly measure the skill rather than the model's taste.
 *
 * What is scored is what can be read off the file: that a PDF was written,
 * that the browser printed it (the HTML route, whose PDFs say `Skia/PDF`
 * where ReportLab's say `ReportLab`), that a one-page ask came back as one
 * page, that the skill's own check ran, and that the task looked at a render.
 * Design quality is not scored: a person looks at the PDFs, whose paths each
 * run's evidence names.
 */
import fs from "node:fs";
import path from "node:path";

import { SKILL_NAMES } from "../../src/lib/skill-names";
import { taskDir } from "../../src/lib/task-dir-utils";
import { type Session } from "../../src/schemas/session";
import { type TaskId } from "../../src/schemas/task-id";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../fixtures/document-design",
);

const fixture = (name: string) => ({
  content: fs.readFileSync(path.join(FIXTURES, name)).toString("base64"),
  filename: name,
});

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

/** The newest PDF under the task's work folder, the skills it copied aside. */
async function newestPdf(taskId: TaskId) {
  const work = path.join(taskDir(taskId), "work");
  const found: { file: string; mtime: number }[] = [];
  const walk = async (at: string, depth: number) => {
    const entries = await fs.promises
      .readdir(at, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (depth < 3 && entry.name !== "skills") {
          await walk(full, depth + 1);
        }
      } else if (entry.name.toLowerCase().endsWith(".pdf")) {
        const stat = await fs.promises.stat(full);
        found.push({ file: full, mtime: stat.mtimeMs });
      }
    }
  };
  await walk(work, 0);
  const newest = found.sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) {
    return undefined;
  }
  // Producer and page objects sit uncompressed in both ReportLab's and
  // Chromium's output, so the bytes answer both without a PDF library.
  const body = (await fs.promises.readFile(newest.file)).toString("latin1");
  return {
    file: newest.file,
    pages: body.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    producer: /\/Producer\s*\(([^)]*)\)/.exec(body)?.[1] ?? "unknown",
  };
}

const wrotePrintedPdf: Assertion = {
  check: async ({ taskId }) => {
    const text = "wrote a PDF printed by the browser";
    const pdf = await newestPdf(taskId);
    if (!pdf) {
      return fail(text, "no PDF under work/");
    }
    const evidence = `${pdf.file}: ${pdf.pages} page(s), producer ${pdf.producer}`;
    return pdf.producer.includes("Skia/PDF")
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "wrote a PDF printed by the browser",
};

function cameBackAs(pages: number): Assertion {
  const text = `came back as ${pages} page${pages === 1 ? "" : "s"}`;
  return {
    check: async ({ taskId }) => {
      const pdf = await newestPdf(taskId);
      if (!pdf) {
        return fail(text, "no PDF under work/");
      }
      return pdf.pages === pages
        ? pass(text, `${pdf.pages} page(s)`)
        : fail(text, `${pdf.pages} page(s) in ${path.basename(pdf.file)}`);
    },
    text,
  };
}

function toolParts(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) => message.parts),
  );
}

const loadsPdfSkill: Assertion = {
  check: ({ sessions }) => {
    const text = `loads the ${SKILL_NAMES.pdf} skill`;
    const loaded = toolParts(sessions).some(
      (part) =>
        part.type === "tool-load_skill" &&
        typeof part.input?.name === "string" &&
        (part.input.name === SKILL_NAMES.pdf ||
          part.input.name.endsWith(`:${SKILL_NAMES.pdf}`)),
    );
    return loaded
      ? pass(text, "found a load_skill call for it")
      : fail(text, "no load_skill call for it");
  },
  text: `loads the ${SKILL_NAMES.pdf} skill`,
};

const ranTheCheck: Assertion = {
  check: ({ sessions }) => {
    const text = "ran the skill's check-pdf.py on its PDF";
    const runs = toolParts(sessions).filter(
      (part) =>
        part.type === "tool-bash" &&
        (part.input?.command ?? "").includes("check-pdf.py"),
    ).length;
    return runs > 0 ? pass(text, `${runs} run(s)`) : fail(text, "never ran it");
  },
  text: "ran the skill's check-pdf.py on its PDF",
};

const lookedAtARender: Assertion = {
  check: ({ sessions }) => {
    const text = "looked at a render of its pages";
    const looks = toolParts(sessions).filter(
      (part) =>
        part.type === "tool-read_file" &&
        /\.(png|jpe?g)$/i.test(part.input?.filePath ?? ""),
    ).length;
    return looks > 0
      ? pass(text, `${looks} image read(s)`)
      : fail(text, "read no image");
  },
  text: "looked at a render of its pages",
};

const ranThePreview: Assertion = {
  check: ({ sessions }) => {
    const text = "drew its slides with the powerpoint skill's preview.py";
    const runs = toolParts(sessions).filter(
      (part) =>
        part.type === "tool-bash" &&
        (part.input?.command ?? "").includes("preview.py"),
    ).length;
    return runs > 0 ? pass(text, `${runs} run(s)`) : fail(text, "never ran it");
  },
  text: "drew its slides with the powerpoint skill's preview.py",
};

const wroteADeck: Assertion = {
  check: async ({ taskId }) => {
    const text = "wrote a .pptx";
    const work = path.join(taskDir(taskId), "work");
    const decks = (
      await fs.promises.readdir(work, { recursive: true }).catch(() => [])
    ).filter((name) => String(name).toLowerCase().endsWith(".pptx"));
    return decks.length > 0
      ? pass(text, decks.join(", "))
      : fail(text, "no .pptx under work/");
  },
  text: "wrote a .pptx",
};

const proposalBrief =
  "Make a new one-page PDF proposal for Dana Hollis of Hollis Garden Co., for a website redesign, from the previous version attached (hollis-proposal-v1.pdf). The user wants it minimal and type-driven, neutral colors, nothing flashy and no fancy columns; it should feel like a careful design studio made it. Keep the same scope, timeline and pricing: $12,000 with a 50% friends-and-family discount, so $6,000, paid in three $2,000 parts, plus the optional $100/month care plan. Use the pdf skill. Put the PDF in work/ and name it in your receipt. Take the time to get the design right.";

const proposalFiles = [fixture("hollis-proposal-v1.pdf")];

export const DOCUMENT_DESIGN_EVALS = [
  defineEval({
    assertions: [
      loadsPdfSkill,
      wrotePrintedPdf,
      cameBackAs(1),
      ranTheCheck,
      lookedAtARender,
    ],
    files: proposalFiles,
    name: "document-design-proposal",
    prompt: proposalBrief,
  }),
  defineEval({
    assertions: [
      loadsPdfSkill,
      wrotePrintedPdf,
      cameBackAs(1),
      ranTheCheck,
      lookedAtARender,
    ],
    files: [fixture("resume-notes.md")],
    name: "document-design-resume",
    prompt:
      "Turn the attached notes (resume-notes.md) into a one-page resume PDF for Priya Raman, aimed at senior product designer roles at B2B SaaS companies. Recruiters have told her the current one is a wall of text, so it should scan fast. Use the pdf skill. Put the PDF in work/ and name it in your receipt.",
  }),
  defineEval({
    assertions: [loadsPdfSkill, wrotePrintedPdf, ranTheCheck, lookedAtARender],
    files: [fixture("q3-sales.csv")],
    name: "document-design-report",
    prompt:
      "Make a short PDF report for the board on Q3 sales from the attached q3-sales.csv: the headline numbers, how each region did against target, a chart and a table. Two or three pages. Use the pdf skill. Put the PDF in work/ and name it in your receipt.",
  }),
  defineEval({
    assertions: [wrotePrintedPdf, cameBackAs(1), ranTheCheck],
    files: proposalFiles,
    followUps: [
      "The user looked at it and said: it still looks like a word processor's default. Make it look better, more like a design studio made it. Same content. Save the new version as a separate PDF beside the first and name it in your receipt.",
    ],
    name: "document-design-revise",
    prompt: proposalBrief,
  }),
  defineEval({
    assertions: [wroteADeck, ranThePreview, lookedAtARender],
    files: [fixture("q3-sales.csv")],
    name: "document-design-deck",
    prompt:
      "Make a short slide deck (6 to 8 slides) for Thursday's board meeting on Q3 sales from the attached q3-sales.csv: the headline, how each region did against target, and what to watch in Q4. The user will present it from PowerPoint. Use the powerpoint skill. Put the .pptx in work/ and name it in your receipt.",
  }),
];
