import { APP_NAME_SLUG } from "@instrument-org/shared";
/**
 * Does a model reach for the ```files fence on its own?
 *
 * The renderer can be made to parse anything; what decides the syntax is what
 * models emit mid-task without being reminded. These are the four situations
 * the fence exists for -- a deliverable written into a folder the user shared,
 * a set of files produced at once, a file found rather than made, and an answer
 * with no files in it at all.
 *
 * It matters more than a syntax check: the fence is the only record of what a
 * turn produced, so a turn that makes a file and does not name it produces
 * nothing the user sees. Adherence is a property of the prompt, which means it
 * has to be measured again whenever the prompt moves.
 */
import fs from "node:fs";
import path from "node:path";

import { AGENT_FILES_LANGUAGE } from "../../src/constants";
import { getCurrentFileInfo } from "../../src/lib/get-file-info";
import { MOUNT } from "../../src/mount-points";
import { type WorkspaceFilePath } from "../../src/schemas/paths";
import { type Session } from "../../src/schemas/session";
import { type Assertion, defineEval } from "../harness";

// The harness gives each run its own copy of these, so the writable one is
// named here as the committed fixture rather than as something built at load.
const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/files-fence");

// ---------------------------------------------------------------------------
// Reading the fence back out of a transcript
// ---------------------------------------------------------------------------

const FENCE = new RegExp(
  String.raw`^[ \t]*\x60{3,}[ \t]*${AGENT_FILES_LANGUAGE}[ \t]*$([\s\S]*?)^[ \t]*\x60{3,}[ \t]*$`,
  "gmu",
);

function assistantText(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) =>
      session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        ),
    )
    .join("\n\n");
}

