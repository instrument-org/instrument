import { APP_NAME } from "@instrument-org/shared";
import { ulid } from "ulid";

import {
  type AnswerGiven,
  type AnswerRef,
  type AskRecord,
  type PermissionAskRecord,
  type SystemWait,
} from "../../schemas/ask";
import { type ChatId } from "../../schemas/chat-id";
import { type Ask, type PermissionAsk } from "../../schemas/chat-state";
import { type DeviceId } from "../../schemas/device-id";
import { type StoreId } from "../../schemas/store-id";
import { createWriteQueue } from "../create-write-queue";
import { getCurrentDate } from "../get-current-date";
import { askTargetName } from "../permissions/ask-target";
import { sessionOfChat } from "../record-folders";
import { readDeviceName } from "../records/device-file";
import { writingChatRecords } from "../records/installed-records";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { TOOL_NAMES } from "../../tools/name";
import { type AskState, askStates } from "./ask-states";

/**
 * What a chat waits on the person for: the folders, apps and tabs its
 * agents asked for. Each is an `ask` record in the chat's own session's
 * log, written whole by the computer it belongs to, the one whose grants
 * it is about, so every device the chat syncs to shows it. Any device
 * answers it, or stops a session on it, with an `answer` record in its own
 * log; where it stands is `askStates` over those records, and the ask's
 * computer alone acts on it (`drive-asks.ts`).
 */

/** What raised an ask: the chat and the session that asked. */
export interface Asker {
  chatId: ChatId;
  /** The call that asked, by its part's id. */
  partId?: StoreId.Part;
  sessionId: StoreId.Session;
  /** The session's command waits on what the ask is about itself (`waits` on the ask's asker). */
  waits?: true;
}

/**
 * The chat's asks and the answers to them, as its records have them with
 * this device's writes still on their way. Read through the records this
 * process has in place rather than `ChatReads`, which the permission rules
 * that raise an ask cannot import without the records' own schemas
 * reaching back to them.
 */
export async function askRecords(
  chatId: ChatId,
): Promise<Pick<Parameters<typeof askStates>[0], "answers" | "asks">> {
  const sessionId = sessionOfChat(chatId);
  const records = writingChatRecords();
  if (sessionId === undefined || records === undefined) {
    return { answers: [], asks: [] };
  }
  // A chat whose records cannot be read has no ask anyone can answer.
  const read = await records.read(chatId).catch(() => undefined);
  const session = read?.chat.sessions.find(({ id }) => id === sessionId);
  return { answers: session?.answers ?? [], asks: session?.asks ?? [] };
}

/** Where each of the chat's asks stands now, every computer's, oldest first. */
export async function chatAskStates(chatId: ChatId): Promise<AskState[]> {
  return askStates({ ...(await askRecords(chatId)), now: Date.now() });
}

/** The records this process writes the chat's asks and answers to. */
function askWriter(chatId: ChatId) {
  const records = writingChatRecords();
  if (records === undefined) {
    throw new Error(`No records are in place to write chat ${chatId} to`);
  }
  return records;
}

/**
 * This device's id, which an ask it raises names as its computer: the one
 * its records are written as.
 */
export function thisDevice(): DeviceId {
  return writingChatRecords()?.device ?? getWorkspaceConfig().deviceId;
}

/**
 * Changes to this device's asks, one at a time per chat, so each reads what
 * the last one wrote: raising one, and every step the driver takes.
 */
const askWrites = createWriteQueue();

/**
 * Changes one of this device's asks and writes it whole, answering the ask
 * as written, or nothing when `change` leaves it be. `change` is handed the
 * ask's state as the records have it now, and nothing is asked of an ask
 * that is another computer's or gone.
 */
export function changeAsk(
  chatId: ChatId,
  askId: string,
  change: (state: AskState) => AskRecord | undefined,
): Promise<AskRecord | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return Promise.resolve(undefined);
  }
  return askWrites(chatId, async () => {
    const state = (await chatAskStates(chatId)).find(
      ({ ask }) => ask.id === askId && ask.device === thisDevice(),
    );
    const changed = state && change(state);
    if (changed !== undefined) {
      await askWriter(chatId).ask(chatId, sessionId, changed);
    }
    return changed;
  });
}

/** What a permission ask about the system's own answer says: macOS asking, refusing, or private, or Windows blocking. */
export type MacosAskStatus = SystemWait;

/**
 * Records that the agent asked for a folder, an app or a tab the person
 * has not answered for, so the chat shows the card on every computer it
 * is open on. One ask per thing: asking again while it is up raises
 * nothing new, and another session that asks joins it, to be woken with
 * its answer too. `status` raises it, or turns the one already up, into
 * one about the system's own answer (macOS, or Windows' ransomware
 * protection, with the `programs` it blocked), for a thing the person's
 * rules already allow. A tab's ask carries its `page`. Answers its id.
 */
