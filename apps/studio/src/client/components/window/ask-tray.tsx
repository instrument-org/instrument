import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { FeatherIcon } from "@phosphor-icons/react/Feather";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtom } from "jotai";

import { AskNumber } from "./ask-pills";
import {
  askTrayAtom,
  commentCount,
  numbered,
  revealAsk,
  useFileAsks,
  useMoveAsks,
  useStagedAskActions,
} from "./staged-asks";

/**
 * The comments marked in a file and not yet moved into a chat, floating at
 * the foot of the file over its content as one small toolbar: a caret that
 * opens the list of them above it, each pressed to bring its place into view
 * or taken out with its x, and the button that moves them all into a
 * composer as pills, in the quill and green of starting a chat. The count is
 * said once, in that button's words; nothing is typed or sent here. Absent
 * while nothing waits.
 */
export function AskTray({ path }: { path: string }) {
  const waiting = numbered(useFileAsks(path)).filter(
    ({ ask }) => ask.destination === undefined,
  );
  const { remove } = useStagedAskActions();
  const { canMove, label, move } = useMoveAsks();
  const [tray, setTray] = useAtom(askTrayAtom);
  if (waiting.length === 0) {
    return null;
  }
  const isOpen = tray === path;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3.5 z-30 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        data-slot="ask-tray"
      >
        {isOpen && (
          <ol className="flex max-h-72 w-96 max-w-full flex-col gap-0.5 overflow-y-auto border-b border-border p-1">
            {waiting.map(({ ask, n }) => (
              <li
                className="group/ask flex items-start gap-1 rounded-lg hover:bg-muted"
                key={ask.id}
              >
                <button
                  className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
                  onClick={() => {
                    revealAsk(ask);
                  }}
                  type="button"
                >
                  <AskNumber className="mt-0.5" n={n} />
                  {/* What they said first, then where, as the page's own list reads. */}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px]">
                      {ask.instruction || ask.target}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ask.instruction ? ask.target : ""}
                      {ask.instruction && ask.excerpt ? " · " : ""}
                      {ask.excerpt && (
                        <span className="font-mono text-[11px] text-muted-foreground/80">
                          {ask.excerpt.replaceAll(/\s+/g, " ")}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  aria-label={`Remove comment ${n}`}
                  className="mt-1 mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 group-hover/ask:opacity-100 hover:bg-foreground/8 hover:text-foreground"
                  onClick={() => {
                    remove([ask.id]);
                  }}
                  type="button"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex min-w-0 items-center gap-1 p-1">
          <ToolbarTooltip label={isOpen ? "Hide comments" : "Show comments"}>
            <button
              aria-expanded={isOpen}
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg text-foreground/60 hover:bg-muted hover:text-foreground",
                isOpen && "bg-muted text-foreground",
              )}
              onClick={() => {
                setTray(isOpen ? null : path);
              }}
              type="button"
            >
              <CaretUpIcon
                className={cn(
                  "size-3.5 transition-transform",
                  isOpen && "rotate-180",
                )}
                weight="bold"
              />
            </button>
          </ToolbarTooltip>
          {canMove ? (
            <Button
              className="min-w-0 text-[13px]"
              onClick={() => {
                setTray(null);
                move(waiting.map(({ ask }) => ask.id));
              }}
              size="sm"
              variant="brand"
            >
              <FeatherIcon weight="bold" />
              <span className="truncate">{label(waiting.length)}</span>
            </Button>
          ) : (
            <span className="pr-2.5 text-[13px] font-medium">
              {commentCount(waiting.length)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