function fenceBodies(text: string): string[] {
  return [...text.matchAll(FENCE)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * The renderer's tolerances deliberately left out: this is measuring what the
 * model wrote, so a line the parser would rescue still counts as a deviation.
 */
function fenceLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

// The fences verbatim, because the shape a model chose is the thing under test
// and a pass/fail column cannot show it.
const assertEmittedFence: Assertion = {
  check: ({ sessions }) => {
    const bodies = fenceBodies(assistantText(sessions));
    return {
      evidence:
        bodies.length === 0
          ? "No ```files fence in any assistant message"
          : bodies
              .map((body) => fenceLines(body).join(" | "))
              .join(" -- then -- "),
      passed: bodies.length > 0,
      text: "Emitted a files fence",
    };
  },
  text: "Emitted a files fence",
};

const assertOneFence: Assertion = {
  check: ({ sessions }) => {
    const bodies = fenceBodies(assistantText(sessions));
    return {
      evidence: `${bodies.length} fence(s) across the turn`,
      passed: bodies.length === 1,
      text: "Used a single fence rather than one per file",
    };
  },
  text: "Used a single fence rather than one per file",
};

const assertNoFence: Assertion = {
  check: ({ sessions }) => {
    const bodies = fenceBodies(assistantText(sessions));
    return {
      evidence:
        bodies.length === 0
          ? "No fence, as expected for an answer with no files"
          : `Unwanted fence: ${bodies.flatMap(fenceLines).join(", ")}`,
      passed: bodies.length === 0,
      text: "Left the fence out when there was nothing to show",
    };
  },
  text: "Left the fence out when there was nothing to show",
};

/** Every line is a bare path, and every path resolves to a real file. */
const assertLinesResolve: Assertion = {
  check: async ({ sessions, taskId }) => {
    const lines = fenceBodies(assistantText(sessions)).flatMap(fenceLines);
    if (lines.length === 0) {
      return {
        evidence: "No fence lines to resolve",
        passed: false,
        text: "Every line is a path to a real file",
      };
    }
    const failures: string[] = [];
    for (const line of lines) {
      const resolved = await getCurrentFileInfo({
        // The syntax says the line IS the path, so it is handed over as
        // written. A line needing repair is exactly the failure being counted.
        filePath: line as WorkspaceFilePath,
        taskId,
      });
      if (resolved.isErr()) {
        failures.push(line);
      }
    }
    return {
      evidence:
        failures.length === 0
          ? `All ${lines.length} line(s) resolved`
          : `${failures.length}/${lines.length} did not resolve: ${failures.join(" | ")}`,
      passed: failures.length === 0,
      text: "Every line is a path to a real file",
    };
  },
  text: "Every line is a path to a real file",
};

// A Markdown link whose target carries no scheme, i.e. names a file rather than
// a web page.
const FILE_LINK = /\[[^\]]*\]\(\s*(?![a-z][a-z0-9+.-]*:|#|\/\/)([^)\s]+)/giu;
const BULLET_LINE = /^[ \t]*(?:[*+-]|\d+[.)])[ \t]*(\S.*)$/gmu;

/**
 * The fence is the only place a file appears. Early prompt revisions had models
 * reach for the fence and then show the same files a second time -- as a link,
 * or as a bulleted list above it -- which is a worse reply than either
 * mechanism alone.
 */
const assertShownOnlyInFence: Assertion = {
  check: ({ sessions }) => {
    const text = assistantText(sessions);
    const outsideFences = text.replaceAll(FENCE, "");
    const filenames = fenceBodies(text)
      .flatMap(fenceLines)
      .flatMap((line) => {
        const name = line.split("/").at(-1);
        return name === undefined || name === "" ? [] : [name];
      });
    const duplicates = [
      ...[...outsideFences.matchAll(FILE_LINK)].map(
        (match) => `link: ${match[1] ?? ""}`,
      ),
      ...[...outsideFences.matchAll(BULLET_LINE)]
        .map((match) => match[1] ?? "")
        .filter((line) => filenames.some((name) => line.includes(name)))
        .map((line) => `bullet: ${line}`),
    ];
    return {
      evidence:
        duplicates.length === 0
          ? "Files appear only in the fence"
          : duplicates.join(" | "),
      passed: duplicates.length === 0,
      text: "Showed each file only in the fence",
    };
  },
  text: "Showed each file only in the fence",
};

/** Named a file under a mount, which is the case nothing else can surface. */
const assertNamedMountedFile: Assertion = {
  check: ({ sessions }) => {
    const lines = fenceBodies(assistantText(sessions)).flatMap(fenceLines);
    const mounted = lines.filter((line) => line.startsWith("/mnt/"));
    return {
      evidence:
        mounted.length > 0
          ? mounted.join(" | ")
          : `No /mnt path among: ${lines.join(" | ") || "(no fence)"}`,
      passed: mounted.length > 0,
      text: "Named the file in the shared folder",
    };
  },
  text: "Named the file in the shared folder",
};

const EDITED_NOTE = "2026-09-23.md";
const ADDED_ITEMS = ["dentist", "passport", "water filter"];

function lastAssistantText(sessions: Session.WithMessagesAndParts[]): string {
  const message = sessions
    .flatMap((session) => session.messages)
    .findLast(
      (candidate) =>
        candidate.role === "assistant" &&
        candidate.parts.some(
          (part) => part.type === "text" && part.text.trim() !== "",
        ),
    );
  return (
    message?.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n") ?? ""
  );
}

function namesEditedNote(text: string): string[] {
  return fenceBodies(text)
    .flatMap(fenceLines)
    .filter((line) => line.endsWith(`/${EDITED_NOTE}`));
}

/**
 * The edit actually landed: every item sits in the first section, below what
 * was there, and the second section is untouched. Without this the fence
 * assertions could pass on a note nobody changed.
 */
const assertNoteEdited: Assertion = {
  check: async ({ taskId }) => {
    const text = "Added the items at the bottom of the first section";
    // Read at the mount the conversation sees, whatever it said, so the edit
    // is scored apart from whether anyone handed it over.
    const resolved = await getCurrentFileInfo({
      filePath:
        `${MOUNT.attachedFolders}/Journal/${EDITED_NOTE}` as WorkspaceFilePath,
      taskId,
    });
    if (resolved.isErr()) {
      return { evidence: resolved.error.message, passed: false, text };
    }
    const note = fs.readFileSync(resolved.value.hostPath, "utf8");
    const [first = "", second = ""] = note.split(/^## Reading$/mu);
    const firstLines = first.trim().split("\n");
    const tail = firstLines.slice(-ADDED_ITEMS.length).join("\n").toLowerCase();
    const passed =
      ADDED_ITEMS.every((item) => tail.includes(item)) &&
      firstLines
        .slice(-ADDED_ITEMS.length)
        .every((row) => row.startsWith("- [ ]")) &&
      second.includes("Skim the conference talk notes");
    return { evidence: note, passed, text };
  },
  text: "Added the items at the bottom of the first section",
};

/** The task's receipt named the note it changed, by the path it reached. */
const assertTaskFencedEditedNote: Assertion = {
  check: async ({ childSessions }) => {
    const text = "The task's receipt fenced the note it changed";
    const children = await childSessions();
    const receipts = children.map((child) => lastAssistantText(child.sessions));
    const named = receipts.flatMap(namesEditedNote);
    return {
      evidence:
        named.length > 0
          ? named.join(" | ")
          : `No fenced note; receipts: ${JSON.stringify(receipts)}`,
      passed: named.length > 0,
      text,
    };
  },
  text: "The task's receipt fenced the note it changed",
};

// A link whose target is the note, either as its path or as the app's own
// address for a file; both draw the same chip the fence's card opens.
const NOTE_LINK = new RegExp(
  String.raw`\[[^\]]*\]\(\s*((?:${APP_NAME_SLUG}://file/)?/*${MOUNT.attachedFolders.slice(1)}/[^)\s]*${EDITED_NOTE.replaceAll(".", String.raw`\.`)})\s*\)`,
  "giu",
);

/**
 * The conversation's closing reply handed the changed note over in a way the
 * user can click: the files fence, or a link to it. The evidence says which,
 * because the carrier a model reaches for is part of what is measured.
 */
const assertConversationHandedBackNote: Assertion = {
  check: async ({ sessions, taskId }) => {
    const text = "The closing reply handed back the note that changed";
    const reply = lastAssistantText(sessions);
    const handed = [
      ...namesEditedNote(reply).map((line) => ({ carrier: "fence", line })),
      ...[...reply.matchAll(NOTE_LINK)].map((match) => ({
        carrier: "link",
        line: match[1] ?? "",
      })),
    ];
    if (handed.length === 0) {
      return { evidence: `none: ${JSON.stringify(reply)}`, passed: false, text };
    }
    const results = await Promise.all(
      handed.map(async ({ carrier, line }) => {
        const filePath = `/${line.replace(/^.*?:\/\/file\//u, "").replace(/^\/+/u, "")}`;
        const resolved = await getCurrentFileInfo({
          filePath: filePath as WorkspaceFilePath,
          taskId,
        });
        return `${carrier} ${line}${resolved.isErr() ? " (does not resolve)" : ""}`;
      }),
    );
    return {
      evidence: results.join(" | "),
      passed: results.some((result) => !result.endsWith("(does not resolve)")),
      text,
    };
  },
  text: "The closing reply handed back the note that changed",
};

export const FILES_FENCE_EVALS = [
  defineEval({
    assertions: [
      assertEmittedFence,
      assertOneFence,
      assertShownOnlyInFence,
      assertLinesResolve,
      assertNamedMountedFile,
    ],
    folders: [{ access: "read-write", path: path.join(FIXTURES, "Reports") }],
    name: "files-fence-shared-folder-deliverable",
    prompt:
      "Chart the monthly revenue in the sales spreadsheet in my Reports folder as a PNG, and save it next to the spreadsheet.",
  }),
  defineEval({
    assertions: [
      assertEmittedFence,
      assertOneFence,
      assertShownOnlyInFence,
      assertLinesResolve,
    ],
    name: "files-fence-several-deliverables",
    prompt:
      "Using these numbers -- Jan 48200, Feb 51150, Mar 60400, Apr 57300, May 71900, Jun 83250 -- make me three separate PNG charts: a line chart of the trend, a bar chart by month, and a chart of month-over-month growth.",
  }),
  defineEval({
    assertions: [
      assertEmittedFence,
      assertLinesResolve,
      assertNamedMountedFile,
    ],
    folders: [{ access: "read-only", path: path.join(FIXTURES, "Notes") }],
    name: "files-fence-retrieval-from-shared-folder",
    prompt:
      "Which of the notes in my Notes folder has the Helsinki launch date in it?",
  }),
  defineEval({
    assertions: [assertNoFence],
    name: "files-fence-no-files-involved",
    prompt:
      "In two sentences, what is the difference between a semaphore and a mutex?",
  }),
  defineEval({
    // A file of the user's that a task changed in place is handed back where
    // it sits, by the task to the conversation and by the conversation to the
    // user, so they can check what was written.
    assertions: [
      assertTaskFencedEditedNote,
      assertConversationHandedBackNote,
      assertNoteEdited,
    ],
    folders: [{ access: "read-write", path: path.join(FIXTURES, "Journal") }],
    kind: "orchestrator",
    name: "files-fence-orchestrator-edited-note",
    prompt: `Add these as checkboxes at the bottom of the first section of ${EDITED_NOTE} in my Journal folder: call the dentist, renew my passport, order a new water filter.`,
  }),
  defineEval({
    // The mirror: handing back a changed file must not become a fence on
    // every reply.
    assertions: [assertNoFence],
    kind: "orchestrator",
    name: "files-fence-orchestrator-no-files-involved",
    prompt:
      "In two sentences, what is the difference between a semaphore and a mutex?",
  }),
];
