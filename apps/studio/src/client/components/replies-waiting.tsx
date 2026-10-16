import { draftsAtom, replyDraftsOf } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { useAtomValue } from "jotai";

import { RelativeTime } from "./relative-time";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** How much of a reply's words the menu shows before it cuts them off. */
const WORDS_SHOWN = 120;

/**
 * The chat's other replies, over its box. A chat can have several waiting,
 * ready to be sent one after another, and the box holds the newest of them,
 * so this is the way back to the rest: it says how many there are and puts
 * the one picked in the box.
 *
 * Nothing at all where the chat has one reply waiting or none, which is
 * almost every chat.
 */
export function RepliesWaiting({
  chatId,
  onSwapIn,
}: {
  chatId: ChatId;
  /** Puts that reply in the box, words and attachments both. */
  onSwapIn: (draftId: string) => void;
}) {
  const drafts = useAtomValue(draftsAtom);
  // The first is the one in the box; these are the ones that are not.
  const others = replyDraftsOf(drafts, chatId).slice(1);

  if (others.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="mb-1.5 text-muted-foreground"
          size="xs"
          variant="ghost"
        >
          <CardsThreeIcon />
          {others.length === 1
            ? "1 other reply waiting"
            : `${others.length} other replies waiting`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-96">
        {others.map((draft) => (
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            key={draft.id}
            onSelect={() => {
              onSwapIn(draft.id);
            }}
          >
            <span className="line-clamp-2 w-full">
              {firstWords(draft.words) || "Nothing written yet"}
            </span>
            <span className="text-xs text-muted-foreground">
              <RelativeTime date={new Date(draft.updatedAt)} tooltip={false} />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function firstWords(words: string) {
  const text = words.trim();
  return text.length > WORDS_SHOWN
    ? `${text.slice(0, WORDS_SHOWN).trimEnd()}…`
    : text;
}
