import {
  CHAT_NOTES,
  CHAT_NOTES_LABEL,
  type ChatNotes,
  chatNotesAtom,
} from "@/client/atoms/chat-notes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { useAtom, useAtomValue } from "jotai";

/** Where a tab shows a transcript, its debug page among them. */
const SHOWS_A_TRANSCRIPT =
  /^\/(?:chats\/|tasks\/|debug\/components\/transcript)/;

/**
 * What the margin notes show at rest. It arrives with a chat and goes with it,
 * so the band tells a developer the chat they're on has notes to turn down.
 */
export function ChatNotesMenu({ className }: { className: string }) {
  const [notes, setNotes] = useAtom(chatNotesAtom);
  const tabs = useAtomValue(appTabsAtom);
  const selected = tabs.tabs.find((tab) => tab.id === tabs.selectedId);
  if (!selected || !SHOWS_A_TRANSCRIPT.test(selected.pathname)) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={className} data-chat-notes type="button">
          <span className="text-white/50">chat notes</span>
          <span>{CHAT_NOTES_LABEL[notes].toLowerCase()}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            const next = CHAT_NOTES.find((each) => each === value);
            if (next) {
              setNotes(next satisfies ChatNotes);
            }
          }}
          value={notes}
        >
          {CHAT_NOTES.map((each) => (
            <DropdownMenuRadioItem key={each} value={each}>
              {CHAT_NOTES_LABEL[each]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
