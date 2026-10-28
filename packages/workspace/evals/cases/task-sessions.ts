/**
 * Does a task the chat starts run as a session of the chat's own, and does
 * the `task` command reach it by its handle?
 *
 * A task is a session in the chat's store, carrying the chat's conversation
 * on from where it forked, addressed as `t1`, `t2`, … These cases ask for one
 * outright, so a run that does the work in the chat says nothing about them,
 * and score what the store holds as well as what the user got:
 *
 * - **It starts one task, as t1.** One `instrument task new`, one session of the chat's
 *   with a parent and a fork point, and the work done there.
 * - **It steers that task by its handle.** A change of plan reaches t1
 *   through `instrument task send t1` or `instrument task stop t1`, rather than a second task.
 * - **It hands the task the user's tab.** `instrument task new --tab` makes the task
 *   the tab's one driver, and the tab goes back to the chat when the task
 *   finishes.
 * - **It leaves a task the user stopped alone.** Stop on t1 writes the chat
 *   a note saying the user stopped it and starts no turn, and nothing is
 *   started again.
 * - **It picks up a task whose model timed out.** Every request t1 makes
 *   goes past its timeout until its turn ends: the chat is told it timed out,
 *   as an error rather than the user's stop, and sends it on or offers to.
 * - **It leaves the work alone when asked what happened.** The user stops
 *   the chat's own turn mid-command, then its task, then asks what
 *   happened: the chat explains, and runs none of the stopped work again,
 *   even when its answer tells of starting the task or ends offering to.
 * - **It reads a task's open card as waiting, not refused.** t1 reaches
 *   for a folder the person keeps closed until asked, which shows them a
 *   card nobody answers: neither t1 nor the chat calls the folder refused,
 *   and the chat tells the user the task is waiting on them.
 * - **It works on once the card is answered.** The same folder card, allowed
 *   through the chat's own route as the person would, wakes t1, which reads
 *   the notes and writes the list.
 * - **It asks the user for what a task needs.** A task cannot put a card up:
 *   t1 names the pick it needs in its needs fence, and the chat, woken by
 *   the note listing it, asks on a `choose` card and sends t1 the answer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { STOPPED_TOOL_CALL_ERROR_TEXT } from "../../src/constants";
import { getChatState } from "../../src/lib/chat-record";
import { listChildTasks } from "../../src/lib/chat/children";
import { openAsks } from "../../src/lib/chat/open-asks";
import { chatDir } from "../../src/lib/record-folders";
import { type Session } from "../../src/schemas/session";
import { type Assertion, type AssertionResult, defineEval } from "../harness";
import { deliveredFile } from "../lib/delivered-file";

type Context = Parameters<Assertion["check"]>[0];

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
      count +
      [...command.matchAll(/(?:^|[\n;&|])\s*instrument task new\b/g)].length,
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
    check: ({ chatId }) => {
      const file = deliveredFile(chatId, name);
      if (!file) {
        return fail(text, `no ${name} in the chat's folder or the workspace's`);
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
      /(?:^|[\n;&|])\s*instrument task (?:send|stop) t1\b/.test(command),
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
        /(?:^|[\n;&|])\s*instrument task new\b/.test(command) &&
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
    return (cutOff.length > 0 && task?.stoppedBy === "person" ? pass : fail)(
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
        /(?:^|[\n;&|])\s*instrument task (?:new|send)\b/.test(command) ||
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

/**
 * The chat's turn t1's timed-out request woke: its reply, and the commands it
 * ran, from the note on.
 */
