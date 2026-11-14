import {
  changesByPerson,
  layoutChangesLine,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";

/**
 * What the person changed in the chat's tab group since its last message,
 * as one dim line on the message it went with: "Opened Zendesk pricing
 * beside this chat". What an agent did is left out. The whole of what the
 * agent was told is a developer's note.
 */
export function LayoutChangesNote({
  data,
}: {
  data: SessionMessageDataPart.LayoutChangesDataPart;
}) {
  const line = layoutChangesLine(changesByPerson(data.changes));
  if (line === "") {
    return null;
  }
  return (
    <div className="flex w-full justify-end">
      <div
        className="flex max-w-[80%] items-center gap-x-1.5 px-2 py-1 text-xs text-muted-foreground/70"
        title={line}
      >
        <BrowsersIcon className="size-3.5 shrink-0" />
        <span className="truncate">{line}</span>
      </div>
    </div>
  );
}
