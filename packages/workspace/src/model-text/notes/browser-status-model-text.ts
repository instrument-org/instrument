import { CHAT_HIDDEN_TAB_CAP } from "../../schemas/chat-state";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { systemNote } from "./system-note";

type Status = SessionMessageDataPart.BrowserStatusDataPart;
type Tab = Status["tabs"][number];

export function browserStatusModelNote(data: Status) {
  const closed = closedNote(data.closed ?? []);
  if (data.tabs.length === 0) {
    return systemNote`
      This chat has no tabs open now.${closed}
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
    This chat's tabs, which the chat and each of its tasks all see and drive: ${tabs}. \`agent-browser tab <id>\` switches to one.${asleep}${unloads}${closed}
  `;
}

function tabLine(tab: Tab) {
  const title = tab.title ? ` ("${tab.title}")` : "";
  const opened = tab.openedBy === "task" ? ", opened by an agent" : "";
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
  return `${tab.id} at ${tab.url}${title}${opened}${place}${cost}${unloads}`;
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
      : ` The app closed ${overCap.length === 1 ? "a tab" : "tabs"} this chat's agents opened, ${named(overCap)}: the chat had more than ${CHAT_HIDDEN_TAB_CAP} tabs its agents opened out of the user's sight, and the one hidden longest closes first.`,
    atTurnEnd.length === 0
      ? ""
      : ` The app closed ${atTurnEnd.length === 1 ? "a tab" : "tabs"} this chat's agents opened that nobody was working in and the user never used, ${named(atTurnEnd)}, as your last turn ended. Open the address again if the work needs it.`,
  ].join("");
}
