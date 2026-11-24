import { publisher } from "../rpc/publisher";
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

/** How many tabs' acts are kept; the tabs acted in longest ago go first past it. */
const KEPT = 256;

/** Every session's last command in each tab, since launch. */
const actsByTab = new Map<BrowserTargetId, Map<StoreId.Session, TabAct>>();

/**
 * The tabs each session sent commands in its turn running now: every page
 * that turn used, since it may go back to any of them. Emptied as the turn
 * ends (`session.done`).
 */
const turnTabs = new Map<StoreId.Session, Set<BrowserTargetId>>();

/** Whether `turnTabs` hears turns end yet; it starts with the first command. */
let hearingTurnEnds = false;

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
  // Moved to the end on every command, so the tabs dropped past `KEPT` are
  // the ones nobody has acted in for longest.
  const acts = actsByTab.get(targetId) ?? new Map<StoreId.Session, TabAct>();
  actsByTab.delete(targetId);
  actsByTab.set(targetId, acts);
  for (const oldest of actsByTab.keys()) {
    if (actsByTab.size <= KEPT) {
      break;
    }
    forgetTab(oldest);
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
  noteTurnTab(targetId, sessionId);
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

/** Keeps a tab among those the session's running turn used. */
function noteTurnTab(targetId: BrowserTargetId, sessionId: StoreId.Session) {
  const tabs = turnTabs.get(sessionId) ?? new Set<BrowserTargetId>();
  tabs.add(targetId);
  turnTabs.set(sessionId, tabs);
  if (hearingTurnEnds) {
    return;
  }
  hearingTurnEnds = true;
  publisher.subscribe("session.done", ({ sessionId: ended }) => {
    turnTabs.delete(ended);
  });
}

/** Whether the session sent the tab a command in the turn it is running now. */
export function usedThisTurn(
  targetId: BrowserTargetId,
  sessionId: StoreId.Session,
): boolean {
  return turnTabs.get(sessionId)?.has(targetId) === true;
}

/** The tab each session with commands in its running turn sent its latest one, of the tabs that turn used. */
export function latestTurnTabs(): (TabAct & { targetId: BrowserTargetId })[] {
  return [...turnTabs].flatMap(([sessionId, tabs]) => {
    const [latest] = [...tabs]
      .flatMap((targetId) => {
        const act = actsByTab.get(targetId)?.get(sessionId);
        return act ? [{ ...act, targetId }] : [];
      })
      .toSorted((a, b) => b.at - a.at);
    return latest ? [latest] : [];
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

/** Each open bridge connection's way to close a tab for its agent, by its chat and session. */
const closers = new Map<string, Set<(tabId: string) => Promise<boolean>>>();

/** Lets a session's bridge connection be asked to close a tab (`closeChatTab`); returns the way to stop. */
export function registerTabCloser(
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  close: (tabId: string) => Promise<boolean>,
): () => void {
  const key = `${chatId}/${sessionId}`;
  const set = closers.get(key) ?? new Set();
  set.add(close);
  closers.set(key, set);
  return () => {
    set.delete(close);
    if (set.size === 0 && closers.get(key) === set) {
      closers.delete(key);
    }
  };
}

/**
 * Closes a tab an agent opened for the session, in the window, and tells the
 * session's agent-browser it is gone: the way to close the only tab that
 * agent-browser has, which it refuses to close itself. False when no
 * connection of the session's is open, the tab is none of the chat's, or it
 * is the person's, which is left as it is.
 */
export async function closeChatTab(
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  tabId: string,
): Promise<boolean> {
  let closed = false;
  // One at a time: the first connection to close it leaves the others
  // nothing to close.
  for (const close of closers.get(`${chatId}/${sessionId}`) ?? []) {
    closed = (await close(tabId)) || closed;
  }
  return closed;
}

/**
 * Whether someone other than the session (another session, or the person)
 * acted in a tab after the session's last command there: a tab it should
 * not take up again unawares.
 */
export function takenOverFrom(
  targetId: BrowserTargetId,
  sessionId: StoreId.Session,
): boolean {
  const mine = lastActOf(targetId, sessionId);
  if (mine === undefined) {
    return false;
  }
  const person = getWorkspaceConfig().browser.personInputAt(targetId);
  return (
    (person !== undefined && person > mine) ||
    actsIn(targetId).some((act) => act.sessionId !== sessionId && act.at > mine)
  );
}

/** A tab a page opened for itself (its `window.open`), as the window made it. */
export interface PageOpenedTab {
  /** The tab whose page opened it. */
  from: BrowserTargetId;
  tabId: string;
  url: string;
}

/** Per session, the tabs pages it drove opened that it has not been told of. */
const popupsOwed = new Map<StoreId.Session, PageOpenedTab[]>();

/** Keeps a popup's tab for the next result of the session whose page opened it. */
export function owePopup(sessionId: StoreId.Session, tab: PageOpenedTab): void {
  popupsOwed.set(sessionId, [...(popupsOwed.get(sessionId) ?? []), tab]);
}

/** The popup tabs the session has not been told of, taken: each is told once. */
export function takePopups(sessionId: StoreId.Session): PageOpenedTab[] {
  const popups = popupsOwed.get(sessionId) ?? [];
  popupsOwed.delete(sessionId);
  return popups;
}

/** Forgets everything kept of a tab, as it closes. */
export function forgetTab(targetId: BrowserTargetId): void {
  actsByTab.delete(targetId);
  for (const tabs of turnTabs.values()) {
    tabs.delete(targetId);
  }
  for (const [sessionId, news] of owed) {
    news.delete(targetId);
    if (news.size === 0) {
      owed.delete(sessionId);
    }
  }
  for (const [sessionId, popups] of popupsOwed) {
    const kept = popups.filter(
      (tab) => tab.from !== targetId && tab.tabId !== targetId,
    );
    if (kept.length === 0) {
      popupsOwed.delete(sessionId);
    } else {
      popupsOwed.set(sessionId, kept);
    }
  }
}

/** Forgets everything kept of sessions that are gone: what they were owed, and their acts. */
export function forgetSessions(sessionIds: readonly StoreId.Session[]): void {
  for (const sessionId of sessionIds) {
    owed.delete(sessionId);
    popupsOwed.delete(sessionId);
    for (const acts of actsByTab.values()) {
      acts.delete(sessionId);
    }
  }
}
