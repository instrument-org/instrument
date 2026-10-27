import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type StoreId } from "../../schemas/store-id";
import { askedOnCard } from "../../tools/connect-app-output";
import { ChatReads } from "../chat-reads";
import { sessionOfChat } from "../record-folders";
import { signInsSettled } from "../sign-in-progress-model-text";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppConnection, readConnection } from "./connection";
import { loadApp } from "./store";

type SignInProgress = SessionMessageDataPart.SignInProgress;

/** An app with a row on a sign-in card. */
interface CardApp {
  name: string;
  slug: string;
}

/**
 * The sign-in cards in a session's history, oldest first: each `connect_app`
 * call's apps that needed the user. An app asked for again on a later card
 * belongs to that one, so it leaves the earlier card's rows.
 */
function signInCardsIn(messages: SessionMessage.WithParts[]): CardApp[][] {
  const cards: CardApp[][] = [];
  for (const message of messages) {
    for (const part of message.parts) {
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
      for (const [index, card] of cards.entries()) {
        cards[index] = card.filter((app) => !asked.has(app.slug));
      }
      cards.push(rows);
    }
  }
  return cards.filter((card) => card.length > 0);
}

/** The card in a session's history that `slug` has its row on, if any. */
export function signInCardOf(
  messages: SessionMessage.WithParts[],
  slug: string,
): CardApp[] | undefined {
  return signInCardsIn(messages).find((card) =>
    card.some((app) => app.slug === slug),
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
    const progress = await signInProgress(card);
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
