import { ORPCError } from "@orpc/server";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import {
  type CardDecision,
  type PermissionCard,
} from "../../schemas/permission-card";
import { AbsolutePathSchema, type AbsolutePath } from "../../schemas/paths";
import { parseBrowserTargetId } from "../../types";
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
import {
  answerableElsewhere,
  answerCard,
  closeAsk,
  computerName,
  failAnswer,
  type MacosAskStatus,
  openCard,
  type OpenCard,
  openCards,
  setMacosStatus,
  takeAnswer,
  takeStops,
  thisDevice,
} from "./asks";
import { listChatIds } from "./chat-records";
import { chatOpenCards } from "./chats";
import { grantFolder } from "./grants";
import { wakeAskers } from "./wake";
import { askWindow } from "./window-tab";

/**
 * Answering a permission card, from any device, and acting on the answer on
 * the computer the card belongs to: the only one that grants what it asks
 * for, since the grant is that computer's (`permissions.json`), and the one
 * that wakes the sessions that asked. Another device's answer is an
 * `answer` record in its own log; this computer hears it arrive
 * (`startCardAnswers`) and takes the first one in log order.
 */

/**
 * The person's answer to a card, given on this device. On the card's own
 * computer it is taken at once, after any answer another device gave
 * first, which wins; the call settles once the grant is made and, on macOS,
 * once the system lets the app in. Elsewhere it is recorded for that
 * computer to take, and refused for a card only its screen can answer.
 */
export async function answerAsk(
  chatId: ChatId,
  askId: string,
  decision: CardDecision,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const open = await openCard(chatId, askId);
  if (!open) {
    throw new ORPCError("NOT_FOUND", {
      message: "That request was already answered.",
    });
  }
  const { answer, card } = open;
  if (card.device !== thisDevice()) {
    if (!answerableElsewhere(card, answer !== undefined)) {
      throw new ORPCError(answer ? "CONFLICT" : "BAD_REQUEST", {
        message: answer
          ? "That request was already answered."
          : `That request needs answering on ${await computerName(card.device)}.`,
      });
    }
    await answerCard(chatId, askId, decision);
    return;
  }
  // A card that took its answer is being acted on, or waits on the system
  // now; the person's no still closes it.
  if (answer?.taken && (decision === "declined" || card.status !== "open")) {
    if (decision !== "declined") {
      throw new ORPCError("BAD_REQUEST", {
        message: "That request is waiting on the system.",
      });
    }
    await decline(chatId, card, workspaceRef);
    return;
  }
  if (!answer) {
    await answerCard(chatId, askId, decision);
  }
  await takeCardAnswers(chatId, workspaceRef);
  // Whichever pass took the card's answer, this one or the watcher's that
  // heard the write, the call settles with it, and fails with it.
  await acting.get(actingKey(chatId, askId));
}

/** The answers each chat is taking, one look at a time. */
const taking = createWriteQueue();

/**
 * What acting on each card's taken answer came to, by chat and card: under
 * way, or settled a moment ago, so a caller that did not start it can
 * still wait for it and hear how it went.
 */
const acting = new Map<string, Promise<void>>();

/** The cards being acted on in this process, which no other pass starts again. */
const inFlight = new Set<string>();

/** How long a settled outcome stays for a caller that comes to it late. */
const OUTCOME_KEPT_MS = 60_000;

function actingKey(chatId: ChatId, askId: string): string {
  return `${chatId}/${askId}`;
}

/**
 * Whether a card of this computer's has an answer to act on: one given and
 * not taken yet, or one taken whose acting never finished (the app quit,
 * or crashed, between noting it and settling), while the card still waits
 * on that answer rather than on the system. Acting again is safe: a grant
 * is kept as it is, and a closed card wakes nobody twice.
 */
function isDue({ answer, card }: OpenCard, chatId: ChatId): boolean {
  if (card.device !== thisDevice() || answer === undefined) {
    return false;
  }
  return (
    !answer.taken ||
    (card.status === "open" && !inFlight.has(actingKey(chatId, card.id)))
  );
}