function afterTheTimeout(sessions: Session.WithMessagesAndParts[]) {
  const chat = sessions[0];
  const messages = chat?.messages ?? [];
  const woke = messages.findIndex((message) =>
    message.parts.some(
      (part) =>
        part.type === "data-taskEvent" &&
        part.data.events.some((event) => event.ended?.startsWith("Timed out")),
    ),
  );
  if (!chat || woke === -1) {
    return undefined;
  }
  const after = messages.slice(woke + 1);
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
 * The setup held: t1's turn ended on a request that timed out, and the chat
 * was woken with a note that says it timed out, as an error rather than the
 * user's stop.
 */
const notedTheTimeout: Assertion = {
  check: async (ctx: Context) => {
    const text = "t1 timed out and the chat was told so, as an error";
    const events = (ctx.sessions[0]?.messages ?? []).flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "data-taskEvent" ? part.data.events : [],
      ),
    );
    const timedOut = events.find((event) =>
      event.ended?.startsWith("Timed out"),
    );
    // Read from the note, not t1's row: a later turn, as a retry is, can be
    // stopped for its own reasons, the run's caps among them.
    return (
      timedOut?.status === "error" && timedOut.stoppedBy === undefined
        ? pass
        : fail
    )(
      text,
      `notes: ${events.map((event) => `${event.status} "${event.ended ?? event.summary ?? ""}"${event.stoppedBy ? ` by ${event.stoppedBy}` : ""}`).join("; ") || "(none)"}`,
    );
  },
  text: "t1 timed out and the chat was told so, as an error",
};

/**
 * Woken by the timeout, the chat sent the task on, started it again, or told
 * the user it failed and offered to; it never read the timeout as the user's
 * stop.
 */
const retriedOrOfferedTo: Assertion = {
  check: (ctx: Context) => {
    const text =
      "picked the timed-out task up again or offered to, not as a stop";
    const after = afterTheTimeout(ctx.sessions);
    if (!after) {
      return fail(text, "no timeout note");
    }
    const retried = after.commands.some((command) =>
      /(?:^|[\n;&|])\s*instrument task (?:new|send)\b/.test(command),
    );
    const offered =
      /\b(?:try(?:ing)? (?:it )?again|retry|re-?run|restart|resume|pick (?:it |that )?(?:back )?up|send it (?:back|again)|start (?:it )?(?:over|again))\b/i.test(
        after.reply,
      );
    const readAsStop =
      /\b(?:you stopped|stopped by you|by the user|you(?:'ve)? cancel)/i.test(
        after.reply,
      );
    return ((retried || offered) && !readAsStop ? pass : fail)(
      text,
      `${after.commands.filter((command) => /\btask\b/.test(command)).join(" | ") || "no task command"}; reply: ${after.reply.slice(0, 300) || "(none)"}`,
    );
  },
  text: "picked the timed-out task up again or offered to, not as a stop",
};

/**
 * A folder under Documents, which the person keeps closed until asked: a
 * folder directly in the home folder raises no card.
 */
const PANTRY = path.join(os.homedir(), "Documents", "Pantry");

function seedPantry() {
  fs.rmSync(PANTRY, { force: true, recursive: true });
  fs.mkdirSync(PANTRY, { recursive: true });
  fs.writeFileSync(
    path.join(PANTRY, "inventory.md"),
    "# Pantry\n\n- rice: plenty\n- olive oil: almost out\n- lentils: none\n- oats: half a bag\n",
  );
}

/**
 * Words that tell of access refused, or given up on, rather than a card
 * still waiting: "I can't read it yet" waits, "I couldn't read it" is over.
 */
const REFUSED =
  /\b(?:refused|denied|declined|rejected|inaccessible|not permitted|(?:is|was)n't allowed|(?:is|was) not allowed|(?:couldn't|could not|was unable to) (?:access|read|open))\b/i;

/** The assistant words in a set of sessions, in order. */
function wordsIn(sessions: Session.WithMessagesAndParts[]): string {
  return sessions
    .flatMap((session) => session.messages)
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      ),
    )
    .join("\n");
}

/**
 * The setup held: t1 raised the card for the Pantry folder or a folder
 * holding it (Documents), nobody answered it, and the chat was woken with a
 * note saying t1 waits on it.
 */
