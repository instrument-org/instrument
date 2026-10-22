import {
  chatBoxesAtom,
  otherRepliesOf,
  replyInBox,
} from "@/client/drafts/chat-box";
import { draftsAtom } from "@/client/drafts/store";
import { stripDictatedMarks } from "@instrument-org/shared/dictated-text";
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
 * The replies the chat's box is not writing into, over the box. A chat can
 * have several waiting, ready to be sent one after another, and the box
 * writes into one of them, so this is the way back to the rest: it says how
 * many there are and puts the one picked in the box. A box writing into none,
 * which is an emptied one and one whose reply has just been sent, has every
 * waiting reply here.
 *
 * Nothing at all where the box is writing into the chat's only reply, or
 * where the chat has none waiting, which is almost every chat.
 */
export function RepliesWaiting({
  chatId,
  disabled = false,
  onSwapIn,
}: {
  chatId: ChatId;
  /** Shown but not opened: while the box is dictating into the reply in it. */
  disabled?: boolean;
  /** Puts that reply in the box, words and attachments both. */
  onSwapIn: (draftId: string) => void;
}) {
  const drafts = useAtomValue(draftsAtom);
  const boxes = useAtomValue(chatBoxesAtom);
  const others = otherRepliesOf(drafts, boxes, chatId);
  const inTheBox = replyInBox(drafts, boxes, chatId) !== undefined;

  if (others.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          className="mb-1.5 text-muted-foreground"
          size="xs"
          variant="ghost"
        >
          <CardsThreeIcon />
          {countOf(others.length, inTheBox)}
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

/** What the control says it has: the others, where the box is writing into one of the chat's replies, and all of them where it is not. */
function countOf(waiting: number, inTheBox: boolean): string {
  if (inTheBox) {
    return waiting === 1
      ? "1 other reply waiting"
      : `${waiting} other replies waiting`;
  }
  return waiting === 1 ? "1 reply waiting" : `${waiting} replies waiting`;
}

function firstWords(words: string) {
  const text = stripDictatedMarks(words).trim();
  return text.length > WORDS_SHOWN
    ? `${text.slice(0, WORDS_SHOWN).trimEnd()}…`
    : text;
}
