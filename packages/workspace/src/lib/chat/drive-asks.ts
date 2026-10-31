import { isFreshAsk } from "@instrument-org/shared";
import { ORPCError } from "@orpc/server";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import {
  type AnswerRef,
  type AskRecord,
  type Outcome,
  type PermissionAskRecord,
  type PermissionDecision,
  type SystemWait,
} from "../../schemas/ask";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { AbsolutePathSchema, type AbsolutePath } from "../../schemas/paths";
import { type StoreId } from "../../schemas/store-id";
import { parseBrowserTargetId } from "../../types";
import { appEventOf } from "../apps/changed";
import { appChanged } from "../apps/changed";
import { readConnection, recordConnection } from "../apps/connection";
import { signInProgress } from "../apps/sign-in-group";
import { signInsSettled } from "../sign-in-progress-model-text";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { createWriteQueue } from "../create-write-queue";
import { getCurrentDate } from "../get-current-date";
import { updateHeldTabs } from "../held-tabs";
import { hostPathWithin } from "../host-path";
import { appBundleId, grantApp } from "../permissions/apps";
import { setDenied } from "../permissions/denials";
import {
  lookAsTheApp,
  macAppStanding,
  macosRefusalStatus,
  watchMacosPrompt,
} from "../permissions/macos";
import { type Level, placePaths } from "../permissions/places";
import {
  type PermissionSettings,
  updatePermissionSettings,
} from "../permissions/rules";
import { getWorkspaceConfig } from "../workspace-config";
import { type AskState } from "./ask-states";
import {
  answerableElsewhere,
  appendAnswer,
  changeAsk,
  chatAskStates,
  computerName,
  thisDevice,
} from "./asks";
import { listChatIds } from "./chat-records";
import { chatAskStatesOf } from "./chats";
import { grantFolder } from "./grants";
import { wakeChatForApp } from "./wake";
import { enqueueWake, saveNote, type WakePart } from "./wake-queue";
import { askWindow } from "./window-tab";

/**
 * The driver: on the computer an ask belongs to, and only there, moves
 * each of its asks one step at a time, writing the ask after each, until
 * nothing is owed. Every step reads where the ask stands from the records
 * (`askStates`), so a launch after a crash picks up at the step it stopped
 * on, and an answer from any device, this one's own included, is taken the
 * same way:
 *
 * 1. Open with a fresh answer pending: take it (`taken`).
 * 2. Taken: carry it out. A failure writes `failed`, spends the answer and
 *    opens the ask again.
 * 3. Carried out: `closed` with the outcome, not woken yet.
 * 4. Closed, not woken: wake each asker with the outcome, then `woken`. A
 *    session already holding a note for the ask is not woken again.
 *
 * Only a fresh answer (`isFreshAsk`) is taken, so a computer coming back
 * from sleep or a quit never acts on answers given while it was away; and
 * an answer from before this process started that is no longer fresh,
 * found part-way, finishes with a note that starts no turn.
 */

/** When this process started, which tells an answer a launch found from one it heard. */
const launchedAt = Date.now();

/** One pass per chat at a time. */
const passes = createWriteQueue();

/**
 * The looks inside running for an allowed folder or app, by ask: macOS's
 * own prompt can stay up for minutes, so the look runs beside the passes,
 * and writes what it found through them.
 */
const looks = new Map<string, Promise<void>>();

/**
 * Moves every ask of this computer's in the chat as far as it goes now,
 * and settles once the looks inside it started have answered and their
 * outcomes are woken. Failures are reported, never thrown: each is written
 * on its ask.
 */
export async function driveAsks(
  chatId: ChatId,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const started: Promise<void>[] = [];
  await pass(chatId, workspaceRef, started);
  await Promise.all(started);
}

/** One pass over the chat's asks, after any other pass of the chat's. */
function pass(
  chatId: ChatId,
  workspaceRef: WorkspaceActorRef,
  started: Promise<void>[],
): Promise<void> {
  return passes(chatId, async () => {
    // Bounded, since every step writes the ask and moves it on.
    for (let round = 0; round < 16; round++) {
      const own = (await chatAskStates(chatId)).filter(
        ({ ask }) => ask.device === thisDevice(),
      );
      let moved = false;
      for (const state of own) {
        try {
          moved = (await step(chatId, state, workspaceRef, started)) || moved;
        } catch (error) {
          getWorkspaceConfig().captureException(error);
        }
      }
      if (!moved) {
        return;
      }
    }
  });
}

