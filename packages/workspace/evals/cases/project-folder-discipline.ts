import {
  PROJECT_INSTRUCTIONS_FILE_NAME,
  PROJECT_MOUNT_POINT,
} from "../../src/constants";
import { isToolPart } from "../../src/lib/is-tool-part";
import { type SessionMessagePart } from "../../src/schemas/session/message-part";
import { type Assertion, defineEval } from "../harness";

type Sessions = { messages: { parts: SessionMessagePart.Type[] }[] }[];

/** A tool call, as its name and its serialized input. */
interface ToolCall {
  input: string;
  tool: string;
}

const INSTRUCTIONS_PATH = `${PROJECT_MOUNT_POINT}/${PROJECT_INSTRUCTIONS_FILE_NAME}`;

/** A shell redirect that replaces a file rather than appending to it. */
const TRUNCATING_REDIRECT = /(?<![>\d])>\s*['"]?\/project/;

/** Project writes rendered for an assertion's evidence line. */
function describeWrites(writes: ToolCall[]): string {
  return writes
    .map(({ input, tool }) => `${tool}: ${input.slice(0, 220)}`)
    .join(" | ");
}

/**
 * The standing instructions themselves have to change: a note filed next to
 * them is not what "change the project instructions" asked for, since only this
 * file is read into every later task's context.
 */
function editedTheProjectInstructions(): Assertion {
  const text = "edited the project's instructions file";
  return {
    check: ({ sessions }) => {
      const writes = instructionWrites(sessions);
      const others = projectWrites(sessions).filter(
        (write) => !writes.includes(write),
      );
      return {
        evidence:
          writes.length > 0
            ? describeWrites(writes)
            : `Never wrote ${INSTRUCTIONS_PATH}. Other project writes: ${others.length === 0 ? "none" : describeWrites(others)}`,
        passed: writes.length > 0,
        text,
      };
    },
    text,
  };
}

/** Project writes aimed at the file whose contents every task in the project sees. */
function instructionWrites(sessions: Sessions): ToolCall[] {
  return projectWrites(sessions).filter(({ input }) =>
    input.includes(INSTRUCTIONS_PATH),
  );
}

/**
 * Adding a rule must not cost the rules already there. The risk is specific to
 * a writable mount holding a file the agent did not author: a model that
 * rewrites rather than edits can drop standing instructions for every future
 * task in the project, and nothing downstream would notice.
 */
function keptTheExistingInstructions(instructions: string): Assertion {
  const text = "left the existing instructions intact";
  const rules = instructions.split("\n").filter(Boolean);
  return {
    check: ({ sessions }) => {
      const clobbered = instructionWrites(sessions).filter(
        ({ input, tool }) =>
          (tool === "write_file" || TRUNCATING_REDIRECT.test(input)) &&
          !rules.every((rule) => input.includes(rule)),
      );
      return {
        evidence:
          clobbered.length === 0
            ? "No wholesale rewrite dropped an existing rule"
            : `Replaced the file without carrying the existing rules: ${describeWrites(clobbered)}`,
        passed: clobbered.length === 0,
        text,
      };
    },
    text,
  };
}

/** Nothing the agent produced may land in the project folder. */
function keptWorkOutOfTheProjectFolder(): Assertion {
  return {
    check: ({ sessions }) => {
      const writes = projectWrites(sessions);
      return {
        evidence:
          writes.length === 0
            ? "No writes into /project"
            : `Wrote into /project ${writes.length}x: ${describeWrites(writes)}`,
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
        ({ input, tool }) =>
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
function projectWrites(sessions: Sessions): ToolCall[] {
  const writeCommand =
    />\s*['"]?\/project|(?:^|\s)(?:cp|mv|mkdir|touch|tee|rsync|install)\b[^|]*\/project|\/project\S*\s*<<|python[^|]*>\s*\/project/i;

  return toolCalls(sessions).filter(({ input, tool }) => {
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
  });
}

/** Every tool call the agent made. */
function toolCalls(sessions: Sessions): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (!isToolPart(part) || !("input" in part) || !part.input) {
          continue;
        }
        calls.push({
          input: JSON.stringify(part.input),
          tool: part.type.replace("tool-", ""),
        });
      }
    }
  }
  return calls;
}

/** Something has to land in the project folder, wherever inside it. */
function wroteIntoTheProjectFolder(text: string): Assertion {
  return {
    check: ({ sessions }) => {
      const writes = projectWrites(sessions);
      return {
        evidence:
          writes.length === 0
            ? `Nothing was written into ${PROJECT_MOUNT_POINT}`
            : describeWrites(writes),
        passed: writes.length > 0,
        text,
      };
    },
    text,
  };
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
    wroteIntoTheProjectFolder("put a cross-task note in the project folder"),
  ],
  name: "project-folder-used-for-cross-task-notes",
  project: PROJECT,
  prompt:
    "From now on, every task in this project should use ISO dates in output filenames. Record that somewhere it will apply to future tasks too, not just this one.",
});

/**
 * The instructions are named in the prompt, so the only question is whether the
 * agent knows they are a file it can reach and change. The second assertion is
 * the one worth having: adding a rule by replacing the file is how standing
 * instructions get silently lost.
 */
const projectInstructionsEditedOnRequest = defineEval({
  assertions: [
    editedTheProjectInstructions(),
    keptTheExistingInstructions(PROJECT.instructions),
  ],
  name: "project-instructions-edited-on-request",
  project: PROJECT,
  prompt:
    "Add a rule to the project instructions: every report should open with a one-paragraph summary.",
});

/**
 * Reference material for the project rather than a rule about how to work. It
 * belongs in the folder either as its own file or folded into the instructions,
 * so the assertion takes any write and the evidence line says which was chosen.
 */
const projectFolderTakesAReferenceFile = defineEval({
  assertions: [wroteIntoTheProjectFolder("kept the palette with the project")],
  name: "project-folder-takes-a-reference-file",
  project: PROJECT,
  prompt:
    "Our standard chart palette is blue #1f77b4, orange #ff7f0e, green #2ca02c. Put that in the project so it is on hand for later work.",
});

/**
 * The hard direction: a durable fact, and no instruction to write it down. The
 * correction cannot be satisfied inside this task -- there is no report here to
 * fix -- so acknowledging it and stopping leaves the next task to make the same
 * mistake. Passing means the agent read "for the whole project" as a reason to
 * use the one place that outlives the task.
 */
const projectFolderUsedWithoutBeingTold = defineEval({
  assertions: [
    wroteIntoTheProjectFolder("kept the correction where later tasks see it"),
  ],
  name: "project-folder-used-without-being-told",
  project: PROJECT,
  prompt:
    "Quick correction for the whole project: the client is Kowalczyk Industries, with a z. We have been writing Kowalski. Do not let that slip through again.",
});

export const PROJECT_FOLDER_DISCIPLINE_EVALS = [
  projectFolderNotAScratchpad,
  projectFolderNotForDeliverables,
  projectFolderTakesAReferenceFile,
  projectFolderUsedWhenItIsTheRightPlace,
  projectFolderUsedWithoutBeingTold,
  projectInstructionsEditedOnRequest,
];
