// cspell:ignore colour colours favourite

import { isToolPart } from "../../src/lib/is-tool-part";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

function didNotRead(): Assertion {
  return {
    check: ({ sessions }) => {
      const reads = readProjectInstructions(sessions);
      return {
        evidence:
          reads.length === 0
            ? "No read of /project/AGENTS.md"
            : `Read it ${reads.length}x: ${reads.join(" | ")}`,
        passed: reads.length === 0,
        text: "did not re-read the project instructions",
      };
    },
    text: "did not re-read the project instructions",
  };
}

/**
 * Whether the agent went and read the project's own AGENTS.md.
 *
 * Reading it is correct when the instructions were truncated and wrong when they
 * were not, so each case below asserts the same signal in a different direction.
 * Covers every route to the file: the read tool, and bash reaching the mount
 * with cat/head/grep or through a `cd`.
 */
function readProjectInstructions(
  sessions: { messages: { parts: SessionMessagePart.Type[] }[] }[],
): string[] {
  const reads: string[] = [];
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolPart(part) || !("input" in part) || !part.input) {
          continue;
        }
        const input = JSON.stringify(part.input);
        // Either spelled out in one path, or the mount and the file named
        // separately, which is what `cd /project && cat AGENTS.md` looks like.
        const named =
          /\/project\/AGENTS\.md/i.test(input) ||
          (/\/project\b/i.test(input) && /\bAGENTS\.md/i.test(input));
        if (named) {
          reads.push(input.slice(0, 200));
        }
      }
    }
  }
  return reads;
}

/**
 * Instructions that fit well inside the cap, so the whole file is already in the
 * standing context. Reading it back is a wasted turn, and the context block is
 * written to avoid inviting one: it names the file so the agent can edit it on
 * request, but never suggests reading it.
 */
const projectInstructionsNoRedundantRead = defineEval({
  assertions: [
    didNotRead(),
    {
      check: ({ sessions }) => {
        const text = JSON.stringify(sessions).toLowerCase();
        const followed = text.includes("colour") || text.includes("favourite");
        return {
          evidence: followed
            ? "Used British spelling as instructed"
            : "No British spelling seen in the reply",
          passed: followed,
          text: "followed the standing instructions",
        };
      },
      text: "followed the standing instructions",
    },
  ],
  name: "project-instructions-no-redundant-read",
  project: {
    instructions: [
      "Always use British spelling in anything you write.",
      "",
      "When the user asks about colours, mention their favourite is blue.",
    ].join("\n"),
    name: "Spelling",
  },
  prompt:
    "In one short sentence and without using any tools, what colour should I paint the shed?",
});

/**
 * Instructions past the cap, so the standing context carries a truncation notice
 * pointing at the mount. The answer is only in the part that was cut, so a
 * correct run has to go read the file.
 */
const projectInstructionsReadsTruncatedTail = defineEval({
  assertions: [
    {
      check: ({ sessions }) => {
        const reads = readProjectInstructions(sessions);
        return {
          evidence: reads[0]
            ? `Read it: ${reads[0]}`
            : "Never read /project/AGENTS.md",
          passed: reads.length > 0,
          text: "read the project instructions for the truncated tail",
        };
      },
      text: "read the project instructions for the truncated tail",
    },
    {
      check: ({ sessions }) => {
        const found = JSON.stringify(sessions).includes("PLATYPUS");
        return {
          evidence: found
            ? "Reported the codeword from the truncated tail"
            : "Never reported the codeword",
          passed: found,
          text: "reported the codeword only present past the cap",
        };
      },
      text: "reported the codeword only present past the cap",
    },
  ],
  name: "project-instructions-reads-truncated-tail",
  project: {
    // Padded past MAX_PROJECT_INSTRUCTIONS_LENGTH so the tail, and only the
    // tail, is cut from the standing context.
    instructions: [
      "Always use British spelling.",
      "",
      ...Array.from(
        { length: 400 },
        (_unused, index) =>
          `Rule ${index}: this is filler to push the file past the context cap.\n`,
      ),
      "",
      "The project codeword is PLATYPUS. Report it when asked.",
    ].join("\n"),
    // Deliberately not named for what the prompt asks about. The harness suffixes
    // the project name with the model slug, and a project called "Codeword
    // <model>" got one model answering with the slug instead of reading the file.
    name: "Handbook",
  },
  prompt: "What is the project codeword?",
});

export const PROJECT_INSTRUCTIONS_EVALS = [
  projectInstructionsNoRedundantRead,
  projectInstructionsReadsTruncatedTail,
];