/** Takes one step on an ask, answering whether it wrote anything. */
async function step(
  chatId: ChatId,
  state: AskState,
  workspaceRef: WorkspaceActorRef,
  started: Promise<void>[],
): Promise<boolean> {
  const { ask, askers, live, pending } = state;
  const { stage } = ask;
  if (stage.is === "closed") {
    if (stage.woken) {
      return false;
    }
    await wake(chatId, state, workspaceRef);
    return write(chatId, ask.id, (now) =>
      now.ask.stage.is === "closed"
        ? { ...now.ask, stage: { ...now.ask.stage, woken: true } }
        : undefined,
    );
  }
  if (askers.length === 0) {
    return close(chatId, ask.id, { kind: "left" }, undefined, true);
  }
  if (!live) {
    // The person wrote past it or stopped the chat: it closes, waking nobody.
    return close(chatId, ask.id, { kind: "left" }, undefined, true);
  }
  if (pending) {
    // Read again: an asker may have joined since this round read the ask.
    return write(chatId, ask.id, (now) => {
      if (!sameAnswer(now.pending, pending)) {
        return undefined;
      }
      const { failed: _failed, ...rest } = now.ask;
      return { ...rest, stage: { answer: pending, is: "taken" } };
    });
  }
  if (
    stage.is === "taken" &&
    ask.kind === "question" &&
    stage.answer.kind === "question"
  ) {
    const { answer } = stage;
    try {
      await writeOntoCall(chatId, ask, answer.answer);
    } catch (error) {
      await failTaken(chatId, ask.id, answer, error);
      throw error;
    }
    return close(
      chatId,
      ask.id,
      { answer: answer.answer, kind: "question" },
      answer,
    );
  }
  if (
    stage.is === "taken" &&
    ask.kind === "sign-in" &&
    stage.answer.kind === "sign-in"
  ) {
    // Not now from another device: this computer turns down every app on
    // the card not connected or turned down already, as read now, as its
    // own Not now does, and the card settles.
    for (const app of (await signInProgress(ask.apps)) ?? []) {
      if (app.standing !== "connected" && app.standing !== "declined") {
        await recordConnection(app.slug, { status: "declined" });
        await appChanged(app.slug, { event: "declined" });
      }
    }
    return refreshSignIn(chatId, ask.id, undefined, workspaceRef);
  }
  if (stage.is === "taken" && ask.kind === "permission") {
    const { answer } = stage;
    // A yes whose look is running is the look's to finish.
    if (
      answer.kind !== "permission" ||
      (answer.decision !== "declined" && looks.has(ask.id))
    ) {
      return false;
    }
    const carried = await carryOut(chatId, ask, answer, workspaceRef);
    if (carried) {
      started.push(carried.look);
    }
    return true;
  }
  return false;
}

/** Writes one of this computer's asks through `changeAsk`, answering whether it wrote. */
async function write(
  chatId: ChatId,
  askId: string,
  change: Parameters<typeof changeAsk>[2],
): Promise<boolean> {
  return (await changeAsk(chatId, askId, change)) !== undefined;
}

/** Closes an ask with its outcome, to be woken with next (or `woken` already, for one nobody hears). */
function close(
  chatId: ChatId,
  askId: string,
  outcome: Outcome,
  answer: AnswerRef | undefined,
  woken = false,
): Promise<boolean> {
  return write(chatId, askId, ({ ask }) =>
    ask.stage.is === "closed"
      ? undefined
      : { ...ask, stage: closedStage(outcome, answer, woken) },
  );
}

/**
 * An ask's closed stage, by this computer's clock. One that closes on a
 * stale answer from before this process started, which an earlier run
 * took and never carried out, is told with a note that starts no turn.
 */
