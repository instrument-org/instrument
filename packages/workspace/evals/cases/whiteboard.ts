/**
 * Does the agent reach for an `.excalidraw` board only when one was asked
 * for, and when it was, does the board open whole?
 *
 * A board is a file the person and the agent both edit on a live canvas,
 * which is worth it when they will rearrange it and is clutter when they only
 * wanted an answer. So the cases are of two kinds: prompts a board would be
 * the wrong answer to, where any `.excalidraw` in the run counts against it,
 * and prompts that ask for one, scored on the file it left. The two diagram
 * prompts are the judgment calls: a board is defensible there, so they are
 * read beside the rest rather than as plain failures.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chatGrants } from "../../src/lib/chat/grants";
import { workDir } from "../../src/lib/work-dir";
import { type ChatId } from "../../src/schemas/chat-id";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/whiteboard");
const BOARD = "Board.excalidraw";

type Element = Record<string, unknown> & { id: string; type: string };

function toolInputs(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type.startsWith("tool-") && "input" in part
          ? [JSON.stringify(part.input ?? null)]
          : [],
      ),
    ),
  );
}

async function treeSessions(context: {
  childSessions: () => Promise<{ sessions: Session.WithMessagesAndParts[] }[]>;
  sessions: Session.WithMessagesAndParts[];
}) {
  const children = await context.childSessions();
  return [...context.sessions, ...children.flatMap((child) => child.sessions)];
}

/** Any tool call in the chat or its tasks that names a board or loads its skill. */
const leavesBoardsAlone: Assertion = {
  check: async (context) => {
    const text = "did not reach for an .excalidraw board";
    const hits = toolInputs(await treeSessions(context)).filter(
      (input) =>
        input.includes(".excalidraw") || input.includes('"excalidraw"'),
    );
    return {
      evidence:
        hits.length === 0
          ? "no tool call named a board"
          : `${hits.length} tool call(s): ${(hits[0] ?? "").slice(0, 300)}`,
      passed: hits.length === 0,
      text,
    };
  },
  text: "did not reach for an .excalidraw board",
};

function walk(dir: string, since: number, found: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        walk(full, since, found);
      }
    } else if (
      entry.name.endsWith(".excalidraw") &&
      fs.statSync(full).mtimeMs >= since
    ) {
      found.push(full);
    }
  }
}

/**
 * Boards written since the case started, wherever the run could write, and
 * every board a reply named: the chat's own folder is in the workspace,
 * which none of the folders searched holds.
 */
async function boardsWritten(
  chatId: ChatId,
  since: number,
  sessions: Session.WithMessagesAndParts[],
) {
  const roots = [
    os.homedir(),
    workDir(chatId),
    ...(await chatGrants(chatId)).map((grant) => grant.path),
  ];
  const found: string[] = [];
  for (const root of roots) {
    walk(root, since, found);
  }
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const part of message.parts) {
        if (message.role !== "assistant" || part.type !== "text") {
          continue;
        }
        for (const line of part.text.split("\n")) {
          const named = line.trim();
          if (
            named.startsWith("/") &&
            named.endsWith(".excalidraw") &&
            fs.existsSync(named)
          ) {
            found.push(named);
          }
        }
      }
    }
  }
  return [...new Set(found)];
}

/** What the canvas needs to open a file whole; every problem, worded. */
function boardProblems(file: string): {
  elements: Element[];
  problems: string[];
} {
  let scene: unknown;
  try {
    scene = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { elements: [], problems: [`not JSON: ${String(error)}`] };
  }
  const { elements, type } = scene as { elements?: unknown; type?: unknown };
  if (type !== "excalidraw" || !Array.isArray(elements)) {
    return { elements: [], problems: ["not an excalidraw scene"] };
  }
  const live = (elements as Element[]).filter(
    (element) => element.isDeleted !== true,
  );
  const ids = new Map(live.map((element) => [element.id, element]));
  const problems: string[] = [];
  if (live.length === 0) {
    problems.push("no elements");
  }
  if (ids.size !== live.length) {
    problems.push("duplicate ids");
  }
  for (const element of live) {
    if (typeof element.x !== "number" || typeof element.y !== "number") {
      problems.push(`${element.id}: no position`);
    }
    if (element.type !== "text") {
      continue;
    }
    const containerId = element.containerId;
    if (typeof containerId === "string") {
      const container = ids.get(containerId);
      const bound = container?.boundElements;
      if (
        !container ||
        !Array.isArray(bound) ||
        !bound.some((entry: { id?: unknown }) => entry.id === element.id)
      ) {
        problems.push(
          `${element.id}: container ${containerId} does not list it`,
        );
      } else if (
        typeof container.width === "number" &&
        typeof container.height === "number" &&
        typeof element.fontSize === "number" &&
        typeof element.text === "string"
      ) {
        // The canvas wraps a label to its box's width but never grows the
        // box, so a label too long for it spills out of the bottom. Roughly
        // the hand-drawn font's width per character.
        const { fontSize } = element;
        const perLine = Math.max(
          1,
          Math.floor((container.width - 10) / (fontSize * 0.55)),
        );
        const lines = element.text
          .split("\n")
          .reduce(
            (sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)),
            0,
          );
        if (lines * fontSize * 1.25 > container.height) {
          problems.push(
            `${element.id}: "${element.text}" spills out of its box`,
          );
        }
      }
    }
  }
  return { elements: live, problems };
}

