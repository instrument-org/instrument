import fs from "node:fs";
import path from "node:path";

import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

const pdfPath = path.resolve(
  import.meta.dirname,
  "../fixtures/pdf-retrieval/sample.pdf",
);
const pdfContent = fs.readFileSync(pdfPath).toString("base64");

/**
 * A `load_skill` call for one of `names`, however the agent spelled its
 * source: the catalog offers a skill the app ships as `instrument:pdf`, and
 * either spelling loads it.
 */
function loadsOneOf(names: string[]) {
  return (part: SessionMessagePart.Type): boolean =>
    part.type === "tool-load_skill" &&
    names.includes(
      String(part.input?.name ?? "")
        .split(/[:/]/)
        .at(-1) ?? "",
    );
}

function loadsSkill(names: string[]): Assertion {
  const text = `Loads the ${names.join(" or ")} skill`;
  const matches = loadsOneOf(names);
  return {
    check: ({ sessions }) => {
      const loaded = sessions.some((s) =>
        s.messages.some((m) => m.parts.some(matches)),
      );
      return {
        evidence: loaded
          ? `Found a load_skill call for ${names.join(" or ")}`
          : `No load_skill call for ${names.join(" or ")}`,
        passed: loaded,
        text,
      };
    },
    text,
  };
}

// Reading a PDF into Markdown is what the document-to-markdown skill is for;
// the pdf skill reads one too.
const READS_A_PDF = ["pdf", "document-to-markdown"];
const loadsOneThatReadsAPdf = loadsOneOf(READS_A_PDF);

export const PDF_SKILL_EVALS = [
  defineEval({
    assertions: [loadsSkill(READS_A_PDF)],
    files: [{ content: pdfContent, filename: "sample.pdf" }],
    name: "triggers-pdf-skill",
    prompt: "Convert this PDF to markdown",
    shouldStop: (part) =>
      loadsOneThatReadsAPdf(part) &&
      "state" in part &&
      part.state === "output-available",
  }),
  defineEval({
    assertions: [loadsSkill(["pdf"])],
    name: "create-pdf",
    prompt:
      "Make me a new PDF with a red square in it and a blue square below it",
  }),
];
