/**
 * Does a task the chat starts run as a session of the chat's own, and does
 * the `task` command reach it by its handle?
 *
 * A task is a session in the chat's store, carrying the chat's conversation
 * on from where it forked, addressed as `t1`, `t2`, … These cases ask for one
 * outright, so a run that does the work in the chat says nothing about them,
 * and score what the store holds as well as what the user got:
 *
 * - **It starts one task, as t1.** One `task new`, one session of the chat's
 *   with a parent and a fork point, and the work done there.
 * - **It steers that task by its handle.** A change of plan reaches t1
 *   through `task send t1` or `task stop t1`, rather than a second task.
 * - **It hands the task the user's tab.** `task new --tab` makes the task
 *   the tab's one driver, and the tab goes back to the chat when the task
 *   finishes.
 */
import fs from "node:fs";
import path from "node:path";

import { getChatState } from "../../src/lib/chat-record";
import { outputFolderPath } from "../../src/lib/chat/output-folder";
import { chatDir } from "../../src/lib/record-folders";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";

type Context = Parameters<Assertion["check"]>[0];

const WORKSPACE = outputFolderPath();

function pass(text: string, evidence: string): AssertionResult {
  return { evidence, passed: true, text };
}

function fail(text: string, evidence: string): AssertionResult {
  return { evidence, passed: false, text };
}

/** Every bash command a set of sessions ran, in order. */
function commandsIn(sessions: Session.WithMessagesAndParts[]): string[] {
  return sessions.flatMap((session) =>
    session.messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool-bash") {
          return [];
        }
        const command: string | undefined = part.input?.command;
        return command === undefined ? [] : [command];
      }),
    ),
  );
}

/** How many times the commands start a task. */
function starts(commands: string[]): number {
  return commands.reduce(
    (count, command) =>
      count + [...command.matchAll(/(?:^|[\n;&|])\s*task new\b/g)].length,
    0,
  );
}

const startedOneTaskAsT1: Assertion = {
  check: async (ctx: Context) => {
    const text = "started one task, a session of the chat's, as t1";
    const begun = starts(commandsIn(ctx.sessions));
    const children = await ctx.childSessions();
    const task = children[0]?.sessions[0];
    if (begun !== 1 || children.length !== 1 || !task) {
      return fail(
        text,
        `${String(begun)} task new; ${String(children.length)} task sessions`,
      );
    }
    const chat = ctx.sessions[0];
    const ok =
      task.handle === "t1" &&
      task.parentId === chat?.id &&
      task.forkedAtMessageId !== undefined;
    return (ok ? pass : fail)(
      text,
      `handle ${task.handle ?? "none"}, parent ${task.parentId === chat?.id ? "the chat" : String(task.parentId)}, forked at ${task.forkedAtMessageId ?? "nothing"}`,
    );
  },
  text: "started one task, a session of the chat's, as t1",
};

/** The file the work was asked to make, with what it holds. */
function wrote(name: string, holds: RegExp): Assertion {
  const text = `wrote ${name} holding ${String(holds)}`;
  return {
    check: () => {
      const file = path.join(WORKSPACE, name);
      if (!fs.existsSync(file)) {
        return fail(text, `no ${file}`);
      }
      const body = fs.readFileSync(file, "utf8");
      return (holds.test(body) ? pass : fail)(text, body.slice(0, 200));
    },
    text,
  };
}

/** The task did the work, not the chat: it called a tool of its own. */
const workedInTheTask: Assertion = {
  check: async (ctx: Context) => {
    const text = "did the work in the task";
    const children = await ctx.childSessions();
    const calls = children
      .flatMap((child) => child.sessions)
      .flatMap((session) => session.messages)
      .flatMap((message) =>
        message.parts.filter((part) => part.type.startsWith("tool-")),
      );
    return (calls.length > 0 ? pass : fail)(
      text,
      calls.map((call) => call.type).join(", ") || "no tool calls in the task",
    );
  },
  text: "did the work in the task",
};

