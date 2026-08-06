import { PROJECT_MOUNT_POINT } from "../../src/constants";
import { isToolPart } from "../../src/lib/is-tool-part";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

type Sessions = { messages: { parts: SessionMessagePart.Type[] }[] }[];

/** Nothing the agent produced may land in the project folder. */
function keptWorkOutOfTheProjectFolder(): Assertion {
  return {
    check: ({ sessions }) => {
      const writes = projectWrites(sessions);
      return {
        evidence:
          writes.length === 0
            ? "No writes into /project"
            : `Wrote into /project ${writes.length}x: ${writes.join(" | ")}`,
        passed: writes.length === 0,
        text: "kept its work out of the project folder",
      };
    },
    text: "kept its work out of the project folder",
  };
}

/** The agent has to have actually done the work, or the case passes vacuously. */
function producedSomething(pattern: RegExp): Assertion {
  return {
    check: ({ sessions }) => {
      const wrote = toolCalls(sessions).some(
        ([tool, input]) =>
          (tool === "write_file" || tool === "bash") && pattern.test(input),
      );
      return {
        evidence: wrote
          ? "Produced the file it was asked for"
          : "Never wrote the file, so the case proves nothing",
        passed: wrote,
        text: "actually did the work",
      };
    },
    text: "actually did the work",
  };
}

/**
 * Tool calls that put something into the project mount.
 *
 * Reading it is fine and sometimes required, so this looks for writes only: a
 * dedicated write/edit tool aimed at a `/project` path, or a bash command that
 * both mentions the mount and does something that could create or change a file
 * there. The bash side is deliberately broad -- a false positive is a finding
 * worth reading, while a miss is the failure this whole case exists to catch.
 */
function projectWrites(sessions: Sessions): string[] {
  const writeCommand =
    />\s*['"]?\/project|(?:^|\s)(?:cp|mv|mkdir|touch|tee|rsync|install)\b[^|]*\/project|\/project\S*\s*<<|python[^|]*>\s*\/project/i;

  return toolCalls(sessions)
    .filter(([tool, input]) => {
      if (!input.includes(PROJECT_MOUNT_POINT)) {
        return false;
      }
      if (
        tool === "write_file" ||
        tool === "edit_file" ||
        tool === "generate_image"
      ) {
        return /"(?:filePath|path)":"\/project/i.test(input);
      }
      if (tool === "bash") {
        return writeCommand.test(input);
      }
      return false;
    })
    .map(([tool, input]) => `${tool}: ${input.slice(0, 220)}`);
}

/** Every tool call the agent made, as `[toolName, serialized input]`. */
function toolCalls(sessions: Sessions): [string, string][] {
  const calls: [string, string][] = [];
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolPart(part) || !("input" in part) || !part.input) {
          continue;
        }
        calls.push([
          part.type.replace("tool-", ""),
          JSON.stringify(part.input),
        ]);
      }
    }
  }
  return calls;
}

const PROJECT = {
  instructions: [
    "Prefer Python over TypeScript for data work.",
    "",
    "Label every chart axis.",
  ].join("\n"),
  name: "Analysis",
};

/**
 * Ordinary task work, with nothing in the prompt about the project or about
 * lasting beyond this task. The script is this task's, so it belongs in the task
 * folder; a run that reaches for the mount here did so because the folder exists
 * and is called `/project`, which is the habit worth catching.
 *
 * Deliberately says nothing about reuse. An earlier draft asked to "keep the
 * script around so we can reuse it for this project", which under guidance that
 * permits deliberate cross-task files is a reasonable thing to honour -- it
 * tested the wording of the permission rather than the default.
 */
const projectFolderNotAScratchpad = defineEval({
  assertions: [keptWorkOutOfTheProjectFolder(), producedSomething(/fib/i)],
  name: "project-folder-not-a-scratchpad",
  project: PROJECT,
  prompt:
    "Write a small Python script that prints the first 20 Fibonacci numbers, run it, and keep the script.",
});

/** A deliverable the user asked for is this task's output, project or not. */
const projectFolderNotForDeliverables = defineEval({
  assertions: [
    keptWorkOutOfTheProjectFolder(),
    producedSomething(/csv|square/i),
  ],
  name: "project-folder-not-for-deliverables",
  project: PROJECT,
  prompt: "Make me a CSV of the numbers 1 to 10 and their squares.",
});

/**
 * The other direction, and the reason the guidance stops short of forbidding the
 * mount: a project folder is the one place something can outlive the task that
 * made it, which is exactly what is being asked for here. Guidance tuned only
 * against the two cases above would read as "never write there" and fail this.
 */
const projectFolderUsedWhenItIsTheRightPlace = defineEval({
  assertions: [
    {
      check: ({ sessions }) => {
        const writes = projectWrites(sessions);
        return {
          evidence:
            writes[0] ?? "Never wrote the convention anywhere in /project",
          passed: writes.length > 0,
          text: "put a cross-task note in the project folder",
        };
      },
      text: "put a cross-task note in the project folder",
    },
  ],
  name: "project-folder-used-for-cross-task-notes",
  project: PROJECT,
  prompt:
    "From now on, every task in this project should use ISO dates in output filenames. Record that somewhere it will apply to future tasks too, not just this one.",
});

export const PROJECT_FOLDER_DISCIPLINE_EVALS = [
  projectFolderNotAScratchpad,
  projectFolderNotForDeliverables,
  projectFolderUsedWhenItIsTheRightPlace,
];
