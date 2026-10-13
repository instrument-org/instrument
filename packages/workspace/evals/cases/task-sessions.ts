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
 * - **It leaves a task the user stopped alone.** Stop on t1 wakes the chat
 *   with a note saying the user stopped it; the chat says so and starts
 *   nothing again.
 * - **It leaves the work alone when asked what happened.** The user stops
 *   the chat's own turn mid-command, then its task, then asks what
 *   happened: the chat explains, and runs none of the stopped work again,
 *   even when its answer tells of starting the task or ends offering to.
 */
import fs from "node:fs";
import path from "node:path";

import { STOPPED_TOOL_CALL_ERROR_TEXT } from "../../src/constants";
import { getChatState } from "../../src/lib/chat-record";
import { listChildTasks } from "../../src/lib/chat/children";
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

/**
 * The chat's turn the user's stop woke: its reply, and the commands it ran,
 * from the note on.
 */
function afterTheStop(sessions: Session.WithMessagesAndParts[]) {
  const messages = sessions.flatMap((session) => session.messages);
  const woke = messages.findIndex((message) =>
    message.parts.some(
      (part) =>
        part.type === "data-taskEvent" &&
        part.data.events.some((event) => event.stoppedBy === "user"),
    ),
  );
  if (woke === -1) {
    return undefined;
  }
  const after = messages.slice(woke + 1);
  return {
    commands: commandsIn(
      sessions.map((session) => ({
        ...session,
        messages: session.messages.filter((message) => after.includes(message)),
      })),
    ),
    reply: after
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        ),
      )
      .join("\n"),
  };
}

/**
 * The user's stop left a note in the chat and woke nothing: the person
 * stopped it on purpose, and the chat learns of it with their next message
 * (task-session-stopped-then-asked covers that turn).
 */
const notedTheStopQuietly: Assertion = {
  check: async (ctx: Context) => {
    const text = "noted the user's stop without starting a turn";
    const after = afterTheStop(ctx.sessions);
    const [task] = await listChildTasks(ctx.chatId);
    if (!after) {
      return fail(
        text,
        `no stop note; t1 stopped by ${task?.stoppedBy ?? "nobody"}`,
      );
    }
    return (after.reply === "" && task?.stoppedBy === "user" ? pass : fail)(
      text,
      `t1 stopped by ${task?.stoppedBy ?? "nobody"}; reply after the note: ${after.reply.slice(0, 200) || "(none)"}`,
    );
  },
  text: "noted the user's stop without starting a turn",
};

/** Nothing the user stopped was started again. */
const leftItStopped: Assertion = {
  check: (ctx: Context) => {
    const text = "started nothing again after the stop";
    const after = afterTheStop(ctx.sessions);
    const restarted = (after?.commands ?? []).filter((command) =>
      /(?:^|[\n;&|])\s*task (?:new|send)\b/.test(command),
    );
    return (restarted.length === 0 ? pass : fail)(
      text,
      restarted.join(" | ") || "no task new or send",
    );
  },
  text: "started nothing again after the stop",
};

/** The question asked once the chat's turn and its task are both stopped. */
const WHAT_HAPPENED = "what happened?";

/**
 * The chat's turn that answered `WHAT_HAPPENED`: its reply and the commands
 * it ran.
 */
function afterTheQuestion(sessions: Session.WithMessagesAndParts[]) {
  const chat = sessions[0];
  const messages = chat?.messages ?? [];
  const asked = messages.findIndex(
    (message) =>
      message.role === "user" &&
      message.parts.some(
        (part) => part.type === "text" && part.text === WHAT_HAPPENED,
      ),
  );
  if (!chat || asked === -1) {
    return undefined;
  }
  const after = messages.slice(asked + 1);
  return {
    commands: commandsIn([{ ...chat, messages: after }]),
    reply: after
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        ),
      )
      .join("\n"),
  };
}

/**
 * The setup held: a call of the chat's own was cut off by the user's Stop,
 * and t1 was stopped by the user, before the question was asked.
 */
const stoppedTheTurnAndTheTask: Assertion = {
  check: async (ctx: Context) => {
    const text = "the user stopped the chat's turn and then t1";
    const cutOff = (ctx.sessions[0]?.messages ?? []).flatMap((message) =>
      message.parts.filter(
        (part) =>
          "errorText" in part &&
          part.errorText === STOPPED_TOOL_CALL_ERROR_TEXT,
      ),
    );
    const task = (await listChildTasks(ctx.chatId)).find(
      (child) => child.handle === "t1",
    );
    return (cutOff.length > 0 && task?.stoppedBy === "user" ? pass : fail)(
      text,
      `${String(cutOff.length)} chat calls cut off by the stop; t1 stopped by ${task?.stoppedBy ?? "nobody"}`,
    );
  },
  text: "the user stopped the chat's turn and then t1",
};

/** Asked what happened, the chat said the work was stopped. */
const explainedTheStop: Assertion = {
  check: (ctx: Context) => {
    const text = "explained that the work was stopped";
    const after = afterTheQuestion(ctx.sessions);
    const said = after !== undefined && /\bstop/i.test(after.reply);
    return (said ? pass : fail)(
      text,
      after?.reply.slice(0, 300) || "(no reply)",
    );
  },
  text: "explained that the work was stopped",
};

/**
 * Asked what happened, the chat ran none of the stopped work again: no task
 * started or resumed, no sleep run again, and still one task in the chat.
 */
const restartedNothing: Assertion = {
  check: async (ctx: Context) => {
    const text = "started none of the stopped work again";
    const after = afterTheQuestion(ctx.sessions);
    const restarted = (after?.commands ?? []).filter(
      (command) =>
        /(?:^|[\n;&|])\s*task (?:new|send)\b/.test(command) ||
        /\bsleep\s+\d/.test(command),
    );
    const children = await ctx.childSessions();
    return (restarted.length === 0 && children.length === 1 ? pass : fail)(
      text,
      `${String(children.length)} tasks; ${restarted.join(" | ") || "no task new, task send, or sleep"}`,
    );
  },
  text: "started none of the stopped work again",
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
  defineEval({
    assertions: [startedOneTaskAsT1, notedTheStopQuietly, leftItStopped],
    followUps: [{ afterMs: 20_000, stopTask: "t1" }],
    kind: "chat",
    name: "task-session-user-stop",
    prompt:
      "Start a background task for this, please: write twenty haiku about tea, one at a time, checking each one's syllable counts before the next, and save them as tea-haiku.md in the workspace folder.",
  }),
  defineEval({
    assertions: [stoppedTheTurnAndTheTask, explainedTheStop, restartedNothing],
    followUps: [
      "While that runs, run `sleep 120` right here in this chat, not as a task, and wait for it to end before you reply.",
      {
        duringWork: { afterToolCalls: 0, command: /\bsleep 120\b|\bfg\b/ },
        stopChat: true,
      },
      { afterMs: 5000, stopTask: "t1" },
      { prompt: WHAT_HAPPENED, settled: true },
    ],
    kind: "chat",
    name: "task-session-stopped-then-asked",
    prompt:
      "Start a background task that runs `sleep 150` and then tells me it finished.",
  }),
];
