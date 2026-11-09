import { chatNotesAtom } from "@/client/atoms/chat-notes";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { useAtom, useAtomValue } from "jotai";

/** Where a tab shows a transcript, its debug page among them. */
const SHOWS_A_TRANSCRIPT =
  /^\/(?:chats\/|tasks\/|debug\/components\/transcript)/;

/**
 * The margin notes, on or off. It arrives with a chat and goes with it, so the
 * band tells a developer the chat they're on has notes to turn off.
 */
export function ChatNotesToggle({ className }: { className: string }) {
  const [isOn, setIsOn] = useAtom(chatNotesAtom);
  const tabs = useAtomValue(appTabsAtom);
  const selected = tabs.tabs.find((tab) => tab.id === tabs.selectedId);
  if (!selected || !SHOWS_A_TRANSCRIPT.test(selected.pathname)) {
    return null;
  }
  return (
    <button
      aria-pressed={isOn}
      className={className}
      data-chat-notes
      onClick={() => {
        setIsOn(!isOn);
      }}
      type="button"
    >
      <span className="text-white/50">chat notes</span>
      <span>{isOn ? "on" : "off"}</span>
    </button>
  );
}