export async function recordAsk(
  asker: Asker & { reason?: string },
  kind: PermissionAskRecord["on"],
  target: string,
  extra?:
    | {
        allowed: "allowed" | "always";
        programs?: string[];
        status: MacosAskStatus;
      }
    | { page: NonNullable<PermissionAskRecord["page"]> },
): Promise<string> {
  const system = extra && "status" in extra ? extra : undefined;
  const page = extra && "page" in extra ? extra.page : undefined;
  const joining = {
    at: getCurrentDate(),
    ...(asker.partId && { partId: asker.partId }),
    ...(asker.reason && { reason: asker.reason }),
    sessionId: asker.sessionId,
    ...(asker.waits && { waits: true as const }),
  };
  const sessionId = sessionOfChat(asker.chatId);
  const id = ulid();
  if (sessionId === undefined) {
    return id;
  }
  return askWrites(asker.chatId, async () => {
    const open = (await chatAskStates(asker.chatId)).find(
      ({ ask, live }) =>
        live &&
        ask.device === thisDevice() &&
        ask.kind === "permission" &&
        ask.on === kind &&
        ask.target === target,
    );
    const waiting = system && {
      allowed: system.allowed,
      is: "waiting" as const,
      on: system.status,
    };
    if (open?.ask.kind !== "permission") {
      await askWriter(asker.chatId).ask(asker.chatId, sessionId, {
        askedAt: joining.at,
        askers: [joining],
        device: thisDevice(),
        id,
        kind: "permission",
        on: kind,
        ...(page && { page }),
        ...(system?.programs && { programs: system.programs }),
        stage: waiting ?? { is: "open" },
        target,
      });
      return id;
    }
    const { ask, askers } = open;
    const on = askers.find((one) => one.sessionId === asker.sessionId);
    // A session already on the ask whose command waited on it, asking now
    // with a call that ends its turn, is woken by the answer from now on.
    const stopsWaiting = on?.waits === true && asker.waits !== true;
    if (on !== undefined && !stopsWaiting && waiting === undefined) {
      return ask.id;
    }
    const taken = ask.stage.is === "taken" ? ask.stage.answer : undefined;
    await askWriter(asker.chatId).ask(asker.chatId, sessionId, {
      ...ask,
      askers:
        on === undefined
          ? [...askers, joining]
          : stopsWaiting
            ? askers.map((one) => (one === on ? joining : one))
            : askers,
      ...(system?.programs && { programs: system.programs }),
      ...(waiting && {
        stage: {
          ...waiting,
          ...(taken && { answer: { at: taken.at, device: taken.device } }),
        },
      }),
    });
    return ask.id;
  });
}

/** Each computer's name by its device, once read. */
const computerNames = new Map<DeviceId, string>();

/**
 * The name a computer goes by, from its device file; "another computer" for
 * one whose file has not arrived yet.
 */
export async function computerName(device: DeviceId): Promise<string> {
  const known = computerNames.get(device);
  if (known !== undefined) {
    return known;
  }
  const name = await readDeviceName({
    device,
    devicesDir: workspaceLayout(getWorkspaceConfig().rootDir).devicesDir,
  });
  if (name === undefined) {
    return device === thisDevice() ? "this computer" : "another computer";
  }
  computerNames.set(device, name);
  return name;
}

/**
 * Whether a device other than the ask's computer may answer it: while it
 * is open with no answer pending, and not a tab, which is moved on the
 * screen it is on, as the system's own prompts and blocks are answered
 * there.
 */
export function answerableElsewhere(state: AskState): boolean {
  return (
    state.live &&
    state.pending === undefined &&
    state.ask.stage.is === "open" &&
    !(state.ask.kind === "permission" && state.ask.on === "tab")
  );
}

/** A live permission ask as this device's readers draw it. */
async function permissionAskOf(
  state: AskState & { ask: PermissionAskRecord },
): Promise<PermissionAsk> {
  const { ask, askers, away, pending } = state;
  const { stage } = ask;
  const here = ask.device === thisDevice();
  const taken =
    stage.is === "taken" && stage.answer.kind === "permission"
      ? stage.answer
      : undefined;
  const answer = taken ?? pending;
  const waitingOn =
    stage.is === "waiting" && stage.answer ? stage.answer : undefined;
  return {
    ...(stage.is === "waiting" && { allowed: stage.allowed }),
    ...(answer?.kind === "permission" && {
      answered: {
        by: await computerName(answer.device),
        decision: answer.decision,
        taken: answer === taken,
      },
    }),
    ...(waitingOn &&
      stage.is === "waiting" && {
        answered: {
          by: await computerName(waitingOn.device),
          decision: stage.allowed,
          taken: true,
        },
      }),
    answerable: here || answerableElsewhere(state),
    askedAt: ask.askedAt,
    askers,
    ...(away?.kind === "permission" && {
      away: { by: await computerName(away.device), decision: away.decision },
    }),
    computer: await computerName(ask.device),
    device: ask.device,
    ...(ask.failed?.kind === "permission" && {
      failed: { decision: ask.failed.decision, message: ask.failed.message },
    }),
    here,
    id: ask.id,
    kind: ask.on,
    ...(ask.page && { page: ask.page }),
    ...(ask.programs && { programs: ask.programs }),
    status: stage.is === "waiting" ? stage.on : "open",
    target: ask.target,
  };
}