function boardCase(options: { name: string; prompt: string }) {
  let since = 0;
  const opensWhole: Assertion = {
    check: async (context): Promise<AssertionResult> => {
      const text = "wrote a board that opens whole";
      const boards = await boardsWritten(
        context.chatId,
        since,
        await treeSessions(context),
      );
      if (boards.length === 0) {
        return { evidence: "no .excalidraw written", passed: false, text };
      }
      const report = boards.map((board) => {
        const { elements, problems } = boardProblems(board);
        return { board, elements, problems };
      });
      return {
        evidence: report
          .map(
            ({ board, elements, problems }) =>
              `${path.basename(board)}: ${elements.length} elements${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`,
          )
          .join(" | "),
        passed: report.every(({ problems }) => problems.length === 0),
        text,
      };
    },
    text: "wrote a board that opens whole",
  };
  return defineEval({
    assertions: [opensWhole],
    kind: "chat",
    name: options.name,
    prompt: options.prompt,
    setup: () => {
      since = Date.now();
    },
  });
}

function unaskedCase(name: string, prompt: string) {
  return defineEval({
    assertions: [leavesBoardsAlone],
    kind: "chat",
    name,
    prompt,
  });
}

const ORIGINAL_IDS = (
  JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "Kitchen", BOARD), "utf8"),
  ) as { elements: Element[] }
).elements.map((element) => element.id);

const editsInPlace: Assertion = {
  check: async ({ chatId }) => {
    const text = "added the note and kept every element it found";
    const kitchen = (await chatGrants(chatId)).find(
      (grant) => path.basename(grant.path) === "Kitchen",
    );
    if (!kitchen) {
      return { evidence: "no Kitchen folder was granted", passed: false, text };
    }
    const { elements, problems } = boardProblems(
      path.join(kitchen.path, BOARD),
    );
    const missing = ORIGINAL_IDS.filter(
      (id) => !elements.some((element) => element.id === id),
    );
    // A new element: rewording an existing label is not adding a note.
    const note = elements.find(
      (element) =>
        !ORIGINAL_IDS.includes(element.id) &&
        element.type === "text" &&
        typeof element.text === "string" &&
        /faucet/iu.test(element.text),
    );
    const all = [
      ...problems,
      ...(missing.length > 0 ? [`lost ${missing.join(", ")}`] : []),
      ...(note ? [] : ["no new text mentions the faucet"]),
    ];
    return {
      evidence:
        all.length === 0
          ? `${elements.length} elements, note "${String(note?.text)}"`
          : all.join("; "),
      passed: all.length === 0,
      text,
    };
  },
  text: "added the note and kept every element it found",
};

export const WHITEBOARD_EVALS = [
  unaskedCase(
    "board-unasked-names",
    "Brainstorm a dozen names for a neighborhood coffee shop.",
  ),
  unaskedCase(
    "board-unasked-meals",
    "Help me plan dinners for next week for a family of four. One of us is vegetarian.",
  ),
  unaskedCase(
    "board-unasked-lease",
    "Lay out the pros and cons of leasing versus buying a car for me.",
  ),
  unaskedCase(
    "board-unasked-onboarding",
    "Map out the steps for onboarding a new hire at our ten-person company.",
  ),
  // The judgment calls: a picture is wanted, a board is not asked for.
  unaskedCase(
    "board-unasked-diagram-request-flow",
    "Sketch how a request flows through a typical web app: browser, CDN, load balancer, app servers, database.",
  ),
  unaskedCase(
    "board-unasked-diagram-flowchart",
    "Make me a flowchart for deciding whether to repair or replace an old water heater.",
  ),
  boardCase({
    name: "board-asked-whiteboard",
    prompt:
      "Make me a whiteboard I can move things around on for planning our kitchen remodel: zones for cooking, prep, storage and a breakfast nook.",
  }),
  boardCase({
    name: "board-asked-by-format",
    prompt:
      "Draw our signup flow as an Excalidraw file: landing page, email form, verify email, pick a plan, done.",
  }),
  defineEval({
    assertions: [editsInPlace],
    folders: [{ path: path.join(FIXTURES, "Kitchen") }],
    kind: "chat",
    name: "board-asked-edit",
    prompt: `In ${BOARD} in my Kitchen folder, add a sticky note next to the Sink saying "Order faucet by Friday".`,
  }),
];