/** The change reached t1 by its handle, and no second task was started. */
const steeredT1: Assertion = {
  check: async (ctx: Context) => {
    const text = "steered t1 by its handle, starting no second task";
    const commands = commandsIn(ctx.sessions);
    const steered = commands.filter((command) =>
      /(?:^|[\n;&|])\s*task (?:send|stop) t1\b/.test(command),
    );
    const children = await ctx.childSessions();
    return (steered.length > 0 && children.length === 1 ? pass : fail)(
      text,
      `${String(steered.length)} send/stop to t1; ${String(children.length)} tasks; ${commands
        .filter((command) => /\btask\b/.test(command))
        .join(" | ")
        .slice(0, 300)}`,
    );
  },
  text: "steered t1 by its handle, starting no second task",
};

/** The user's open tab, as the note on their message names it. */
const PAGE = "https://example.com/";
const PAGE_TAB = "ses_01M3AX9RF3C2E9RTATMB602W0D";

/** The chat started its task with the user's tab handed over. */
const handedTheTab: Assertion = {
  check: (ctx: Context) => {
    const text = `handed the task tab ${PAGE_TAB}`;
    const handed = commandsIn(ctx.sessions).filter(
      (command) =>
        /(?:^|[\n;&|])\s*task new\b/.test(command) &&
        new RegExp(`--tab[ =]['"]?${PAGE_TAB}`).test(command),
    );
    return (handed.length > 0 ? pass : fail)(
      text,
      handed.join(" | ") ||
        commandsIn(ctx.sessions).join(" | ").slice(0, 300) ||
        "no commands",
    );
  },
  text: `handed the task tab ${PAGE_TAB}`,
};

/** Once the task finished, the tab it drove is the chat's again. */
const tabCameBack: Assertion = {
  check: async (ctx: Context) => {
    const text = "the tab went back to the chat when the task finished";
    const { browserTabs } = await getChatState(chatDir(ctx.chatId));
    const held = browserTabs.filter((tab) => tab.id.endsWith(PAGE_TAB));
    return (held.length > 0 && held.every((tab) => !tab.driver) ? pass : fail)(
      text,
      JSON.stringify(browserTabs),
    );
  },
  text: "the tab went back to the chat when the task finished",
};

export const TASK_SESSION_EVALS = [
  defineEval({
    assertions: [
      startedOneTaskAsT1,
      workedInTheTask,
      wrote("tea-haiku.md", /\S/),
    ],
    kind: "chat",
    name: "task-session-start",
    prompt:
      "Start a background task for this, please: write three haiku about tea and save them as tea-haiku.md in the workspace folder.",
  }),
  defineEval({
    assertions: [startedOneTaskAsT1, steeredT1, wrote("haiku.md", /sea/i)],
    followUps: [
      {
        duringWork: { afterToolCalls: 1 },
        prompt:
          "Change of plan for that task: make the haiku about the sea instead of tea.",
      },
    ],
    kind: "chat",
    name: "task-session-steer",
    prompt:
      "Start a background task for this, please: write twelve haiku about tea, look each one over for its syllable counts, and save them as haiku.md in the workspace folder.",
  }),
  defineEval({
    assertions: [
      startedOneTaskAsT1,
      handedTheTab,
      tabCameBack,
      wrote("page-title.md", /example domain/i),
    ],
    kind: "chat",
    name: "task-session-tab",
    prompt:
      "Start a background task and hand it the tab I have open: it should read that page's title and save it as page-title.md in the workspace folder.",
    viewing: {
      page: {
        tab: PAGE_TAB,
        tabs: [{ id: PAGE_TAB, title: "Example Domain", url: PAGE }],
        title: "Example Domain",
        url: PAGE,
      },
      screen: "browser",
      url: PAGE,
    },
  }),
];
