import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";
import { setTimeout as sleep } from "node:timers/promises";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { ChatWrites } from "../chat-writes";
import { chatModelURI } from "../chat-settings";
import { recordChanged } from "../record-changes";
import { resolveChat, sessionOfChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking } from "./activity";

/** What a wake carries: the part that starts the session's turn. */
export type WakePart =
  | { data: SessionMessageDataPart.AppEventDataPart; type: "data-appEvent" }
  | {
      data: SessionMessageDataPart.PermissionAnswerDataPart;
      type: "data-permissionAnswer";
    }
  | {
      data: SessionMessageDataPart.QuestionAnswerDataPart;
      type: "data-questionAnswer";
    }
  | { data: SessionMessageDataPart.JobEventDataPart; type: "data-jobEvent" }
  | { data: SessionMessageDataPart.SignedInDataPart; type: "data-signedIn" }
  | { data: SessionMessageDataPart.TaskEventDataPart; type: "data-taskEvent" };

/**
 * The waits between lookups of a chat's model before a wake gives up on
 * starting its turn, about two minutes in all.
 */
const WAKE_MODEL_RETRY_DELAYS_MS = [
  ms("2 seconds"),
  ms("5 seconds"),
  ms("15 seconds"),
  ms("30 seconds"),
  ms("1 minute"),
];

/** One wake of a session, as its source hands it over. */
export interface Wake {
  /**
   * Runs once the wake is sure to be written, before its note: what the
   * source records about the news being told.
   */
  beforeNote?: (part: WakePart) => Promise<void>;
  chatId: ChatId;
  /** How long it waits for more of the same before it goes; none goes at once. */
  debounceMs?: number;
  /**
   * Wakes of the session under the same key wait out one debounce together;
   * a wake with none is its own.
   */
  key?: string;
  /**
   * How a wake joins the one waiting under its key, both given as parts:
   * the part they go as, or none to leave the waiting one as it is, its
   * debounce included. Without it the newer takes the waiting one's place.
   */
  merge?: (waiting: WakePart, next: WakePart) => WakePart | undefined;
  /**
   * The part, or how to read it once the debounce is over, in the same
   * synchronous run that counts the wake as delivering: none when there is
   * no news left to tell.
   */
  part: (() => WakePart | undefined) | WakePart;
  /**
   * Only to a session at rest: one with a turn running when the debounce is
   * over holds the wake until that turn's end, and it waits again from there.
   */
  restingOnly?: boolean;
  /** The session to wake: a task's, else the chat's own. */
  sessionId?: StoreId.Session;
  /** Whether it still has news to start a turn with while it waits; counted as on its way only then. */
  stillNews?: () => boolean;
  workspaceRef: WorkspaceActorRef;
}

/** A wake waiting under its key: out its debounce, or for its session's turn to end. */
interface Waiting {
  release: () => void;
  settle: () => void;
  settled: Promise<void>;
  timer?: NodeJS.Timeout;
  wake: Wake;
}

/** Something of a chat's counted toward a wake being on its way. */
interface OnItsWay {
  /** Whether it still has news to start a turn with; counted as long as it has none to ask. */
  stillNews?: () => boolean;
}

/** What each chat has counted toward a wake on its way. */
const onItsWay = new Map<ChatId, Set<OnItsWay>>();

/** The wakes waiting, by chat, session and key. */
const waiting = new Map<string, Waiting>();

/** The wakes held for a turn to end, by chat and session, each by its key in `waiting`. */
const held = new Map<string, Set<string>>();

let hearingTurnEnds = false;

/**
 * Wakes a session with a part, through one delivery every source shares:
 * the debounce, the chat still being there, a turn running in a session
 * that takes wakes only at rest, the part read once the wait is over, the
 * chat's model, the note written, the model looked up with retries, and the
 * turn started. A session with a turn going hears the wake at its next step.
 *
 * Settles once the wake has been delivered or dropped. One that goes at once
 * rejects with what went wrong for its caller; a debounced one, whose wait
 * may have taken in several callers' news, reports it instead.
 */
