import { CHAT_HIDDEN_TAB_CAP } from "../../schemas/chat-state";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type Status = SessionMessageDataPart.BrowserStatusDataPart;
type Tab = Status["tabs"][number];

export function browserStatusModelNote(data: Status) {
  const closed = closedNote(data.closed ?? []);
  if (data.tabs.length === 0) {
    return systemNote`
      The user's tab group has no pages open now.${closed}
    `;
  }

  const tabs = data.tabs.map(tabLine).join("; ");
  return systemNote`
    Pages in the user's tab group: ${tabs}.${closed}
  `;
}

/**
 * One page by its id and address, with what changes slowly enough to be
 * news: who opened it, whether it is out of sight or asleep, and what it
 * costs. How sleep and unloading work is the system prompt's.
 */
function tabLine(tab: Tab) {
  const opened = tab.openedBy === "task" ? ", opened by an agent" : "";
  const place =
    tab.onScreen === false
      ? `, out of sight${tab.asleep ? " and asleep" : ""}`
      : "";
  const shared =
    tab.sharedWith && tab.sharedWith.length > 0
      ? ` (one process with ${tab.sharedWith.join(", ")})`
      : "";
  const cost =
    tab.memoryMb === undefined
      ? ""
      : `, ${tab.memoryMb} MB${tab.cpuPercent === undefined ? "" : `, ${tab.cpuPercent}% CPU`}${shared}`;
  return `${tab.id} at ${tab.url}${opened}${place}${cost}`;
}

/**
 * The pages that changed since the note before: each opened or changed by
 * its whole line, each gone by its id, and what the app closed. A note the
 * same as the one before says nothing, so this is said only when one did.
 */
export function browserStatusChangesModelNote(before: Status, now: Status) {
  const was = new Map(before.tabs.map((tab) => [tab.id, tabLine(tab)]));
  const changed = now.tabs
    .map(tabLine)
    .filter((line, at) => was.get(now.tabs[at]?.id ?? "") !== line);
  const gone = before.tabs
    .filter((tab) => !now.tabs.some((other) => other.id === tab.id))
    .map((tab) => tab.id);
  const said = [
    changed.length === 0 ? "" : `Pages changed: ${changed.join("; ")}.`,
    gone.length === 0 ? "" : `Pages gone: ${gone.join(", ")}.`,
  ]
    .filter((line) => line !== "")
    .join(" ");
  return systemNote`
    ${`${said}${closedNote(now.closed ?? [])}`.trim()}
  `;
}

function closedNote(closed: NonNullable<Status["closed"]>) {
  const named = (tabs: typeof closed) =>
    tabs
      .map(
        (tab) =>
          `${tab.id}${tab.url ? ` at ${tab.url}` : ""}${tab.title ? ` ("${tab.title}")` : ""}`,
      )
      .join("; ");
  const overCap = closed.filter((tab) => tab.reason === "tabCap");
  const atTurnEnd = closed.filter((tab) => tab.reason === "turnEnd");
  return [
    overCap.length === 0
      ? ""
      : ` The app closed ${overCap.length === 1 ? "a tab" : "tabs"} this chat's agents opened, ${named(overCap)}: the chat had more than ${CHAT_HIDDEN_TAB_CAP} tabs its agents opened out of the user's sight, and the one hidden longest that the user never used closes first.`,
    atTurnEnd.length === 0
      ? ""
      : ` The app closed ${atTurnEnd.length === 1 ? "a tab" : "tabs"} this chat's agents opened that nobody was working in and the user never used, ${named(atTurnEnd)}, as your last turn ended. Open the address again if the work needs it.`,
    closed.length === 0
      ? ""
      : " Tabs the user used stay until someone closes them, so close the tabs you opened once you are done with them.",
  ].join("");
}
