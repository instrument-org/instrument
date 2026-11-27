import { chatNotesAtom } from "@/client/atoms/chat-notes";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { cn } from "@/client/lib/utils";
import { NotePencilIcon } from "@phosphor-icons/react/NotePencil";
import { useAtom, useAtomValue } from "jotai";

import { STRIP_TIER } from "./strip-tiers";

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
      aria-label="Chat notes"
      aria-pressed={isOn}
      className={className}
      data-chat-notes
      onClick={() => {
        setIsOn(!isOn);
      }}
      type="button"
    >
      <NotePencilIcon
        className={cn(
          "size-3.25",
          isOn ? "text-white" : "text-white/45",
          STRIP_TIER.icon,
        )}
      />
      <span className={cn("text-white/50", STRIP_TIER.words)}>chat notes</span>
      <span className={STRIP_TIER.words}>{isOn ? "on" : "off"}</span>
    </button>
  );
}