export function enqueueWake(wake: Wake): Promise<void> {
  const key = waitingKey(wake);
  const existing = waiting.get(key);
  if (existing) {
    if (existing.timer === undefined) {
      // Held for its session's turn to end, which reads the part again then.
      return existing.settled;
    }
    const merged = mergedPart(existing.wake, wake);
    if (merged === undefined) {
      return existing.settled;
    }
    clearTimeout(existing.timer);
    existing.wake = { ...wake, part: merged };
    existing.timer = debounce(key, wake.debounceMs);
    return existing.settled;
  }
  if (!wake.debounceMs) {
    return deliver(wake, readPart(wake));
  }
  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const entry: Waiting = {
    release: countOnItsWay(wake.chatId, { stillNews: wake.stillNews }),
    settle,
    settled,
    wake,
  };
  waiting.set(key, entry);
  entry.timer = debounce(key, wake.debounceMs);
  return settled;
}

/**
 * Counts toward the chat's wake being on its way until the returned
 * release is called, which is safe to call twice: what a source holds
 * while it works out whether there is news to wake with at all.
 */
export function holdWake(chatId: ChatId): () => void {
  return countOnItsWay(chatId);
}

/**
 * Whether a wake is on its way to start a turn in one of the chat's
 * sessions: waiting out a debounce with news still to tell, or between that
 * and reaching its session, which writes its note first and may then spend
 * a while finding the chat's model. The chat is still at work all that
 * time: something of it has moved, and its agent has not started on the
 * news yet. One held for a turn to end is not, since that turn is.
 */
export function hasWakeOnItsWay(chatId: ChatId): boolean {
  for (const entry of onItsWay.get(chatId) ?? []) {
    if (entry.stillNews?.() ?? true) {
      return true;
    }
  }
  return false;
}

/**
 * Counts something toward the chat's wake being on its way until the
 * returned release is called, which is safe to call twice. The chat's row
 * is read again whenever that moves whether a wake is on its way: a wake
 * that never reached its session leaves the chat as it was, which nothing
 * else would say.
 */
export function countOnItsWay(
  chatId: ChatId,
  entry: OnItsWay = {},
): () => void {
  const before = hasWakeOnItsWay(chatId);
  const entries = onItsWay.get(chatId) ?? new Set();
  entries.add(entry);
  onItsWay.set(chatId, entries);
  if (!before && hasWakeOnItsWay(chatId)) {
    recordChanged(chatId, "agent");
  }
  return () => {
    const was = hasWakeOnItsWay(chatId);
    if (!entries.delete(entry)) {
      return;
    }
    if (entries.size === 0 && onItsWay.get(chatId) === entries) {
      onItsWay.delete(chatId);
    }
    if (was && !hasWakeOnItsWay(chatId)) {
      recordChanged(chatId, "agent");
    }
  };
}

function waitingKey({ chatId, key, sessionId }: Wake): string {
  return JSON.stringify([
    chatId,
    sessionId ?? null,
    key ?? StoreId.newMessageId(),
  ]);
}

function sessionKey(chatId: ChatId, sessionId: StoreId.Session): string {
  return JSON.stringify([chatId, sessionId]);
}

/** The part two wakes under one key go as, or none to leave the waiting one be. */
function mergedPart(waitingWake: Wake, next: Wake) {
  const { merge } = next;
  if (
    merge === undefined ||
    typeof waitingWake.part === "function" ||
    typeof next.part === "function"
  ) {
    return next.part;
  }
  return merge(waitingWake.part, next.part);
}

function readPart(wake: Wake): WakePart | undefined {
  return typeof wake.part === "function" ? wake.part() : wake.part;
}

/**
 * Starts the wait of the wake under `key`, which keeps no process running
 * on its own.
 */
function debounce(key: string, delayMs: number | undefined): NodeJS.Timeout {
  const timer = setTimeout(() => {
    fire(key);
  }, delayMs);
  timer.unref();
  return timer;
}

/** The debounce of the wake under `key` is over. */
function fire(key: string) {
  const entry = waiting.get(key);
  if (!entry) {
    return;
  }
  const { wake } = entry;
  entry.timer = undefined;
  const chatId = resolveChat(wake.chatId);
  const sessionId = chatId && (wake.sessionId ?? sessionOfChat(chatId));
  if (sessionId && wake.restingOnly && isWorkingNow(wake.chatId, sessionId)) {
    hold(key, sessionKey(wake.chatId, sessionId));
    entry.release();
    return;
  }
  waiting.delete(key);
  // Counted for its delivery before the wait lets go, in the same run the
  // part is read in, so the chat never reads as having nothing on its way
  // in between, and news read as told is never left uncounted.
  const delivered = sessionId
    ? deliver(wake, readPart(wake))
    : Promise.resolve();
  entry.release();
  delivered
    .catch((error: unknown) => {
      getWorkspaceConfig().captureException(error);
    })
    .finally(entry.settle);
}

