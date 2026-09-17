import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { FileIcon } from "@phosphor-icons/react/File";
import { useState } from "react";

import { IdeaSketch } from "./idea-sketch";
import { groupIdeas, type Idea } from "./ideas";
import { useIdeas } from "./use-ideas";

/**
 * What the response comes back as: a quiet chip in the composer's row beside
 * the model, saying Output with a plain page on it until a page type is
 * picked, then that type's own pictogram and name. It opens the whole
 * catalog in a popover under itself, over whatever is below, four tiles
 * across in the catalog's groups, scrolling down: one is picked at a time,
 * pressing the picked one again takes it off, and so does Clear at the head.
 * Nothing is picked to begin with, and nothing is recommended.
 */
export function OutputPicker({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (name: string | undefined) => void;
  /** The picked page type, by its template folder's name. */
  value: string | undefined;
}) {
  const ideas = useIdeas();
  const picked = ideas.data?.find((idea) => idea.name === value);
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label={picked ? `Output: ${picked.title}` : "Output"}
          className={cn(
            "flex h-auto max-w-40 min-w-0 items-center gap-1.5 rounded-lg px-1.5! py-1 text-left text-xs leading-4 font-medium",
            picked
              ? "text-foreground/80 hover:text-foreground"
              : "text-gray-400 hover:text-gray-400 dark:text-gray-500 dark:hover:text-gray-500",
          )}
          disabled={disabled}
          size="sm"
          variant="ghost"
        >
          {picked ? (
            <IdeaSketch
              className="h-4 w-auto shrink-0 drop-shadow-xs"
              rows={picked.sketch ?? []}
            />
          ) : (
            <FileIcon className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate">
            {picked ? picked.title : "Output"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-130 flex-col p-0"
        maxHeight="460px"
        side="bottom"
        sideOffset={6}
      >
        <div className="flex shrink-0 items-start gap-2 px-3 pt-3 pb-1">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">Output format</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Optionally pick a page type to receive as the response.
            </p>
          </div>
          {picked && (
            <button
              className="shrink-0 pt-0.5 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-300"
              onClick={() => {
                onChange(undefined);
              }}
              type="button"
            >
              Clear
            </button>
          )}
        </div>
        <div
          aria-label="Page types"
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
          role="radiogroup"
        >
          {groupIdeas(ideas.data ?? []).map((group) => (
            <section key={group.tag}>
              <h3 className="pt-3 pb-1.5 text-[11px] font-medium text-muted-foreground">
                {group.label}
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {group.ideas.map((idea) => (
                  <IdeaTile
                    idea={idea}
                    isPicked={idea.name === value}
                    key={idea.name}
                    onPick={() => {
                      onChange(idea.name === value ? undefined : idea.name);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One page type: its pictogram at the size the catalog draws it, its name
 * under it, and a round mark in its corner, empty while the pointer is on
 * it and filled with a check once picked, with the brand's edge around the
 * whole tile.
 */
function IdeaTile({
  idea,
  isPicked,
  onPick,
}: {
  idea: Idea;
  isPicked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      aria-checked={isPicked}
      className={cn(
        "group/tile relative flex flex-col items-center gap-1.5 rounded-lg border p-2 pt-3 text-left",
        isPicked
          ? "border-brand-600 bg-brand-500/5"
          : "border-transparent hover:border-border hover:bg-muted/60",
      )}
      onClick={onPick}
      role="radio"
      type="button"
    >
      <span
        className={cn(
          "absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full border",
          isPicked
            ? "border-brand-600 bg-brand-600 text-white"
            : "border-muted-foreground/40 opacity-0 group-hover/tile:opacity-100",
        )}
      >
        {isPicked && <CheckIcon className="size-2.5" weight="bold" />}
      </span>
      <IdeaSketch
        className="h-16 w-auto drop-shadow-sm"
        rows={idea.sketch ?? []}
      />
      <span className="w-full truncate text-center text-[11px] leading-4">
        {idea.title}
      </span>
    </button>
  );
}