function closedStage(
  outcome: Outcome,
  answer: AnswerRef | undefined,
  woken = false,
) {
  return {
    ...(answer && { answer: { at: answer.at, device: answer.device } }),
    closedAt: getCurrentDate(),
    is: "closed" as const,
    outcome,
    ...(answer &&
      answer.at.getTime() < launchedAt &&
      !isFreshAsk(answer.at) && { quiet: true as const }),
    woken,
  };
}

/** Whether two answers are the same one: the same device, at the same moment by its clock. */
function sameAnswer(a: AnswerRef | undefined, b: AnswerRef): boolean {
  return (
    a !== undefined &&
    a.device === b.device &&
    a.at.getTime() === b.at.getTime()
  );
}

/** Carries out a permission's taken answer. */
async function carryOut(
  chatId: ChatId,
  ask: PermissionAskRecord,
  answer: AnswerRef & { decision: PermissionDecision },
  workspaceRef: WorkspaceActorRef,
): Promise<{ look: Promise<void> } | undefined> {
  const data = {
    kind: ask.on,
    ...(ask.page && { page: ask.page }),
    target: ask.target,
  };
  if (answer.decision === "declined") {
    // Kept before the close, so an asker that asks again meets it; one
    // that cannot be kept is reported, and the askers still hear the no.
    if (ask.on !== "tab") {
      await setDenied(chatId, ask.on, ask.target, true).catch(
        getWorkspaceConfig().captureException,
      );
    }
    await close(
      chatId,
      ask.id,
      permissionOutcome({ ...data, answer: "declined" }),
      answer,
    );
    return undefined;
  }
  if (ask.on === "tab") {
    await close(
      chatId,
      ask.id,
      permissionOutcome({
        ...data,
        answer: (await moveTabIn(chatId, ask)) ? "allowed" : "gone",
      }),
      answer,
    );
    return undefined;
  }
  try {
    await grant(chatId, ask, answer.decision);
  } catch (error) {
    await failTaken(chatId, ask.id, answer, error);
    throw error;
  }
  // Wrapped, so awaiting the carrying out does not wait for the look.
  return { look: startLook(chatId, ask, answer.decision, workspaceRef) };
}

/**
 * Gives up on an answer an ask took and could not carry out: the ask is
 * open again, says why on `failed`, and the answer is spent, so the next
 * one given is taken rather than this one again.
 */
async function failTaken(
  chatId: ChatId,
  askId: string,
  answer: AnswerRef,
  error: unknown,
): Promise<void> {
  await changeAsk(chatId, askId, ({ ask: now }) =>
    now.stage.is === "taken"
      ? {
          ...now,
          failed: {
            ...now.stage.answer,
            message: error instanceof Error ? error.message : String(error),
          },
          spent: [
            ...(now.spent ?? []),
            { at: answer.at, device: answer.device },
          ],
          stage: { is: "open" },
        }
      : undefined,
  );
}

/** Writes a question's answer onto the `choose` call that asked it, for the card to draw. */
async function writeOntoCall(
  chatId: ChatId,
  ask: Extract<AskRecord, { kind: "question" }>,
  answer: SessionMessageDataPart.QuestionCardAnswer,
): Promise<void> {
  const [asker] = ask.askers;
  if (asker === undefined) {
    return;
  }
  const written = await ChatWrites.updatePart(
    {
      chatId,
      messageId: ask.messageId,
      partId: ask.partId,
      sessionId: asker.sessionId,
    },
    (part) =>
      part.type === "tool-choose" &&
      part.state === "output-available" &&
      "asked" in part.output
        ? { ...part, output: { ...part.output, answer } }
        : part,
  );
  if (written.isErr()) {
    throw written.error;
  }
}

function permissionOutcome(
  data: Extract<Outcome, { kind: "permission" }>["data"],
): Outcome {
  return { data, kind: "permission" };
}

/**
 * Looks inside an allowed folder or app as the app, beside the passes, and
 * writes what it found: closed with the yes once the system lets the app
 * in, or waiting on the system. Whoever asks while it runs waits for the
 * same look.
 */
