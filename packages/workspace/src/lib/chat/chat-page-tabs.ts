import { type ChatId } from "../../schemas/chat-id";
import { type WindowTabAnswer } from "../../schemas/window-tab";
import { type BrowserTargetId, parseBrowserTargetId } from "../../types";
import { resolveChat } from "../record-folders";
import { noteTabPages } from "../tab-activity";
import { askWindow } from "./window-tab";

/**
 * A page tab of the chat's, as the window lists it: by the id agents name it
 * by (`id`) and the page an agent drives in it (`targetId`), which differ
 * for a tab on an HTML file.
 */
export type ChatPageTab = NonNullable<WindowTabAnswer["pages"]>[number] & {
  targetId: BrowserTargetId;
};

/**
 * The chat's page tabs, as the window has them now, in the strip's order:
 * every one is every session's to see and drive. Undefined when no window
 * answered.
 */
export async function chatPageTabs(
  chatId: ChatId,
): Promise<ChatPageTab[] | undefined> {
  return (await chatTabs(chatId))?.pages;
}

/** The chat's tabs as the window lists them (`chatTabs`). */
export interface ChatTabs {
  /** The tabs of the chat's group up on a side while the window shows the group. */
  onScreen: Set<string>;
  pages: ChatPageTab[];
  /** Every tab of the chat's group, a tab on a file no page draws among them. */
  standing: Set<string>;
}

/**
 * The chat's page tabs (`chatPageTabs`), and every tab in the chat's own tab
 * group, the one the pages are listed from. Undefined when no window
 * answered.
 */
export async function chatTabs(chatId: ChatId): Promise<ChatTabs | undefined> {
  const answer = await askWindow({
    action: { kind: "list" },
    askedBy: chatId,
    group: resolveChat(chatId),
  });
  if (!answer?.pages) {
    return undefined;
  }
  const pages = answer.pages.flatMap((tab) => {
    const targetId = parseBrowserTargetId(tab.targetId ?? tab.id);
    return targetId === null ? [] : [{ ...tab, targetId }];
  });
  noteTabPages(pages);
  const standing = new Set<string>(pages.map((tab) => tab.id));
  // The chat's group is the one with the chat's own tab in it.
  const own = (answer.windows ?? [])
    .flatMap((window) => window.groups)
    .find((group) =>
      group.sides.some((side) => side.tabs.some((tab) => tab.isThisChat)),
    );
  const onScreen = new Set<string>();
  for (const tab of own?.sides.flatMap((side) => side.tabs) ?? []) {
    standing.add(tab.id);
    if (tab.isUp === true && own?.isShown !== false) {
      onScreen.add(tab.id);
    }
  }
  return { onScreen, pages, standing };
}

/**
 * The tab an id names among the chat's page tabs: by the id agents name it
 * by, else by its page's id, which earlier builds named a tab on an HTML
 * file by.
 */
export function pageTabNamed(
  tabs: readonly ChatPageTab[] | undefined,
  id: string,
): ChatPageTab | undefined {
  return (
    tabs?.find((tab) => tab.id === id) ??
    tabs?.find((tab) => tab.targetId === id)
  );
}

/**
 * The id agents name the tab a page draws by: the tab's, for a page the
 * window lists, else the page's own.
 */
export function agentTabIdOf(
  tabs: readonly ChatPageTab[] | undefined,
  targetId: string,
): string {
  return tabs?.find((tab) => tab.targetId === targetId)?.id ?? targetId;
}

/**
 * The id agents name a tab an agent opened by, from its entry in the chat's
 * state: the tab's, or, for an entry an earlier build kept by its page's
 * id, the tab that page draws.
 */
export function openedTabId(
  tabs: readonly ChatPageTab[] | undefined,
  id: string,
): string {
  return pageTabNamed(tabs, id)?.id ?? id;
}
