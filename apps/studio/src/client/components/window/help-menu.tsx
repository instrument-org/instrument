import { openReportDialog } from "@/client/atoms/report-dialog";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { feedbackReport } from "@/client/lib/problem-reports";
import { SUPPORT_URL } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";
import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";
import { KeyboardIcon } from "@phosphor-icons/react/Keyboard";
import { LifebuoyIcon } from "@phosphor-icons/react/Lifebuoy";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { useRef } from "react";

/**
 * Help at the sidebar's foot: a menu in the native Help menu's order. Send
 * feedback opens the feedback dialog about the chat on screen when there is
 * one, since that is what someone pressing it is most likely telling us
 * about.
 */
export function HelpMenu({ chatId }: { chatId?: ChatId }) {
  const openExternalLink = useOpenExternalLink();
  // The dialog opens once the menu has closed, so the menu handing focus
  // back to its button doesn't take it from the note.
  const opensFeedback = useRef(false);
  return (
    <DropdownMenu>
      <ToolbarTooltip label="Help">
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Help"
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            type="button"
          >
            <QuestionIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        onCloseAutoFocus={(event) => {
          if (opensFeedback.current) {
            opensFeedback.current = false;
            event.preventDefault();
            openReportDialog(feedbackReport({ chatId, surface: "rail" }));
          }
        }}
        side="top"
      >
        <DropdownMenuItem
          onSelect={() => {
            opensFeedback.current = true;
          }}
        >
          <ChatTeardropTextIcon className="size-4" />
          Send feedback…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            openExternalLink(SUPPORT_URL);
          }}
        >
          <LifebuoyIcon className="size-4" />
          Support
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openShortcutGuide}>
          <KeyboardIcon className="size-4" />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
