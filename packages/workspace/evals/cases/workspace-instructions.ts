import fs from "node:fs/promises";
import path from "node:path";

import { getWorkspaceConfig } from "../../src/lib/workspace-config";
import { defineEval, type Assertion } from "../harness";

const ENDING = "Workspace check: cedar-47";
const RULE = `End arithmetic answers with a line containing: ${ENDING}`;

const followsWorkspaceInstructions: Assertion = {
  text: "answers the question and follows the workspace's standing instruction",
  check: ({ sessions }) => {
    const reply = sessions
      .flatMap((session) => session.messages)
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.parts)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return {
      text: "answers the question and follows the workspace's standing instruction",
      evidence: reply.slice(-500),
      passed:
        /\b42\b/.test(reply) &&
        reply.trimEnd().replace(/[.!]$/, "").endsWith(ENDING),
    };
  },
};

async function seed(instructions: string) {
  await fs.writeFile(
    path.join(getWorkspaceConfig().rootDir, "AGENTS.md"),
    instructions,
  );
}

export const WORKSPACE_INSTRUCTIONS_EVALS = [
  defineEval({
    name: "workspace-instructions-direct-request",
    kind: "chat",
    prompt: "What is 6 times 7? Reply with just the number, with nothing else.",
    setup: () => seed(RULE),
    assertions: [
      {
        text: "a direct request takes precedence over workspace instructions",
        check: ({ sessions }) => {
          const reply = sessions
            .flatMap((session) => session.messages)
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.parts)
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
            .trim();
          return {
            text: "a direct request takes precedence over workspace instructions",
            evidence: reply,
            passed: reply === "42",
          };
        },
      },
    ],
  }),
  defineEval({
    name: "workspace-instructions-chat",
    kind: "chat",
    prompt: "What is 6 times 7?",
    setup: () => seed(RULE),
    assertions: [followsWorkspaceInstructions],
  }),
  defineEval({
    name: "workspace-instructions-long-task",
    prompt: "What is 6 times 7?",
    setup: () => seed(`${RULE}\n\n${"Use clear sentences.\n\n".repeat(5000)}`),
    assertions: [followsWorkspaceInstructions],
  }),
];
