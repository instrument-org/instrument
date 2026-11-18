import { APP_NAME } from "@instrument-org/shared";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { ProhibitIcon } from "@phosphor-icons/react/Prohibit";

import { displayPath } from "../../lib/path-utils";

/**
 * A permission ask the app refused before any card went up: one muted line
 * under its step, level with the step's label, naming what was asked for
 * and why no card could ask for it. An ask that raised a card draws nothing
 * here, since the card over the reply box is the whole of it.
 */
export function ToolAskPermission({
  part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-ask_permission" };
}) {
  if (part.state !== "output-available" || part.output.state !== "refused") {
    return null;
  }
  const target = part.input.target.startsWith("/")
    ? displayPath(part.input.target)
    : part.input.target;
  return (
    <p className="flex items-start gap-1.5 pl-7 text-xs leading-5 text-muted-foreground">
      <ProhibitIcon className="mt-1 size-3 shrink-0" />
      <span>
        {APP_NAME} couldn't ask you for "{target}".
        {part.output.why !== undefined && ` ${part.output.why}`}
      </span>
    </p>
  );
}