function startLook(
  chatId: ChatId,
  ask: PermissionAskRecord,
  decision: "allowed" | "always",
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const running = looks.get(ask.id);
  if (running) {
    return running;
  }
  const from: SystemWait | undefined =
    ask.stage.is === "waiting" ? ask.stage.on : undefined;
  const answer =
    ask.stage.is === "taken" || ask.stage.is === "waiting"
      ? ask.stage.answer
      : undefined;
  // A yes still under way: a no given meanwhile closed it, or took its place.
  const stillYes = (now: AskState) =>
    now.ask.stage.is === "waiting" ||
    (now.ask.stage.is === "taken" &&
      now.ask.stage.answer.kind === "permission" &&
      now.ask.stage.answer.decision !== "declined");
  const waitOn = (on: SystemWait) =>
    changeAsk(chatId, ask.id, (now) =>
      stillYes(now) &&
      !(now.ask.stage.is === "waiting" && now.ask.stage.on === on)
        ? {
            ...now.ask,
            stage: {
              allowed: decision,
              ...(answer && {
                answer: { at: answer.at, device: answer.device },
              }),
              is: "waiting",
              on,
            },
          }
        : undefined,
    );
  const look = (async () => {
    const kept = await macosKeepsOut(ask, async () => {
      await waitOn("macos-asking");
    });
    if (kept !== undefined) {
      await waitOn(kept);
      return;
    }
    await changeAsk(chatId, ask.id, (now) =>
      stillYes(now)
        ? {
            ...now.ask,
            stage: closedStage(
              permissionOutcome({
                answer: decision,
                kind: ask.on,
                target: ask.target,
                ...(from === "windows-blocked" && {
                  through: "windows-protection" as const,
                }),
                // One of the Mac's own apps is connected for every chat, so
                // an ask about one only ever stood for macOS's prompt.
                ...(ask.on === "app" &&
                  (from === "macos-asking" || from === "macos-refused") && {
                    through: "macos" as const,
                  }),
              }),
              answer,
            ),
          }
        : undefined,
    );
  })().finally(() => {
    looks.delete(ask.id);
  });
  looks.set(ask.id, look);
  // The look's outcome is woken by the pass after it.
  return look.then(() => driveAsks(chatId, workspaceRef));
}

/**
 * Wakes each asker of a closed ask with its outcome: every one still on
 * it, but for a yes, one whose own command waits on what it asked for and
 * carries on by itself. A session already holding a note for this ask is
 * not woken again. An answer from before this process started that is no
 * longer fresh leaves its note without starting a turn, read with the
 * person's next message.
 */
async function wake(
  chatId: ChatId,
  { ask, askers }: AskState,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const { stage } = ask;
  if (stage.is !== "closed") {
    return;
  }
  if (stage.outcome.kind === "left") {
    return;
  }
  const yes =
    stage.outcome.kind === "permission" &&
    (stage.outcome.data.answer === "allowed" ||
      stage.outcome.data.answer === "always") &&
    ask.kind === "permission" &&
    ask.on !== "tab";
  // Loud only for an ask that closed while this process ran, on an answer
  // it heard: one owed since before (the app quit between closing and
  // waking) is read with the person's next message.
  const quiet =
    stage.quiet === true ||
    stage.closedAt === undefined ||
    stage.closedAt.getTime() < launchedAt;
  for (const asker of askers) {
    if (
      (yes && asker.waits === true) ||
      (await holdsNote(chatId, asker.sessionId, ask.id))
    ) {
      continue;
    }
    if (stage.outcome.kind === "sign-in") {
      const { events, notOnCard, signIns } = stage.outcome;
      await wakeChatForApp(events, workspaceRef, chatId, {
        ask: ask.id,
        ...(notOnCard && { notOnCard }),
        quiet,
        ...(signIns && { signIns }),
      });
      continue;
    }
    const part = wakePartOf(
      stage.outcome,
      ask,
      ask.kind === "question" ? await openSignInsOf(chatId) : undefined,
    );
    if (part === undefined) {
      continue;
    }
    if (quiet) {
      await saveNote(chatId, asker.sessionId, part);
    } else {
      await enqueueWake({
        chatId,
        part,
        sessionId: asker.sessionId,
        workspaceRef,
      });
    }
  }
}

/**
 * The note an outcome wakes its askers with, naming the ask. A question's
 * carries the chat's sign-ins still waiting, so the agent knows where they
 * are without saying so.
 */
