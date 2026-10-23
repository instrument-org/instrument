import { CHAT_HIDDEN_TAB_CAP } from "../schemas/chat-state";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type Status = SessionMessageDataPart.BrowserStatusDataPart;
type Tab = Status["tabs"][number];

export function browserStatusModelNote(data: Status) {
  const closed = closedNote(data.closed ?? []);
  if (data.tabs.length === 0) {
    return systemNote`
      Your browser has no tabs of the user's chat now.${closed}
    `;
  }

  const tabs = data.tabs.map(tabLine).join("; ");
  const asleep = data.tabs.some((tab) => tab.asleep)
    ? " A tab asleep draws nothing and runs its timers slowly until a command reaches it, which wakes it with its page as it was."
    : "";
  const unloads = data.tabs.some((tab) => tab.unloadsInMin !== undefined)
    ? " A page unloaded out of sight comes back from its address the next time the tab is used, without what was typed or scrolled in it."
    : "";
  return systemNote`
    Your browser is these tabs of the user's chat, first one first: ${tabs}. \`agent-browser\` starts on the first; \`agent-browser tab <id>\` switches to another, and \`agent-browser tab list\` shows them all.${asleep}${unloads}${closed}
  `;
}

function tabLine(tab: Tab) {
  const title = tab.title ? ` ("${tab.title}")` : "";
  // The handed clause ends the line, since what it says runs on after a colon.
  const opened = tab.openedBy === "handed" ? "" : ", which you opened";
  const handed =
    tab.openedBy === "handed"
      ? ", handed to you: it is the user's, so work in it and never close it"
      : "";
  const place =
    tab.onScreen === undefined
      ? ""
      : tab.onScreen
        ? ", on the user's screen"
        : `, out of the user's sight${tab.asleep ? " and asleep" : ""}`;
  const shared =
    tab.sharedWith && tab.sharedWith.length > 0
      ? ` (one process with ${tab.sharedWith.join(", ")})`
      : "";
  const cost =
    tab.memoryMb === undefined
      ? ""
      : `, using ${tab.memoryMb} MB${tab.cpuPercent === undefined ? "" : ` and ${tab.cpuPercent}% CPU`}${shared}`;
  const unloads =
    tab.unloadsInMin === undefined
      ? ""
      : `, its page unloads in about ${tab.unloadsInMin} min unless used`;
  return `${tab.id} at ${tab.url}${title}${opened}${place}${cost}${unloads}${handed}`;
}

function closedNote(closed: NonNullable<Status["closed"]>) {
  if (closed.length === 0) {
    return "";
  }
  const tabs = closed
    .map(
      (tab) =>
        `${tab.id}${tab.url ? ` at ${tab.url}` : ""}${tab.title ? ` ("${tab.title}")` : ""}`,
    )
    .join("; ");
  return ` The app closed ${closed.length === 1 ? "a tab" : "tabs"} you opened, ${tabs}: the chat had more than ${CHAT_HIDDEN_TAB_CAP} tabs its agents opened out of the user's sight, and the one hidden longest closes first.`;
}