/** The live permission asks among `states` as this device's readers draw them, oldest first. */
export function permissionAsksOf(
  states: readonly AskState[],
): Promise<PermissionAsk[]> {
  return Promise.all(
    states.flatMap((state) =>
      state.live && state.ask.kind === "permission"
        ? [permissionAskOf({ ...state, ask: state.ask })]
        : [],
    ),
  );
}

/** The chat's open permission asks, every computer's, oldest first. */
export async function openPermissionAsks(
  chatId: ChatId,
): Promise<PermissionAsk[]> {
  return permissionAsksOf(await chatAskStates(chatId));
}

/** Asks oldest first. */
export function sortAsks<T extends { askedAt: Date }>(asks: T[]): T[] {
  return asks.toSorted((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
}

/**
 * What an open ask waits on the user for: the question itself, or the
 * folder or app it asks about.
 */
export function cardLine(
  card:
    | Ask
    | Pick<PermissionAsk, "kind" | "page" | "status" | "target">
    | AskRecord,
): string {
  if (card.kind === "question") {
    return "question" in card
      ? card.question.trim() || "Waiting for you to answer"
      : card.questions[0]?.trim() || "Waiting for you to answer";
  }
  if (card.kind === "sign-in") {
    return `Waiting for you to connect ${card.apps.map((app) => app.name).join(", ")}`;
  }
  const kind = card.kind === "permission" ? card.on : card.kind;
  const status =
    card.kind === "permission"
      ? card.stage.is === "waiting"
        ? card.stage.on
        : "open"
      : card.status;
  if (kind === "tab") {
    return `Waiting for you to move your tab “${card.page?.title || "a page"}” here`;
  }
  const name = askTargetName(kind, card.target);
  switch (status) {
    case "macos-asking":
      return `Your Mac is asking about ${name}`;
    case "windows-blocked":
      return `Windows is blocking changes to ${name}`;
    default:
      return `Waiting for your OK to use ${name}`;
  }
}

/**
 * Appends this device's answer to an ask, whichever computer it belongs
 * to: answers who gave it and when. The first fresh answer in log order
 * wins; this one may come after another.
 */
export async function appendAnswer(
  chatId: ChatId,
  askId: string,
  given: AnswerGiven,
): Promise<AnswerRef | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return undefined;
  }
  return askWriter(chatId).answer(chatId, sessionId, { ask: askId, given });
}

/**
 * Takes a session the person stopped off the asks it is on, or with no
 * session every session off every ask of the chat's, answering none: the
 * Stop ends what the session waited on them for, and an answer would start
 * it again. An ask another session still waits on stays up for that one,
 * and one nobody is left on closes. A later ask for the same thing raises
 * an ask of its own. Every device, the ask's own computer too, writes the
 * Stop as a `stopped` answer naming the asker entries it takes off, which
 * every reader folds the same way and the ask's computer writes into the
 * ask.
 */
export async function closeAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session | undefined,
): Promise<void> {
  const leaving = (await chatAskStates(chatId)).flatMap(
    ({ ask, askers, live }) => {
      const off = askers.filter(
        (asker) => sessionId === undefined || asker.sessionId === sessionId,
      );
      return live && off.length > 0 ? [{ ask, off }] : [];
    },
  );
  await Promise.all(
    leaving.map(({ ask, off }) =>
      // The entries as this device saw the ask, so no clock but the ask's
      // own is read.
      appendAnswer(chatId, ask.id, {
        askers: off.map(({ at, sessionId: asking }) => ({
          at,
          sessionId: asking,
        })),
        kind: "stopped",
      }),
    ),
  );
}

/**
 * What the agent reads when it runs into something the person must allow
 * first: `what` it was kept from, and the folder or app to ask for.
 */
export function askFirstNote(what: string, ask: string): string {
  return `${what} needs the person's yes. If the work needs it, ask for ${ask} with ${TOOL_NAMES.askPermission}.`;
}

/**
 * What the agent is told when macOS itself refused a path the person's
 * rules allow: the card `ask` raises is the person's way to let the app in,
 * which the system's settings would otherwise be the only one of.
 */
export function macosRefusalNote(shown: string): string {
  return `macOS itself refused ${shown}, not the person's settings. If the work needs it, ask for ${shown} with ${TOOL_NAMES.askPermission}: its card shows them how to let ${APP_NAME} in. Never suggest Full Disk Access.`;
}
