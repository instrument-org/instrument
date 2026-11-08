import {
  ChatIdSchema,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { GitBranchIcon } from "@phosphor-icons/react/GitBranch";
import { useContext } from "react";

import { WindowContext } from "../window/context";
import { chatHref } from "../window/window-href";

/**
 * The quiet line a branch's copied conversation ends on, naming the chat it
 * came from, whose title opens that chat. Outside the app window there is
 * nowhere to open it, and the title is plain words.
 */
export function BranchedFromLine({
  part,
}: {
  part: Extract<SessionMessagePart.DataPart, { type: "data-branchedFrom" }>;
}) {
  const appWindow = useContext(WindowContext);
  const chat = ChatIdSchema.safeParse(part.data.chat);
  const title = part.data.title;
  return (
    <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
      <GitBranchIcon className="shrink-0" size={13} />
      <span className="min-w-0 truncate">
        Branched from{" "}
        {appWindow && chat.success ? (
          <button
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
            onClick={() => {
              appWindow.openScreen(chatHref(chat.data));
            }}
            type="button"
          >
            {title}
          </button>
        ) : (
          <span className="text-foreground">{title}</span>
        )}
      </span>
    </p>
  );
}
