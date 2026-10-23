import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type BrowserTargetId } from "../types";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { BLANK_PAGE_URL } from "./browser-state";
import { agentSpellingOfFileUrls } from "./local-page-address";
import { sessionLayout } from "./session-layout";
import { heldTabs, takeClosedTabs } from "./held-tabs";
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
    const held = await heldTabsStatus({ sessionId, chatId }, spell);
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
 * The tabs of its chat a task holds, open ones only, as the task names them.
 * Null where there is no window (the eval harness): a task browses in a
 * browser of its own there whatever it holds, so there is nothing true to
 * tell it.
 */
async function heldTabsStatus(
  { sessionId, chatId }: { sessionId: StoreId.Session; chatId: ChatId },
  spell: (url: string) => string,
): Promise<null | SessionMessageDataPart.BrowserStatusDataPart["tabs"]> {
  const { browser } = getWorkspaceConfig();
  if (browser.hasNoWindow) {
    return null;
  }
  const held = await heldTabs(chatId, sessionId);
  if (held.length === 0) {
    return [];
  }
  const windowTargets = await browser.listTargets();
  const titles = new Map(
    windowTargets.map((target) => [target.id, target.title]),
  );
  return held.flatMap((tab) => {
    const url = browser.getTargetUrl(tab.id);
    if (!browser.getTargetMeta(tab.id)) {
      return [];
    }
    const title = titles.get(tab.id);
    return [
      {
        id: tab.id,
        openedBy: tab.openedBy,
        ...(title ? { title } : {}),
        url: spell(url ?? BLANK_PAGE_URL),
        ...tabStanding(tab.id),
      },
    ];
  });
}

/**
 * Where a tab stands and what it costs, coarse enough that the note reads
 * the same from turn to turn while nothing much changes: memory to 10 MB,
 * CPU to a whole percent and none under one, the time left to five minutes.
 */
function tabStanding(targetId: BrowserTargetId) {
  const { browser } = getWorkspaceConfig();
  const life = tabLifetime(targetId);
  const cost = browser.guestCost(targetId);
  const cpu = cost ? Math.round(cost.cpuPercent) : 0;
  return {
    ...(life ? { onScreen: life.drawn } : {}),
    ...(browser.isGuestAsleep(targetId) ? { asleep: true } : {}),
    ...(cost
      ? { memoryMb: Math.max(10, Math.round(cost.memoryBytes / 1e7) * 10) }
      : {}),
    ...(cpu >= 1 ? { cpuPercent: cpu } : {}),
    ...(cost && cost.sharedWith.length > 0
      ? { sharedWith: cost.sharedWith }
      : {}),
    ...(life?.unloadsInMs != null
      ? { unloadsInMin: Math.max(5, Math.ceil(life.unloadsInMs / 300_000) * 5) }
      : {}),
  };
}
