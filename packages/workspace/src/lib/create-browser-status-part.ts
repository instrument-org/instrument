import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type BrowserTargetId } from "../types";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { BLANK_PAGE_URL } from "./browser-state";
import { agentSpellingOfFileUrls } from "./local-page-address";
import { sessionLayout } from "./session-layout";
import { chatPageTabs, takeClosedTabs } from "./chat/chat-tabs";
import { getChatState } from "./chat-record";
import { chatDir } from "./record-folders";
import { tabLifetime } from "../machines/window-browser";
import { getWorkspaceConfig } from "./workspace-config";

export async function createBrowserStatusPart({
  createdAt,
  messageId,
  sessionId,
  chatId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    // The model hears a page on this computer by its own path for it, never
    // by where the file sits on the person's disk.
    const layout = await sessionLayout({ chatId, sessionId });
    const spell = (url: string) => agentSpellingOfFileUrls(url, layout);
    const held = await chatTabsStatus(chatId, spell);
    if (held === null) {
      return undefined;
    }
    const closed = (await takeClosedTabs(chatId, sessionId)).map(
      ({ id, reason, title, url }) => ({
        id,
        reason,
        ...(title ? { title } : {}),
        url: spell(url),
      }),
    );
    return createPart({
      createdAt,
      data: {
        ...(closed.length > 0 ? { closed } : {}),
        status: "tabs",
        tabs: held,
      },
      messageId,
      sessionId,
    });
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

function createPart({
  createdAt,
  data,
  messageId,
  sessionId,
}: {
  createdAt: Date;
  data: Extract<
    SessionMessagePart.Type,
    { type: "data-browserStatus" }
  >["data"];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}): SessionMessagePart.Type {
  return {
    data,
    metadata: {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    type: "data-browserStatus",
  };
}

/**
 * The chat's tabs, every session's to drive, as the session names them: one
 * whose page is unloaded too, by the title and address the window keeps for
 * it. Null where there is no window (the eval harness): a
 * session browses in a browser of its own there, so there is nothing true
 * to tell it.
 */
async function chatTabsStatus(
  chatId: ChatId,
  spell: (url: string) => string,
): Promise<null | SessionMessageDataPart.BrowserStatusDataPart["tabs"]> {
  const { browser } = getWorkspaceConfig();
  if (browser.hasNoWindow) {
    return null;
  }
  // With no page up anywhere there is no window to ask.
  const windowTargets = await browser.listTargets();
  if (windowTargets.length === 0) {
    return [];
  }
  const titles = new Map(
    windowTargets.map((target) => [target.id, target.title]),
  );
  const [listed, { openedTabs }] = await Promise.all([
    chatPageTabs(chatId),
    getChatState(chatDir(chatId)),
  ]);
  return (listed ?? []).map((tab) => {
    const { targetId } = tab;
    const loaded = browser.getTargetMeta(targetId) !== null;
    const url = loaded ? browser.getTargetAddress(targetId) : tab.url;
    const title = loaded ? titles.get(targetId) : tab.title;
    return {
      id: targetId,
      ...(openedTabs.some((opened) => opened.id === targetId)
        ? { openedBy: "task" as const }
        : {}),
      ...(title ? { title } : {}),
      url: spell(url || BLANK_PAGE_URL),
      ...(loaded ? tabStanding(targetId) : { unloaded: true }),
    };
  });
}

/**
 * Where a tab stands and what it costs, coarse enough that the note reads
 * the same from turn to turn while nothing much changes: memory to 100 MB,
 * CPU to 10 percent and none under 10. How long until an unused page
 * unloads is left out, since it changes with every minute that passes.
 */
function tabStanding(targetId: BrowserTargetId) {
  const { browser } = getWorkspaceConfig();
  const life = tabLifetime(targetId);
  const cost = browser.guestCost(targetId);
  const cpu = cost ? Math.round(cost.cpuPercent / 10) * 10 : 0;
  return {
    ...(life ? { onScreen: life.drawn } : {}),
    ...(browser.isGuestAsleep(targetId) ? { asleep: true } : {}),
    ...(cost
      ? { memoryMb: Math.max(100, Math.round(cost.memoryBytes / 1e8) * 100) }
      : {}),
    ...(cpu >= 10 ? { cpuPercent: cpu } : {}),
    ...(cost && cost.sharedWith.length > 0
      ? { sharedWith: cost.sharedWith }
      : {}),
  };
}
