import {
  dataPartVisibility,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { type ReactNode, useState } from "react";

import { cn } from "@/client/lib/utils";

/** A data part's name as a person reads it: `data-toolResultsCleared` to "tool results cleared". */
function noteName(type: string): string {
  return type
    .replace(/^data-/, "")
    .replaceAll(/([A-Z])/g, " $1")
    .toLowerCase();
}

/**
 * A note only developers see, drawn as one quiet line that opens onto its
 * details, so a chat in developer mode stays readable and what the harness did
 * is still there to spot. A note everyone sees draws as itself.
 */
export function DeveloperNote({
  children,
  part,
}: {
  children: ReactNode;
  part: SessionMessagePart.DataPart;
}) {
  const [isOpen, setIsOpen] = useState(false);
  if (dataPartVisibility(part) !== "dev") {
    return children;
  }
  return (
    <div className="flex min-w-0 flex-col" data-developer-note={part.type}>
      <button
        className="group/dev flex h-6 w-fit max-w-full items-center gap-1.5 rounded-md text-left text-xs text-muted-foreground outline-none hover:text-foreground"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          <CodeIcon className="size-3" />
        </span>
        <span className="truncate">{noteName(part.type)}</span>
        <CaretRightIcon
          className={cn(
            "size-3 shrink-0 opacity-0 transition duration-150 group-hover/dev:opacity-100",
            isOpen && "rotate-90 opacity-100",
          )}
        />
      </button>
      {isOpen && <div className="mt-1 ml-7">{children}</div>}
    </div>
  );
}
