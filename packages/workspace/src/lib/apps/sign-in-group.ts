import { unique } from "radashi";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type Stopper } from "../../schemas/stop-notice";
import { type StoreId } from "../../schemas/store-id";
import { askedOnCard, connectAppResults } from "../../tools/connect-app-output";
import { ChatReads } from "../chat-reads";
import { sessionOfChat } from "../record-folders";
import { signInsSettled } from "../sign-in-progress-model-text";
import { isTypedByUser } from "../typed-by-user";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppConnection, readConnection } from "./connection";
import { loadApp } from "./store";

type SignInProgress = SessionMessageDataPart.SignInProgress;

/** An app with a row on a sign-in card. */
interface CardApp {
  name: string;
  slug: string;
}

/** A sign-in card in a session's history. */
interface SignInCard {
  apps: CardApp[];
  /** When its call put it up. */
  askedAt: Date;
  /** The apps its call named that could not be asked, with why. */
  notOnCard: SessionMessageDataPart.NotOnCard | undefined;
  /**
   * Whether the session was already woken with the card settled, after which
   * an answer on it is news of its own rather than the card's.
   */
  toldSettled: boolean;
}

/**
 * The sign-in cards in a session's history, oldest first: each `connect_app`
 * call's apps that needed the user. An app asked for again on a later card
 * belongs to that one, so it leaves the earlier card's rows.
 */
function signInCardsIn(messages: SessionMessage.WithParts[]): SignInCard[] {
  const cards: SignInCard[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "data-appEvent" &&
        part.data.signIns !== undefined &&
        signInsSettled(part.data.signIns)
      ) {
        const told = new Set(part.data.signIns.map((app) => app.slug));
        for (const card of cards) {
          if (card.apps.some((app) => told.has(app.slug))) {
            card.toldSettled = true;
          }
        }
        continue;
      }
      if (
        part.type !== "tool-connect_app" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const rows = askedOnCard(part.output).map(({ name, slug }) => ({
        name,
        slug,
      }));
      if (rows.length === 0) {
        continue;
      }
      const asked = new Set(rows.map((row) => row.slug));
      for (const card of cards) {
        card.apps = card.apps.filter((app) => !asked.has(app.slug));
        // One that made it onto a later card is that card's to report.
        const still = card.notOnCard?.filter((app) => !asked.has(app.slug));
        card.notOnCard = still?.length ? still : undefined;
      }
      const failed = connectAppResults(part.output).flatMap((result) =>
        result.state === "failure"
          ? [{ reason: result.message, slug: result.slug }]
          : [],
      );
      cards.push({
        apps: rows,
        askedAt: part.metadata.createdAt,
        notOnCard: failed.length === 0 ? undefined : failed,
        toldSettled: false,
      });
    }
  }
  return cards.filter((card) => card.apps.length > 0);
}

/**
 * The sign-in cards asked since the person last wrote or stopped the chat,
 * oldest first. One they moved past is theirs to come back to, not one the
 * chat waits on, as with an open question (`openQuestionsIn`).
 */
export function signInCardsSinceTyped(
  messages: SessionMessage.WithParts[],
  stop: { at: Date; by: Stopper } | undefined,
): { apps: CardApp[]; askedAt: number }[] {
  const typed = messages.findLast(
    (message) => message.role === "user" && isTypedByUser(message),
  );
  const since = Math.max(
    typed?.metadata.createdAt.getTime() ?? 0,
    stop?.by === "person" ? stop.at.getTime() : 0,
  );
  return signInCardsIn(messages).flatMap((card) =>
    card.askedAt.getTime() > since
      ? [{ apps: card.apps, askedAt: card.askedAt.getTime() }]
      : [],
  );
}

/**
 * The apps on those cards still waiting on the user, by name, with when the
 * newest card naming one was asked; undefined when none waits.
 */
export async function signInsWaiting(
  cards: { apps: CardApp[]; askedAt: number }[],
): Promise<{ at: number; names: string[] } | undefined> {
  let at: number | undefined;
  const names: string[] = [];
  for (const card of cards) {
    const waiting = (await signInProgress(card.apps))?.filter(
      (row) => row.standing === "waiting",
    );
    if (waiting?.length) {
      at = card.askedAt;
      names.push(...waiting.map((row) => row.name));
    }
  }
  return at === undefined ? undefined : { at, names: unique(names) };
}

/** The card in a session's history that `slug` has its row on, if any. */
export function signInCardOf(
  messages: SessionMessage.WithParts[],
  slug: string,
): SignInCard | undefined {
  return signInCardsIn(messages).find((card) =>
    card.apps.some((app) => app.slug === slug),
  );
}

/** How an app's connection reads on its card's row. */
function standingOf(
  connection: AppConnection,
): SignInProgress[number]["standing"] {
  switch (connection.status) {
    case "connected":
    case "declined":
    case "failed": {
      return connection.status;
    }
    case "needs-approval":
    case "needs-key":
    case "needs-sign-in": {
      return "waiting";
    }
  }
}

/**
 * Every app on a card as its connection now stands, in the card's order. An
 * app whose folder or connection is gone since the card asked has no row
 * left to answer, so it is left out; undefined when none is left.
 */
export async function signInProgress(
  card: CardApp[],
): Promise<SignInProgress | undefined> {
  const { appsDir } = getWorkspaceConfig();
  const rows = await Promise.all(
    card.map(async ({ slug }) => {
      const [connection, loaded] = await Promise.all([
        readConnection(slug),
        loadApp(appsDir, slug),
      ]);
      if (connection === undefined || loaded.isErr()) {
        return [];
      }
      const standing = standingOf(connection);
      const account =
        standing === "connected"
          ? (connection.account ?? loaded.value.manifest.account)
          : undefined;
      return [
        {
          ...(account === undefined ? {} : { account }),
          name: loaded.value.name,
          slug,
          standing,
        },
      ];
    }),
  );
  const progress = rows.flat();
  return progress.length === 0 ? undefined : progress;
}

/**
 * The apps on a session's sign-in cards that still wait on the user, each
 * card whole, for a note that wakes the session about something else.
 * Undefined when every card is settled.
 */
async function openSignIns(
  messages: SessionMessage.WithParts[],
): Promise<SignInProgress | undefined> {
  const open: SignInProgress[number][] = [];
  for (const card of signInCardsIn(messages)) {
    const progress = await signInProgress(card.apps);
    if (progress !== undefined && !signInsSettled(progress)) {
      open.push(...progress);
    }
  }
  return open.length === 0 ? undefined : open;
}

/**
 * The open sign-ins of a session that asks on the chat's behalf
 * (`openSignIns`): only the chat's own session puts up a sign-in card.
 */
export async function openSignInsOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<SignInProgress | undefined> {
  if (sessionOfChat(chatId) !== sessionId) {
    return undefined;
  }
  const history = await ChatReads.history({ chatId, sessionId });
  return history.isOk() ? openSignIns(history.value) : undefined;
}