/**
 * Takes the answers given to this computer's cards in the chat, from any
 * device, that it has not acted on yet: the first in log order for each,
 * noted on the card, then granted or declined and its askers woken. A
 * taken answer whose acting never finished is acted on again. The Stops
 * other devices made are written into the cards first, so a stopped
 * session is not woken. An answer that cannot be carried out is given up
 * on (`failAnswer`), which leaves the card up to be answered again.
 * Resolves once every answer taken has settled, and fails with the first
 * that could not be carried out.
 */
export async function takeCardAnswers(
  chatId: ChatId,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const started = await taking(chatId, async () => {
    await takeStops(chatId);
    const due = (await openCards(chatId)).filter((open) => isDue(open, chatId));
    const acts: Promise<void>[] = [];
    for (const { answer, card } of due) {
      if (!answer) {
        continue;
      }
      const took = answer.taken
        ? card
        : await takeAnswer(chatId, card.id, {
            at: answer.at,
            decision: answer.decision,
            device: answer.device,
          });
      if (took) {
        acts.push(startActing(chatId, took, answer.decision, workspaceRef));
      }
    }
    return acts;
  });
  await Promise.all(started);
}

/** Acts on a card's taken answer, kept where any caller can wait for it. */
function startActing(
  chatId: ChatId,
  card: PermissionCard,
  decision: CardDecision,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const key = actingKey(chatId, card.id);
  inFlight.add(key);
  const outcome = act(chatId, card, decision, workspaceRef)
    .catch(async (error: unknown) => {
      await failAnswer(
        chatId,
        card.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    })
    .finally(() => {
      inFlight.delete(key);
      setTimeout(() => {
        if (acting.get(key) === outcome) {
          acting.delete(key);
        }
      }, OUTCOME_KEPT_MS).unref();
    });
  // Kept for a caller that comes late; its failure is that caller's to hear.
  outcome.catch(() => undefined);
  acting.set(key, outcome);
  return outcome;
}

/** Does what the answer a card took says. */
async function act(
  chatId: ChatId,
  card: PermissionCard,
  decision: CardDecision,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  if (decision === "declined") {
    await decline(chatId, card, workspaceRef);
    return;
  }
  if (card.kind === "tab") {
    await moveTabIn(chatId, card, workspaceRef);
    return;
  }
  await grant(chatId, card, decision);
  await settle(chatId, card, decision, workspaceRef);
}

/**
 * Takes the answers other devices give this computer's cards as they
 * arrive, and those given while it was off once it starts: a chat whose
 * records moved is looked at again, and acting on an answer starts no turn
 * of its own beyond waking the sessions that asked.
 */
export function startCardAnswers(workspaceRef: WorkspaceActorRef): void {
  const take = (chatId: ChatId) => {
    takeCardAnswers(chatId, workspaceRef).catch(
      getWorkspaceConfig().captureException,
    );
  };
  publisher.subscribe("record.changed", ({ id, kind }) => {
    if (kind === "session") {
      take(id);
    }
  });
  void (async () => {
    for (const chatId of listChatIds()) {
      try {
        if ((await chatOpenCards(chatId)).some((open) => isDue(open, chatId))) {
          take(chatId);
        }
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/** Closes a card with a no, which the chat keeps, and wakes its askers with it. */
async function decline(
  chatId: ChatId,
  ask: PermissionCard,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  // A check still looking inside finds the card gone and wakes nobody.
  const closed = await closeAsk(chatId, ask.id);
  if (!closed) {
    return;
  }
  // A tab kept is the person's to keep; asking again later is no worse for it.
  if (ask.kind !== "tab") {
    await setDenied(chatId, ask.kind, ask.target, true);
  }
  await wakeAskers(
    {
      data: {
        answer: "declined",
        kind: ask.kind,
        ...(ask.page && { page: ask.page }),
        target: ask.target,
      },
      type: "data-permissionAnswer",
    },
    workspaceRef,
    chatId,
    closed.askers.map((asker) => asker.sessionId),
  );
}

/**
 * Moves the tab a card asked for out of the person's own tabs and into the
 * chat, page and all, and wakes the askers. The first to ask drives it, as
 * a tab handed over: the person's, never closed by the agent. A tab closed
 * before the answer wakes them with that instead.
 */
async function moveTabIn(
  chatId: ChatId,
  ask: PermissionCard,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const closed = await closeAsk(chatId, ask.id);
  if (!closed) {
    return;
  }
  const took = await askWindow({
    action: { kind: "take", tabId: ask.target },
    askedBy: chatId,
    group: chatId,
  });
  const tabId = parseBrowserTargetId(ask.target);
  const driver = closed.askers[0]?.sessionId;
  const moved =
    took !== undefined && took.error === undefined && tabId !== null;
  if (moved && driver !== undefined) {
    await updateHeldTabs(chatId, driver, (tabs) => [
      ...tabs.filter((tab) => tab.id !== tabId),
      { id: tabId, inWindow: true, openedBy: "handed" },
    ]);
  }
  await wakeAskers(
    {
      data: {
        answer: moved ? "allowed" : "gone",
        kind: "tab",
        ...(ask.page && { page: ask.page }),
        target: ask.target,
      },
      type: "data-permissionAnswer",
    },
    workspaceRef,
    chatId,
    closed.askers.map((asker) => asker.sessionId),
  );
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
  ask: PermissionCard,
  decision: "allowed" | "always",
): Promise<void> {
  const { kind, target } = ask;
  // A tab is moved, never granted (`moveTabIn`).
  if (kind === "tab") {
    return;
  }
  await setDenied(chatId, kind, target, false);
  if (kind === "folder") {
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

/** The look inside running for each ask, so an Allow from another window joins it. */
const settling = new Map<string, Promise<void>>();

/**
 * Closes an allowed ask and wakes its askers, once macOS lets the app into
 * the folder or the app: asking waits as long as the system's own prompt is
 * up, and the card says macOS is asking meanwhile. One macOS refuses stays
 * open, keeping the yes. Off macOS nothing is asked.
 *
 * An asker whose own command waits on the folder (`waits`) is never woken:
 * the command carries on by itself once macOS answers, and wakes its
 * session when it ends. So a card a command raised goes quietly when its
 * look gets in, whatever was on screen meanwhile.
 */
export function settle(
  chatId: ChatId,
  ask: PermissionCard,
  decision: "allowed" | "always",
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const running = settling.get(ask.id);
  if (running) {
    return running;
  }
  const settled = (async () => {
    const kept = await macosKeepsOut(ask, () =>
      setMacosStatus(chatId, ask.id, "macos-asking", decision),
    );
    if (kept !== undefined) {
      await setMacosStatus(chatId, ask.id, kept, decision);
      return;
    }
    const closed = await closeAsk(chatId, ask.id);
    const woken = closed?.askers.filter((asker) => asker.waits !== true);
    if (!woken?.length) {
      return;
    }
    await wakeAskers(
      {
        data: {
          answer: decision,
          kind: ask.kind,
          target: ask.target,
          ...(ask.status === "windows-blocked" && {
            through: "windows-protection" as const,
          }),
          // One of the Mac's own apps is connected for every chat, so a card
          // about one only ever stood for macOS's prompt.
          ...(ask.kind === "app" &&
            (ask.status === "macos-asking" ||
              ask.status === "macos-refused") && {
              through: "macos" as const,
            }),
        },
        type: "data-permissionAnswer",
      },
      workspaceRef,
      chatId,
      woken.map((asker) => asker.sessionId),
    );
  })().finally(() => {
    settling.delete(ask.id);
  });
  settling.set(ask.id, settled);
  return settled;
}

/**
 * How macOS keeps the app from what `ask` is for, once the person said
 * yes: the card's status, or undefined when it lets the app in (or off
 * macOS). A folder is looked inside, and an app asked of macOS, which raises
 * the system's prompt nobody has answered yet; `onAsking` runs once when
 * that prompt is on screen while the answer waits.
 */
async function macosKeepsOut(
  ask: PermissionCard,
  onAsking: () => Promise<void>,
): Promise<Exclude<MacosAskStatus, "macos-asking"> | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (ask.kind === "folder") {
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
