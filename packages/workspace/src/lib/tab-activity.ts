import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { type BrowserTargetId } from "../types";
import { getWorkspaceConfig } from "./workspace-config";

/** A session's last command in a tab. */
export interface TabAct {
  at: number;
  chatId: ChatId;
  sessionId: StoreId.Session;
}

/** What a session is owed word of in one tab: who else acted there since its last command, and when. */
export interface TabNews {
  /** The other sessions, each at its latest command, newest first. */
  agents: TabAct[];
  /** When the person last clicked, tapped or typed in it, when that was after this session's last command. */
  personAt?: number;
  targetId: BrowserTargetId;
}

/**
 * How far back a session's first command in a tab hears of the others: long
 * enough to catch one at work in it, short enough to leave out who finished
 * with it earlier.
 */
const FIRST_LOOK_MS = 2 * 60_000;

/** How many tabs' acts are kept; the oldest tabs go first past it. */
const KEPT = 256;

/** Every session's last command in each tab, since launch. */
const actsByTab = new Map<BrowserTargetId, Map<StoreId.Session, TabAct>>();

/** Per session, the news it has not been told yet, by tab. */
const owed = new Map<StoreId.Session, Map<BrowserTargetId, TabNews>>();

/**
 * A session of a chat sent a tab a command. Every session of a chat drives
 * every tab of it, so what this one missed there since its last command (the
 * others' commands, the person's input) is kept for its next result.
 */
export function noteTabCommand(
  targetId: BrowserTargetId,
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  now: number = Date.now(),
): void {
  let acts = actsByTab.get(targetId);
  if (!acts) {
    acts = new Map();
    actsByTab.set(targetId, acts);
    for (const oldest of actsByTab.keys()) {
      if (actsByTab.size <= KEPT) {
        break;
      }
      actsByTab.delete(oldest);
    }
  }
  const mine = acts.get(sessionId)?.at;
  const since = mine ?? now - FIRST_LOOK_MS;
  const agents = [...acts.values()].filter(
    (act) => act.sessionId !== sessionId && act.at > since,
  );
  const input =
    mine === undefined
      ? undefined
      : getWorkspaceConfig().browser.personInputAt(targetId);
  const personAt =
    input !== undefined && mine !== undefined && input > mine
      ? input
      : undefined;
  acts.set(sessionId, { at: now, chatId, sessionId });
  if (agents.length === 0 && personAt === undefined) {
    return;
  }
  let news = owed.get(sessionId);
  if (!news) {
    news = new Map();
    owed.set(sessionId, news);
  }
  const before = news.get(targetId);
  const byAgent = new Map(
    [...(before?.agents ?? []), ...agents].map((act) => [act.sessionId, act]),
  );
  const latestPerson = Math.max(before?.personAt ?? 0, personAt ?? 0);
  news.set(targetId, {
    agents: [...byAgent.values()].toSorted((a, b) => b.at - a.at),
    ...(latestPerson > 0 ? { personAt: latestPerson } : {}),
    targetId,
  });
}

/** What the session has not been told of the tabs it drove, taken: each piece is told once. */
export function takeTabNews(sessionId: StoreId.Session): TabNews[] {
  const news = owed.get(sessionId);
  owed.delete(sessionId);
  return news ? [...news.values()] : [];
}

/** The sessions that have sent a tab commands since launch, the latest first. */
export function actsIn(targetId: BrowserTargetId): TabAct[] {
  return [...(actsByTab.get(targetId)?.values() ?? [])].toSorted(
    (a, b) => b.at - a.at,
  );
}

/** When a session last sent a tab a command, or nothing when it never has since launch. */
export function lastActOf(
  targetId: BrowserTargetId,
  sessionId: StoreId.Session,
): number | undefined {
  return actsByTab.get(targetId)?.get(sessionId)?.at;
}

/** The tabs a session has sent commands since launch, the latest first. */
export function tabsActedInBy(sessionId: StoreId.Session): BrowserTargetId[] {
  return [...actsByTab.entries()]
    .flatMap(([targetId, acts]) => {
      const act = acts.get(sessionId);
      return act ? [{ at: act.at, targetId }] : [];
    })
    .toSorted((a, b) => b.at - a.at)
    .map(({ targetId }) => targetId);
}

/** Each open bridge connection's way to tell its agent of a tab, by its chat and session. */
const announcers = new Map<string, Set<(tabId: string) => Promise<boolean>>>();

/** Lets a session's bridge connection be asked to announce a tab (`announceChatTab`); returns the way to stop. */
export function registerTabAnnouncer(
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  announce: (tabId: string) => Promise<boolean>,
): () => void {
  const key = `${chatId}/${sessionId}`;
  const set = announcers.get(key) ?? new Set();
  set.add(announce);
  announcers.set(key, set);
  return () => {
    set.delete(announce);
    if (set.size === 0 && announcers.get(key) === set) {
      announcers.delete(key);
    }
  };
}

/**
 * Tells the session's agent-browser of a tab of the chat it has not heard of
 * yet (one the person or another session opened since it connected), so
 * `agent-browser tab <id>` finds it. False when no connection of the
 * session's is open or the tab is none of the chat's.
 */
export async function announceChatTab(
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  tabId: string,
): Promise<boolean> {
  const told = await Promise.all(
    [...(announcers.get(`${chatId}/${sessionId}`) ?? [])].map((announce) =>
      announce(tabId),
    ),
  );
  return told.includes(true);
}

/** A tab a page opened for itself (its `window.open`), as the window made it. */
export interface PageOpenedTab {
  tabId: string;
  url: string;
}

/** Per tab, the tabs its page opened that no session has been told of yet. */
const openedByPage = new Map<BrowserTargetId, PageOpenedTab[]>();

/**
 * A page an agent drives asked for a window of its own (`window.open`), which
 * the app opens as a tab of the chat behind whatever is up: kept for the
 * result of the command that caused it, which says so.
 */
export function notePageOpenedTab(
  targetId: BrowserTargetId,
  opened: PageOpenedTab,
): void {
  openedByPage.set(targetId, [...(openedByPage.get(targetId) ?? []), opened]);
}

/** The tabs the pages in `targetIds` opened since they were last taken. */
export function takePageOpenedTabs(
  targetIds: readonly BrowserTargetId[],
): (PageOpenedTab & { from: BrowserTargetId })[] {
  return targetIds.flatMap((from) => {
    const opened = openedByPage.get(from) ?? [];
    openedByPage.delete(from);
    return opened.map((tab) => ({ ...tab, from }));
  });
}