/** Holds the wake under `key` until its session's turn ends. */
function hold(key: string, session: string) {
  const keys = held.get(session) ?? new Set();
  keys.add(key);
  held.set(session, keys);
  if (hearingTurnEnds) {
    return;
  }
  hearingTurnEnds = true;
  publisher.subscribe("session.done", ({ id, sessionId }) => {
    const ended = sessionKey(id, sessionId);
    const heldThere = held.get(ended);
    held.delete(ended);
    for (const each of heldThere ?? []) {
      wait(each);
    }
  });
}

/** Starts the debounce again for a wake that was held for a turn to end. */
function wait(key: string) {
  const entry = waiting.get(key);
  if (!entry) {
    return;
  }
  entry.release = countOnItsWay(entry.wake.chatId, {
    stillNews: entry.wake.stillNews,
  });
  entry.timer = debounce(key, entry.wake.debounceMs);
}

/**
 * Takes a wake from its part to the turn it starts, counted as on its way
 * from the first synchronous step until the turn has been asked for or the
 * wake has given up. None of it runs for a wake with no news, and none of it
 * for a chat that is gone or has never been messaged.
 */
async function deliver(wake: Wake, part: WakePart | undefined): Promise<void> {
  const chatId = resolveChat(wake.chatId);
  const sessionId = chatId && (wake.sessionId ?? sessionOfChat(chatId));
  if (!part || !chatId || !sessionId) {
    return;
  }
  const release = countOnItsWay(chatId);
  try {
    const modelURI = await chatModelURI(chatId);
    if (!modelURI) {
      return;
    }
    await wake.beforeNote?.(part);
    const message = await saveNote(chatId, sessionId, part);
    // Looked up after the note is written, so a model the chat cannot resolve
    // yet still leaves the news in the conversation, where the user's next
    // message carries it to the agent.
    const model = await wakeModel(modelURI);
    wake.workspaceRef.send({
      type: "addMessage",
      value: { id: chatId, message, model, saved: true, sessionId },
    });
  } finally {
    release();
  }
}

/**
 * Writes a wake's part as a text-less user message in a session, which shows
 * in the conversation at once and reaches the agent with the session's next
 * turn, whatever starts it.
 */
export async function saveNote(
  chatId: ChatId,
  sessionId: StoreId.Session,
  part: WakePart,
): Promise<SessionMessage.UserWithParts> {
  const createdAt = new Date();
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts: [
      {
        ...part,
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
      },
    ],
    role: "user",
  };

  // Written now, so the note shows in the conversation the moment it fires,
  // whatever the chat is in the middle of.
  const written = await ChatWrites.saveMessageWithParts(message, chatId);
  if (written.isErr()) {
    throw new Error(written.error.message);
  }
  return message;
}

/**
 * The chat's model, asked for again after each wait in
 * `WAKE_MODEL_RETRY_DELAYS_MS` while the lookup fails, since a provider's
 * catalog can leave a model out for a moment and list it again.
 */
async function wakeModel(modelURI: AIGatewayModelURI.Type) {
  const workspaceConfig = getWorkspaceConfig();
  const lookUp = () =>
    fetchModel({
      captureException: workspaceConfig.captureException,
      configs: workspaceConfig.getAIProviderConfigs(),
      modelCache: workspaceConfig.modelCache,
      modelRoutes: workspaceConfig.modelRoutes,
      modelURI,
    });
  let result = await lookUp();
  for (const delayMs of WAKE_MODEL_RETRY_DELAYS_MS) {
    if (result.ok) {
      break;
    }
    await sleep(delayMs);
    result = await lookUp();
  }
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Whether the session has a turn running, or false where no workspace is running to ask. */
function isWorkingNow(chatId: ChatId, sessionId: StoreId.Session): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
