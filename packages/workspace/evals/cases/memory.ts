/**
 * Does the conversation keep what it is told about the user?
 *
 * Memory is a command in the conversation's shell and a section of its prompt,
 * so whether a model reaches for it when the user states a standing fact is a
 * property of the prompt and the model, not of code: it cannot be read off the
 * source, and it regresses silently. What these measure:
 *
 * - **A standing fact gets saved.** The user says something that will matter
 *   in a chat next week; the conversation saves it in the same reply.
 * - **It was a reply, not a task.** Keeping a fact is the conversation's own
 *   job, and nothing about the ask needs a task.
 * - **A preference inside a work ask is saved before the work.** Measured,
 *   this is the one that fails: a turn ends the moment a task is created, so
 *   a model that means to save after forking never gets the step, and says it
 *   remembered something it did not. The save comes first, whether the chat
 *   does the work itself or forks it, in the same command as the fork when
 *   there is one.
 * - **It did not claim a memory it does not hold.** The failure above is only
 *   dangerous because the user is told it happened.
 * - **A fact goes where its scope is.** Asked to update a project with what
 *   an earlier chat found, the details go in the project's `AGENTS.md`,
 *   which every chat under it reads, and not into memory, which every chat
 *   in the workspace reads. A fact about the person said in a chat filed
 *   under a project is still a memory. Measured on a real chat, 2026-11-08:
 *   the agent wrote a new file in the project's folder and saved two
 *   memories, leaving `AGENTS.md` alone.
 *
 * Memory lives in the run's workspace, so each case of each trial runs in a
 * process and workspace of its own (`runCasesApart` in `evals/cli.ts`):
 * sharing one, a case reads the memory another saved, correctly declines to
 * save the same fact twice, and fails an assertion asking the wrong question.
 *
 * **What it measured, 2026-09-19, GLM 5.3 Flash at high effort.** The
 * standing-fact case passes about one run in three; Qwen3.8 27B passed it
 * first try. The two failures are the model's, not the mechanism's: it
 * printed `instrument memory save ...` as text inside its reply, or it reasoned "Save
 * memory" and then called nothing. A third, rarer one is repaired in the
 * harness now: the command emitted as the tool's name rather than as a bash
 * call (`repair-shell-command-tool-call.ts`). All three end with the user
 * told a thing was remembered that was not, which is what the last assertion
 * is for. The conversation ships on a stronger model than this one.
 */
import { splitFrontMatter } from "@instrument-org/shared";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PROJECT_FILE_NAME } from "../../src/constants";
import { ensureChat } from "../../src/lib/chat/chat-records";
import { projectsDir } from "../../src/lib/chat/projects";
import { memoryDir } from "../../src/lib/memory/store";
import { type Session } from "../../src/schemas/session";
import { StoreId } from "../../src/schemas/store-id";
import { type Assertion, type AssertionResult, defineEval } from "../harness";
import { seed } from "./chat-history";

/** A command that keeps a memory, anchored the way the shell reads it. */
const SAVES_A_MEMORY = /(?:^|[\n;&|])\s*instrument memory save\b/;

function bashParts(sessions: Session.WithMessagesAndParts[]) {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        const output: string | undefined =
          part.state === "output-available" ? part.output.output : undefined;
        return command === undefined ? [] : [{ command, output }];
      }),
    ),
  );
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

const savedAMemory: Assertion = {
  check: ({ sessions }) => {
    const text = "saved what the user said to memory";
    const parts = bashParts(sessions);
    const saved = parts.filter(
      ({ command, output }) =>
        SAVES_A_MEMORY.test(command) &&
        /^(?:Saved|Replaced) "/m.test(output ?? ""),
    );
    return saved.length > 0
      ? pass(
          text,
          saved.map(({ output }) => output?.split("\n")[0]).join(" | "),
        )
      : fail(
          text,
          `${parts.length} commands, none a memory save: ${parts.map(({ command }) => command.split("\n")[0]).join(" | ")}`,
        );
  },
  text: "saved what the user said to memory",
};

const withoutATask: Assertion = {
  check: ({ sessions }) => {
    const text = "kept it without starting a task";
    const started = bashParts(sessions).filter(({ command }) =>
      /(?:^|[\n;&|])\s*instrument task new\b/.test(command),
    );
    return started.length === 0
      ? pass(text, "no task")
      : fail(text, `started ${started.length} task(s) to remember a sentence`);
  },
  text: "kept it without starting a task",
};

