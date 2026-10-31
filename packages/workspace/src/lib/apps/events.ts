import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { thisDevice } from "../chat/asks";
import { listChatIds } from "../chat/chat-records";
import { chatAskStatesOf } from "../chat/chats";
import { driveAsks, refreshSignIn } from "../chat/drive-asks";
import { getWorkspaceConfig } from "../workspace-config";

type AppEventLine = SessionMessageDataPart.AppEventDataPart["events"][number];

/**
 * Carries what the person does about an app outside the conversation (a
 * sign-in finished in the browser, a key saved on a card, a decline, a
 * failure) to the sign-in cards of this computer's that have the app on a
 * row: each card's rows are written as they now stand, and the card
 * settles once no app on it waits, which wakes its chat once with every app
 * on it (`refreshSignIn`, `drive-asks.ts`). A sign-in that did not connect
 * wakes the chat at once with the card as it stands. The host app
 * publishes the event; signing in happens on this computer alone, where
 * its connections and keys are.
 *
 * A card the person moved past, by writing in the chat or stopping it, no
 * longer waits; an answer on its row raises a card of that one app again
 * (`waitInChat`). Connecting an app from Settings, which no card asked for,
 * wakes nobody, and neither does a disconnect or a removal, which each
 * chat hears of on the next message the person writes there.
 */
export function startAppEvents(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const event of publisher.subscribe("app.event")) {
      if (event.event === "disconnected" || event.event === "removed") {
        continue;
      }
      try {
        await settleSignIns(event, workspaceRef);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/** Brings every card of this computer's with the event's app on a row up to date with it. */
async function settleSignIns(
  event: AppEventLine,
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  for (const chatId of listChatIds()) {
    const cards = (await chatAskStatesOf(chatId)).filter(
      ({ ask, live }) =>
        live &&
        ask.kind === "sign-in" &&
        ask.device === thisDevice() &&
        ask.apps.some((app) => app.slug === event.slug),
    );
    for (const { ask } of cards) {
      await refreshSignIn(chatId, ask.id, event, workspaceRef);
    }
    if (cards.length > 0) {
      await driveAsks(chatId, workspaceRef);
    }
  }
}