function wakePartOf(
  outcome: Outcome,
  ask: AskRecord,
  signIns: SessionMessageDataPart.SignInProgress | undefined,
): WakePart | undefined {
  switch (outcome.kind) {
    case "permission":
      return {
        data: { ...outcome.data, ask: ask.id },
        type: "data-permissionAnswer",
      };
    case "question":
      return ask.kind === "question"
        ? {
            data: {
              answer: outcome.answer,
              ask: ask.id,
              partId: ask.partId,
              questions: ask.questions,
              ...(signIns && { signIns }),
            },
            type: "data-questionAnswer",
          }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The chat's sign-ins still waiting on the person, each card whole as this
 * computer's connections stand, for a note that wakes the chat about
 * something else; undefined when none waits.
 */
export async function openSignInsOf(
  chatId: ChatId,
): Promise<SessionMessageDataPart.SignInProgress | undefined> {
  const open: SessionMessageDataPart.SignInProgress = [];
  for (const { ask, live } of await chatAskStates(chatId)) {
    if (!live || ask.kind !== "sign-in") {
      continue;
    }
    const progress =
      ask.device === thisDevice() ? await signInProgress(ask.apps) : ask.apps;
    if (progress !== undefined && !signInsSettled(progress)) {
      open.push(...progress);
    }
  }
  return open.length === 0 ? undefined : open;
}

/**
 * Brings one of this computer's sign-ins up to date with its apps'
 * connections, after `event` (something the person did to one of them) or
 * a Not now: its rows are written as they stand, so every device draws
 * them; a sign-in that did not connect wakes the chat at once with the
 * card as it stands, and the ask stays up to try again; and once no app on
 * it waits, it closes with what happened to each, which wakes the chat
 * once. A card of one app its call asked for alone is told as that app's
 * event alone.
 */
export async function refreshSignIn(
  chatId: ChatId,
  askId: string,
  event: AppEventLine | undefined,
  workspaceRef: WorkspaceActorRef,
): Promise<boolean> {
  const state = (await chatAskStates(chatId)).find(
    ({ ask, live }) => live && ask.id === askId && ask.device === thisDevice(),
  );
  if (state?.ask.kind !== "sign-in") {
    return false;
  }
  const { ask } = state;
  const taken = ask.stage.is === "taken" ? ask.stage.answer : undefined;
  const progress = await signInProgress(ask.apps);
  // Every app on it is gone since it asked: nothing left to answer.
  if (progress === undefined) {
    return close(
      chatId,
      ask.id,
      event ? { events: [event], kind: "sign-in" } : { kind: "left" },
      taken,
      event === undefined,
    );
  }
  const card = ask.apps.length > 1 || ask.notOnCard !== undefined;
  if (event?.event === "failed" || !signInsSettled(progress)) {
    // Rows that did not change write nothing, so nothing goes round again.
    const wrote = await write(chatId, ask.id, ({ ask: now }) =>
      now.kind === "sign-in" &&
      now.stage.is !== "closed" &&
      JSON.stringify(now.apps) !== JSON.stringify(progress)
        ? { ...now, apps: progress }
        : undefined,
    );
    if (event?.event === "failed") {
      await wakeChatForApp(
        [event],
        workspaceRef,
        chatId,
        card ? { signIns: progress } : {},
      );
    }
    return wrote;
  }
  const others = progress.filter((app) => app.slug !== event?.slug);
  const told = [
    ...(event ? [event] : []),
    ...(await Promise.all(
      others.map((app) =>
        app.standing === "connected"
          ? connectedEvent(app.slug)
          : appEventOf(app.slug, { event: "declined" }),
      ),
    )),
  ];
  // The account a sign-in learned is on the connection, where the event,
  // read from the manifest, does not look; told per app, so the note does
  // not ask the agent to name an account it already has.
  const accounts = new Map(
    progress.flatMap((app) =>
      app.account === undefined ? [] : [[app.slug, app.account] as const],
    ),
  );
  const events = told.map((each) => {
    const account = each.account ?? accounts.get(each.slug);
    return account === undefined || each.event !== "connected"
      ? each
      : { ...each, account };
  });
  return write(chatId, ask.id, ({ ask: now }) =>
    now.kind === "sign-in" && now.stage.is !== "closed"
      ? {
          ...now,
          apps: progress,
          stage: closedStage(
            {
              events,
              kind: "sign-in",
              ...(card && ask.notOnCard && { notOnCard: ask.notOnCard }),
              ...(card && { signIns: progress }),
            },
            taken,
          ),
        }
      : undefined,
  );
}

type AppEventLine = SessionMessageDataPart.AppEventDataPart["events"][number];

/** An app's connection told as the event that made it, as `announceConnected` tells it. */
async function connectedEvent(slug: string): Promise<AppEventLine> {
  const connection = await readConnection(slug);
  return appEventOf(slug, {
    ...(connection?.toolCount === undefined
      ? {}
      : { detail: `${connection.toolCount} tools` }),
    event: "connected",
  });
}

/**
 * Not now to a sign-in, given on this device: appended like any device's,
 * and taken at once on the computer that asked. Signing in itself happens
 * there alone.
 */
export async function declineSignInAsk(
  chatId: ChatId,
  askId: string,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const state = (await chatAskStates(chatId)).find(
    ({ ask, live }) => live && ask.id === askId,
  );
  if (!state || state.ask.kind !== "sign-in" || !answerableElsewhere(state)) {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  await appendAnswer(chatId, askId, { decision: "declined", kind: "sign-in" });
  if (state.ask.device === thisDevice()) {
    await driveAsks(chatId, workspaceRef);
  }
}

/**
 * The person's answers to a question, given on this device: appended like
 * any device's, and on the computer that asked, taken at once, written onto
 * the call, and the chat woken with them. Elsewhere they wait for that
 * computer, and the card shows them answered meanwhile. Refused once the
 * question has an answer, from any device.
 */
export async function answerQuestionAsk(
  chatId: ChatId,
  askId: string,
  answer: SessionMessageDataPart.QuestionCardAnswer,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const state = (await chatAskStates(chatId)).find(
    ({ ask, live }) => live && ask.id === askId,
  );
  if (!state || state.ask.kind !== "question" || !answerableElsewhere(state)) {
    throw new ORPCError("NOT_FOUND", {
      message: "That question was already answered.",
    });
  }
  const { questions } = state.ask;
  if (answer.replies.length !== questions.length) {
    throw new ORPCError("BAD_REQUEST", {
      message: `The card asks ${questions.length} questions, and the answer has ${answer.replies.length} replies.`,
    });
  }
  await appendAnswer(chatId, askId, { answer, kind: "question" });
  if (state.ask.device === thisDevice()) {
    await driveAsks(chatId, workspaceRef);
  }
}

/** Whether a session already holds the note for an ask. */
async function holdsNote(
  chatId: ChatId,
  sessionId: StoreId.Session,
  askId: string,
): Promise<boolean> {
  const history = await ChatReads.history({ chatId, sessionId });
  return (
    history.isOk() &&
    history.value.some(
      (message) =>
        message.role === "user" &&
        message.parts.some(
          (part) =>
            (part.type === "data-permissionAnswer" ||
              part.type === "data-questionAnswer" ||
              part.type === "data-appEvent") &&
            part.data.ask === askId,
        ),
    )
  );
}

/**
 * The person's answer to a permission ask, given on this device: appended
 * like any device's. On the ask's own computer a pass takes it at once,
 * and the call settles once it is carried out and, on macOS, once the
 * system lets the app in, failing with why when it could not be. Elsewhere
 * it is recorded for that computer to take, and refused for an ask only
 * its screen can answer.
 */
export async function answerAsk(
  chatId: ChatId,
  askId: string,
  decision: PermissionDecision,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const state = (await chatAskStates(chatId)).find(
    ({ ask, live }) => live && ask.id === askId,
  );
  if (!state || state.ask.kind !== "permission") {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  const { ask } = state;
  if (ask.device !== thisDevice()) {
    if (!answerableElsewhere(state)) {
      const answered = state.pending !== undefined || ask.stage.is === "taken";
      throw new ORPCError(answered ? "CONFLICT" : "BAD_REQUEST", {
        message: answered
          ? "That request was already answered."
          : `That request needs answering on ${await computerName(ask.device)}.`,
      });
    }
    await appendAnswer(chatId, askId, { decision, kind: "permission" });
    return;
  }
  // A yes on an ask waiting on the system is the system's to answer; the
  // person's no still closes it, and a yes on one being carried out joins it.
  if (ask.stage.is === "waiting" && decision !== "declined") {
    throw new ORPCError("BAD_REQUEST", {
      message: "That request is waiting on the system.",
    });
  }
  const joins = ask.stage.is === "taken" && decision !== "declined";
  const given = joins
    ? undefined
    : await appendAnswer(chatId, askId, { decision, kind: "permission" });
  await driveAsks(chatId, workspaceRef);
  // A yes joining one already under way waits for its look, and its wake.
  const running = decision === "declined" ? undefined : looks.get(askId);
  if (running) {
    await running;
    await driveAsks(chatId, workspaceRef);
  }
  const failed = (await chatAskStates(chatId)).find(
    (now) => now.ask.id === askId,
  )?.ask.failed;
  if (
    given !== undefined &&
    failed !== undefined &&
    failed.device === given.device &&
    failed.at.getTime() === given.at.getTime()
  ) {
    throw new Error(failed.message);
  }
}

/**
 * Asks the system again about a folder or app an ask of this computer's
 * waits on it for, after the person let the app in through the system's
 * own ways, or after Windows let its programs through, and wakes the
 * askers with the yes once the app gets in. Resolves once it has looked.
 */
export async function retryAsk(
  chatId: ChatId,
  askId: string,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const ask = await ownWaitingAsk(chatId, askId);
  if (ask.stage.is !== "waiting") {
    return;
  }
  await startLook(chatId, ask, ask.stage.allowed, workspaceRef);
}

/** One of this computer's permission asks waiting on the system, which only it can act on. */
export async function ownWaitingAsk(
  chatId: ChatId,
  askId: string,
): Promise<PermissionAskRecord> {
  const state = (await chatAskStates(chatId)).find(
    ({ ask, live }) => live && ask.id === askId,
  );
  if (!state || state.ask.kind !== "permission") {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  if (state.ask.device !== thisDevice()) {
    throw new ORPCError("BAD_REQUEST", {
      message: `That request needs answering on ${await computerName(state.ask.device)}.`,
    });
  }
  if (state.ask.stage.is !== "waiting") {
    throw new ORPCError("BAD_REQUEST", {
      message: "That request isn't waiting on the system.",
    });
  }
  return state.ask;
}

/**
 * Drives this computer's asks as their records change, from any device,
 * and once per chat at launch for what was left part-way or answered
 * while it was off (which, no longer fresh, is not taken).
 */
export function startAskDriver(workspaceRef: WorkspaceActorRef): void {
  const drive = (chatId: ChatId) => {
    driveAsks(chatId, workspaceRef).catch(
      getWorkspaceConfig().captureException,
    );
  };
  publisher.subscribe("record.changed", ({ id, kind }) => {
    if (kind === "session") {
      drive(id);
    }
  });
  driveOwedAsks(workspaceRef).catch(getWorkspaceConfig().captureException);
}

/**
 * The launch's pass: drives each chat with an ask of this computer's that
 * something is owed on, read from its digest so a chat whose records have
 * not changed costs no read. An answer given while the computer was away
 * is no longer fresh and is not taken, and one found part-way finishes
 * with a note that starts no turn (`wake`).
 */
export async function driveOwedAsks(
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  for (const chatId of listChatIds()) {
    try {
      const owed = (await chatAskStatesOf(chatId)).some(
        ({ ask, live, pending }) =>
          ask.device === thisDevice() &&
          (pending !== undefined ||
            ask.stage.is === "taken" ||
            (ask.stage.is === "closed" && !ask.stage.woken) ||
            (!live && ask.stage.is !== "closed")),
      );
      if (owed) {
        await driveAsks(chatId, workspaceRef);
      }
    } catch (error) {
      getWorkspaceConfig().captureException(error);
    }
  }
}

/**
 * Moves the tab an ask is for out of the person's own tabs and into the
 * chat, page and all; the first to ask drives it, as a tab handed over:
 * the person's, never closed by the agent. Answers whether it moved.
 */
async function moveTabIn(
  chatId: ChatId,
  ask: PermissionAskRecord,
): Promise<boolean> {
  const took = await askWindow({
    action: { kind: "take", tabId: ask.target },
    askedBy: chatId,
    group: chatId,
  });
  const tabId = parseBrowserTargetId(ask.target);
  const driver = ask.askers[0]?.sessionId;
  const moved =
    took !== undefined && took.error === undefined && tabId !== null;
  if (moved && driver !== undefined) {
    await updateHeldTabs(chatId, driver, (tabs) => [
      ...tabs.filter((tab) => tab.id !== tabId),
      { id: tabId, inWindow: true, openedBy: "handed" },
    ]).catch(getWorkspaceConfig().captureException);
  }
  return moved;
}

/**
 * Settings with a folder set to `level`. A folder that is a built-in place
 * on its own (Documents, Desktop, Downloads) changes that place instead, so
 * the list never shows one folder twice with two answers. A place made of
 * several folders, or one that also holds the home folder's hidden entries,
 * keeps a rule for the one folder, which opens no more than was asked.
 */
export function withFolderLevel(
  settings: PermissionSettings,
  folder: AbsolutePath,
  level: Level,
): PermissionSettings {
  for (const place of placePaths()) {
    const [only, ...others] = place.paths;
    if (
      place.id !== "output" &&
      only !== undefined &&
      others.length === 0 &&
      !place.closedUnlessAllowed &&
      hostPathWithin(only, folder) === "/"
    ) {
      return {
        ...settings,
        folders: settings.folders.filter((f) => f.path !== folder),
        places: { ...settings.places, [place.id]: level },
      };
    }
  }
  const known = settings.folders.find((f) => f.path === folder);
  return {
    ...settings,
    folders: known
      ? settings.folders.map((f) => (f.path === folder ? { ...f, level } : f))
      : [
          ...settings.folders,
          { addedAt: getCurrentDate(), level, path: folder },
        ],
  };
}

/** Lets the chat use what the ask is for, and every chat with Always allow. */
async function grant(
  chatId: ChatId,
  ask: PermissionAskRecord,
  decision: "allowed" | "always",
): Promise<void> {
  const { on, target } = ask;
  if (on === "tab") {
    return;
  }
  await setDenied(chatId, on, target, false);
  if (on === "folder") {
    await grantFolder({ chatId, path: target, source: "card" });
    if (decision === "always") {
      const folder = AbsolutePathSchema.parse(target);
      await updatePermissionSettings((settings) =>
        withFolderLevel(settings, folder, "allow"),
      );
    }
    return;
  }
  await grantApp(chatId, target);
  if (decision === "always") {
    const bundleId = await appBundleId(target);
    await updatePermissionSettings((settings) => ({
      ...settings,
      apps: [
        ...settings.apps.filter(
          (app) => app.name.toLowerCase() !== target.toLowerCase(),
        ),
        {
          addedAt: getCurrentDate(),
          bundleId,
          level: "allow",
          name: target,
        },
      ],
    }));
  }
}

/**
 * How macOS keeps the app from what `ask` is for, once the person said
 * yes: what it waits on, or undefined when it lets the app in (or off
 * macOS). A folder is looked inside, and an app asked of macOS, which raises
 * the system's prompt nobody has answered yet; `onAsking` runs once when
 * that prompt is on screen while the answer waits.
 */
async function macosKeepsOut(
  ask: PermissionAskRecord,
  onAsking: () => Promise<void>,
): Promise<
  Exclude<SystemWait, "macos-asking" | "windows-blocked"> | undefined
> {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (ask.on === "folder") {
    return (await lookAsTheApp(ask.target, onAsking)) === "system"
      ? macosRefusalStatus(ask.target)
      : undefined;
  }
  const bundleId = await appBundleId(ask.target);
  if (bundleId === undefined) {
    return undefined;
  }
  const standing = macAppStanding(
    { bundleId, name: ask.target },
    { request: true },
  );
  const watched = watchMacosPrompt(standing, onAsking);
  const standingAnswer = await standing;
  await watched;
  return standingAnswer === "denied" ? "macos-refused" : undefined;
}