const t1WaitsOnTheCard: Assertion = {
  check: async (ctx: Context) => {
    const text = "t1 raised the Pantry card and the chat's note says it waits";
    const task = (await listChildTasks(ctx.chatId)).find(
      (child) => child.handle === "t1",
    );
    const card = (await openAsks(ctx.chatId)).find(
      (ask): ask is Exclude<typeof ask, { kind: "question" }> =>
        ask.kind === "folder" &&
        // By its end: a report read later runs under another home.
        /[/\\]Documents(?:[/\\]Pantry)?$/.test(ask.target) &&
        ask.askers.some((asker) => asker.sessionId === task?.id),
    );
    const events = (ctx.sessions[0]?.messages ?? []).flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "data-taskEvent" ? part.data.events : [],
      ),
    );
    const waiting = events.some(
      (event) => event.sessionId === task?.id && (event.needs?.length ?? 0) > 0,
    );
    return (card && waiting ? pass : fail)(
      text,
      `card ${card ? `open for ${card.target}` : "not open for t1"}; notes: ${events.map((event) => `${event.handle ?? event.sessionId} with ${String(event.needs?.length ?? 0)} needs`).join(", ") || "(none)"}`,
    );
  },
  text: "t1 raised the Pantry card and the chat's note says it waits",
};

/** t1's own words never call the folder refused while its card is up. */
const taskDidNotCallItRefused: Assertion = {
  check: async (ctx: Context) => {
    const text = "t1 did not call the folder refused";
    const children = await ctx.childSessions();
    const words = wordsIn(children.flatMap((child) => child.sessions));
    const match = REFUSED.exec(words);
    return (match ? fail : pass)(
      text,
      match
        ? `said "${match[0]}": ${words.slice(Math.max(0, match.index - 120), match.index + 80)}`
        : words.slice(-300) || "(t1 said nothing)",
    );
  },
  text: "t1 did not call the folder refused",
};

/**
 * Woken by t1's note, the chat told the user the task is waiting on them,
 * and never that the folder was refused.
 */
const chatSaidItWaits: Assertion = {
  check: (ctx: Context) => {
    const text = "the chat said t1 waits on the user, not that it was refused";
    const chat = ctx.sessions[0];
    const messages = chat?.messages ?? [];
    const woke = messages.findIndex((message) =>
      message.parts.some((part) => part.type === "data-taskEvent"),
    );
    if (!chat || woke === -1) {
      return fail(text, "no note woke the chat");
    }
    const reply = wordsIn([{ ...chat, messages: messages.slice(woke + 1) }]);
    const refused = REFUSED.exec(reply);
    const waits =
      /\b(?:wait\w*|allow\w*|approv\w*|grant\w*|permission|access|card|ok(?:ay)?)\b/i.test(
        reply,
      );
    return (waits && !refused ? pass : fail)(
      text,
      `${refused ? `said "${refused[0]}"; ` : ""}${reply.slice(0, 300) || "(no reply)"}`,
    );
  },
  text: "the chat said t1 waits on the user, not that it was refused",
};

/** t1's own sessions, which the wakes it was given and its turns after them are in. */
async function t1Sessions(
  ctx: Context,
): Promise<Session.WithMessagesAndParts[]> {
  const task = (await listChildTasks(ctx.chatId)).find(
    (child) => child.handle === "t1",
  );
  const children = await ctx.childSessions();
  return children
    .flatMap((child) => child.sessions)
    .filter((session) => session.id === task?.id);
}

/**
 * The person allowed t1's card in the chat, and the answer woke t1, which
 * went on working: a turn of its own after the answer.
 */
const t1ResumedAfterTheCard: Assertion = {
  check: async (ctx: Context) => {
    const text = "t1 was woken by the answer to its card and worked on";
    const messages = (await t1Sessions(ctx)).flatMap(
      (session) => session.messages,
    );
    const answered = messages.findIndex((message) =>
      message.parts.some((part) => part.type === "data-permissionAnswer"),
    );
    const after =
      answered === -1
        ? []
        : messages
            .slice(answered + 1)
            .filter((message) => message.role === "assistant");
    return (answered !== -1 && after.length > 0 ? pass : fail)(
      text,
      answered === -1
        ? `no answer reached t1 (${String(messages.length)} messages of its own)`
        : `${String(after.length)} replies of t1's after the answer`,
    );
  },
  text: "t1 was woken by the answer to its card and worked on",
};