/**
 * What the conversation told the user, before any task reported back: where a
 * claim of having remembered something would be.
 */
function firstReply(sessions: Session.WithMessagesAndParts[]): string {
  return (
    sessions
      .flatMap((session) =>
        session.messages
          .filter((message) => message.role === "assistant")
          .flatMap((message) =>
            message.parts.flatMap((part) =>
              part.type === "text" && part.text.trim() !== ""
                ? [part.text]
                : [],
            ),
          ),
      )
      .at(0)
      ?.trim() ?? ""
  );
}

/** Words a reply uses to say a thing is now remembered. */
const CLAIMS_A_MEMORY =
  /\b(?:noted|remember(?:ed|ing)?|saved|keep(?:ing)? that in mind|got it)\b/i;

/**
 * The save came before any fork: in an earlier command, or earlier in the
 * same one. A run with no fork passes on the save alone.
 */
const savedBeforeForking: Assertion = {
  check: ({ sessions }) => {
    const text = "saved the preference before starting any task";
    const commands = bashParts(sessions).map(({ command }) => command);
    const forkAt = commands.findIndex((command) =>
      /(?:^|[\n;&|])\s*instrument task new\b/.test(command),
    );
    if (forkAt === -1) {
      return commands.some((command) => SAVES_A_MEMORY.test(command))
        ? pass(text, "saved, and did the work without a task")
        : fail(text, "no save");
    }
    const fork = commands[forkAt] ?? "";
    const savedEarlier = commands
      .slice(0, forkAt)
      .some((command) => SAVES_A_MEMORY.test(command));
    const saveInFork = SAVES_A_MEMORY.exec(fork)?.index;
    const savedFirstInFork =
      saveInFork !== undefined &&
      saveInFork < fork.search(/(?:^|[\n;&|])\s*instrument task new\b/);
    return savedEarlier || savedFirstInFork
      ? pass(
          text,
          savedEarlier ? "in an earlier command" : (fork.split("\n")[0] ?? ""),
        )
      : fail(
          text,
          `the first fork came before any save: ${fork.split("\n")[0] ?? ""}`,
        );
  },
  text: "saved the preference before starting any task",
};

/**
 * The lie this whole case exists for: a reply saying the preference is kept,
 * in a run where nothing was kept. Passing without a claim and without a save
 * would be honest but useless, so this rides beside `savedAMemory`.
 */
const didNotClaimWhatItDidNotSave: Assertion = {
  check: ({ sessions }) => {
    const text = "did not claim a memory it never saved";
    const saved = bashParts(sessions).some(({ command }) =>
      SAVES_A_MEMORY.test(command),
    );
    const reply = firstReply(sessions);
    return saved || !CLAIMS_A_MEMORY.test(reply)
      ? pass(
          text,
          saved ? "saved it" : `claimed nothing: ${JSON.stringify(reply)}`,
        )
      : fail(text, `said ${JSON.stringify(reply)} and saved nothing`);
  },
  text: "did not claim a memory it never saved",
};

const GAMING = {
  instructions: "WoW Forever is a new game release.",
  name: "Gaming",
};

/** The body of a project's `AGENTS.md`, under its front matter. */
function projectBody(name: string): string {
  const file = path.join(projectsDir(), name, PROJECT_FILE_NAME);
  if (!existsSync(file)) {
    return "";
  }
  const raw = readFileSync(file, "utf8");
  const split = splitFrontMatter(raw);
  return (split.ok ? split.body : raw).trim();
}

/** The memories kept, by file name. */
function memoryFiles(): string[] {
  const dir = memoryDir();
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(".md"))
    : [];
}

/** An earlier chat where the user told the details the project now wants. */
async function seedGameChat() {
  const start = Date.now() - 3 * 86_400_000;
  const sessionId = StoreId.newSessionId();
  const ask =
    "Just installed WoW Forever to D:\\Games\\WoW Forever, it's on the Stormreaver server. My main is Brakka, a level 34 orc shaman. Is a shaman good for solo play?";
  const chatId = await ensureChat(sessionId, ask);
  await seed(chatId, sessionId, "user", new Date(start), ask);
  await seed(
    chatId,
    sessionId,
    "assistant",
    new Date(start + 20_000),
    "Shamans solo well: Enhancement hits hard and heals itself between fights. At 34, Brakka has Ghost Wolf, which helps a lot on Stormreaver's long roads.",
  );
}

