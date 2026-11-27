import { instrumentLinkOf } from "@instrument-org/shared";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { parseBrowserTargetId } from "../../types";
import { ChatWrites } from "../chat-writes";
import { linkTargetsIn } from "../link-targets";
import { getWorkspaceConfig } from "../workspace-config";
import { chatPageTabs, pageTabNamed } from "./chat-tabs";
import { liveTabTitles, tabPage } from "./tab-page";

/** The most tabs one reply's addresses are kept for. */
const MOST_TABS = 20;

type LinkedTab = SessionMessageDataPart.LinkedTabsDataPart["tabs"][number];

/**
 * Keeps the address of each web page whose tab the turn's reply linked, as
 * the window has it when the turn ends, on the reply (`data-linkedTabs`). The
 * agent names a tab only by its id; the address comes from the window, so
 * nothing the agent writes decides it. A tab on a local file or a screen of
 * the app's is left out, since its address means something only here.
 */
export async function keepTurnLinkedTabs({
  chatId,
  messages,
  sessionId,
}: {
  chatId: ChatId;
  messages: readonly SessionMessage.WithParts[];
  sessionId: StoreId.Session;
}): Promise<void> {
  const start = messages.findLastIndex((message) => message.role === "user");
  const turn = messages
    .slice(start + 1)
    .filter((message) => message.role === "assistant");
  const reply = turn.at(-1);
  if (
    reply === undefined ||
    reply.parts.some((part) => part.type === "data-linkedTabs")
  ) {
    return;
  }
  const text = turn
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? part.text : [])),
    )
    .join("\n\n");
  const ids = [
    ...new Set(
      linkTargetsIn(text).flatMap((target) => {
        const link = instrumentLinkOf(target);
        return link?.kind === "tab" ? link.name : [];
      }),
    ),
  ].slice(0, MOST_TABS);
  if (ids.length === 0) {
    return;
  }
  const tabs = await pagesOf(chatId, ids);
  if (tabs.length === 0) {
    return;
  }
  const saved = await ChatWrites.savePart(
    {
      data: { tabs },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: reply.id,
        sessionId,
      },
      type: "data-linkedTabs",
    },
    chatId,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
}

/** The web page each tab is on: from its live page, else from the window's list, for one unloaded. */
async function pagesOf(
  chatId: ChatId,
  ids: readonly string[],
): Promise<LinkedTab[]> {
  const { browser } = getWorkspaceConfig();
  const [titles, listed] = await Promise.all([
    liveTabTitles(browser),
    chatPageTabs(chatId),
  ]);
  return ids.flatMap((id) => {
    // The page the tab draws, which is the tab's own id but for a tab that
    // opened on an HTML file.
    const named = pageTabNamed(listed, id);
    const targetId = named?.targetId ?? parseBrowserTargetId(id);
    if (targetId === null) {
      return [];
    }
    const { title, url } = tabPage(browser, targetId, {
      listed: named,
      titles,
    });
    return url !== undefined && /^https?:/i.test(url)
      ? { id, ...(title ? { title } : {}), url }
      : [];
  });
}
