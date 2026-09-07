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
 * What these cannot see: web search and the browser are stubbed in the harness,
 * so research and page-driving -- a third of the real corpus -- are not scored
 * here at all.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { taskDir } from "../../src/lib/task-dir-utils";
import { type TaskId } from "../../src/schemas/task-id";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

/** The four bytes every OOXML file starts with, being a zip. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

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

export const WORKER_EVALS = [
  defineEval({
    assertions: [wroteADocument(".docx")],
    name: "worker-word-document",
    prompt:
      "Write a one-page company overview for Meridian Robotics, a made-up industrial robotics firm, as a Word document called overview.docx in your output folder. Invent plausible details: what they make, who buys it, roughly how big they are. Headings and a couple of short sections.",
  }),
  defineEval({
    assertions: [wroteADocument(".xlsx")],
    name: "worker-spreadsheet",
    prompt:
      "Build a simple 12-month budget for a made-up coffee shop as an Excel file called budget.xlsx in your output folder. Months down the side, a few expense categories across the top, plausible numbers, and a total row that actually sums the columns with a formula.",
  }),
  defineEval({
    assertions: [wroteADocument(".pptx")],
    name: "worker-deck",
    prompt:
      "Make a 5-slide PowerPoint called pitch.pptx in your output folder introducing a made-up meal-kit startup: title slide, the problem, the product, the market, and how they make money. A title and a few bullets per slide.",
  }),
];