const projectGainedTheDetails: Assertion = {
  check: () => {
    const text = "added the game's details to Projects/Gaming/AGENTS.md";
    const body = projectBody(GAMING.name);
    const others = readdirSync(path.join(projectsDir(), GAMING.name)).filter(
      (name) => name !== PROJECT_FILE_NAME,
    );
    const evidence = `body: ${JSON.stringify(body.slice(0, 300))}; other files: ${others.join(", ") || "none"}`;
    return /Brakka|Stormreaver|D:[\\/]+Games/i.test(body)
      ? pass(text, evidence)
      : fail(text, evidence);
  },
  text: "added the game's details to Projects/Gaming/AGENTS.md",
};

const keptNoMemory: Assertion = {
  check: () => {
    const text = "kept the project's details out of memory";
    const files = memoryFiles();
    return files.length === 0
      ? pass(text, "no memories")
      : fail(text, `saved ${files.join(", ")}`);
  },
  text: "kept the project's details out of memory",
};

const leftTheProjectAlone: Assertion = {
  check: () => {
    const text = "left Projects/Gaming/AGENTS.md as it was";
    const body = projectBody(GAMING.name);
    return body === GAMING.instructions
      ? pass(text, "unchanged")
      : fail(text, JSON.stringify(body.slice(0, 300)));
  },
  text: "left Projects/Gaming/AGENTS.md as it was",
};

export const MEMORY_EVALS = [
  defineEval({
    assertions: [savedAMemory, withoutATask],
    kind: "chat",
    name: "memory-keeps-a-standing-fact",
    prompt:
      "Before we get into anything: I'm on Pacific time and I only take calls in the morning, so keep that in mind whenever you set something up for me.",
  }),

  defineEval({
    // The measured failure: the preference rides along with work, a fork
    // ends the turn, and the save has nowhere to go unless it comes first.
    assertions: [savedAMemory, savedBeforeForking, didNotClaimWhatItDidNotSave],
    kind: "chat",
    name: "memory-saves-before-the-work",
    prompt:
      "Find me three electric kettles under $60 and put a short comparison in my Instrument folder. Also, for future reference, I only ever want decaf: any coffee or tea you suggest, now or later, has to be decaf.",
  }),

  defineEval({
    // A preference said in passing, with no "remember" anywhere: how most
    // of what is worth keeping actually arrives.
    assertions: [savedAMemory, didNotClaimWhatItDidNotSave],
    kind: "chat",
    name: "memory-keeps-an-unflagged-preference",
    prompt:
      "What's the difference between a Roth and a traditional IRA? And please keep your answers to me short, a few sentences. I hate walls of text.",
  }),

  defineEval({
    // A standing fact that only explains the ask it rides in.
    assertions: [savedAMemory, didNotClaimWhatItDidNotSave],
    finishesAs: {
      said: "Found three vegetarian weeknight dinners under 30 minutes and saved them to dinners.md in your Instrument folder.",
    },
    kind: "chat",
    name: "memory-keeps-a-fact-inside-an-ask",
    prompt:
      "I'm vegetarian, so find me three weeknight dinner recipes that take under 30 minutes.",
  }),

  defineEval({
    // Tasks have no memory command, so a fact about the user that a task
    // turns up is kept only if the conversation saves it on the report.
    assertions: [savedAMemory],
    finishesAs: {
      said: "Booked Kaze Sushi for two this Friday at 7pm under your Resy account. Your Resy profile says you are allergic to shellfish, so I added that to the reservation notes, and it lists your home as 412 Alder St, Portland.",
    },
    kind: "chat",
    name: "memory-keeps-what-a-task-reported",
    prompt:
      "Book me a table for two at Kaze Sushi this Friday at 7 on Resy. I'm signed in there.",
  }),

  defineEval({
    // The real chat's ask, typo and all, in a chat filed under the project.
    assertions: [projectGainedTheDetails, keptNoMemory],
    kind: "chat",
    name: "memory-project-facts-go-to-the-project",
    project: GAMING,
    prompt:
      "update this project w/ details about wow forever that i'm play8ing. check other chats for recent things e.g. install location and deets about the game",
    setup: seedGameChat,
  }),

  defineEval({
    // The counterweight: filed under a project, a fact about the person is
    // still theirs everywhere.
    assertions: [savedAMemory, leftTheProjectAlone],
    kind: "chat",
    name: "memory-person-fact-in-a-project-chat",
    project: GAMING,
    prompt:
      "Heads up, I moved to Denver last week, so I'm on Mountain time now.",
  }),
];