/** The card that woke t1 was the folder's, and none of t1's is open now. */
const t1sCardWasAnswered: Assertion = {
  check: async (ctx: Context) => {
    const text = "t1 asked for the Pantry folder and no card of t1's is open";
    const task = (await listChildTasks(ctx.chatId)).find(
      (child) => child.handle === "t1",
    );
    const asked = (await t1Sessions(ctx))
      .flatMap((session) => session.messages)
      .flatMap((message) => message.parts)
      .some((part) => part.type === "tool-ask_permission");
    const open = (await openAsks(ctx.chatId)).filter((ask) =>
      ask.askers.some((asker) => asker.sessionId === task?.id),
    );
    return (asked && open.length === 0 ? pass : fail)(
      text,
      `${asked ? "t1 asked" : "t1 never called ask_permission"}; ${String(open.length)} open cards of t1's`,
    );
  },
  text: "t1 asked for the Pantry folder and no card of t1's is open",
};

/**
 * t1 ended a turn on a need the person has to settle (a needs fence), and the
 * chat, woken by the note listing it, asked them on a card of its own, then
 * sent t1 their answer.
 */
const chatAskedForT1sNeed: Assertion = {
  check: async (ctx: Context) => {
    const text =
      "t1 named its need, the chat asked on a choose card, and sent t1 the answer";
    const task = (await listChildTasks(ctx.chatId)).find(
      (child) => child.handle === "t1",
    );
    const chat = ctx.sessions[0];
    const messages = chat?.messages ?? [];
    const woke = messages.findIndex((message) =>
      message.parts.some(
        (part) =>
          part.type === "data-taskEvent" &&
          part.data.events.some(
            (event) =>
              event.sessionId === task?.id && (event.needs?.length ?? 0) > 0,
          ),
      ),
    );
    const after = chat
      ? [{ ...chat, messages: woke === -1 ? [] : messages.slice(woke + 1) }]
      : [];
    const chose = after.some((session) =>
      session.messages.some((message) =>
        message.parts.some((part) => part.type === "tool-choose"),
      ),
    );
    const sent = commandsIn(after).some((command) =>
      /\binstrument task send t1\b/.test(command),
    );
    return (woke !== -1 && chose && sent ? pass : fail)(
      text,
      woke === -1
        ? "no note said t1 waits on a need"
        : `${chose ? "asked on a card" : "no choose card after the note"}; ${sent ? "sent t1 the answer" : "sent t1 nothing"}; ${wordsIn(after).slice(0, 200)}`,
    );
  },
  text: "t1 named its need, the chat asked on a choose card, and sent t1 the answer",
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
    assertions: [notedTheTimeout, retriedOrOfferedTo],
    followUps: [{ afterMs: 25_000, timeOutTask: "t1" }],
    kind: "chat",
    name: "task-session-timed-out",
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
  defineEval({
    assertions: [t1WaitsOnTheCard, taskDidNotCallItRefused, chatSaidItWaits],
    kind: "chat",
    name: "task-session-folder-card",
    get prompt() {
      return `Start a background task for this, please: read my pantry notes in ${PANTRY} and write a shopping list of what is running low as shopping-list.md in the workspace folder.`;
    },
    setup: seedPantry,
  }),
  defineEval({
    // The person allows the card in the chat, the way they would, and the
    // answer wakes t1, which does the work.
    allowsFolders: 1,
    assertions: [
      t1sCardWasAnswered,
      t1ResumedAfterTheCard,
      wrote("shopping-list.md", /(?=[\s\S]*olive oil)(?=[\s\S]*lentil)/i),
    ],
    kind: "chat",
    name: "task-session-folder-card-answered",
    get prompt() {
      return `Start a background task for this, please: read my pantry notes in ${PANTRY} and write a shopping list of what is running low as shopping-list.md in the workspace folder.`;
    },
    setup: seedPantry,
  }),
  defineEval({
    // A task cannot put a card up; what only the person can settle goes in
    // its needs fence, and the chat asks them.
    answers: [
      (input) => ({
        selectedChoice:
          input.choices.find((choice) => /funny/i.test(choice)) ??
          input.choices[0] ??
          "Funny",
      }),
    ],
    assertions: [chatAskedForT1sNeed, wrote("sam-note.md", /\S/)],
    kind: "chat",
    name: "task-session-needs-a-pick",
    prompt:
      "Start a background task right now, without asking me anything first: write a two-line birthday note for my friend Sam into sam-note.md in the workspace folder. Funny or sentimental is my call, so the task should ask me which before it writes anything.",
  }),
];
