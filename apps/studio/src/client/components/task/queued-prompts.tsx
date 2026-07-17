import { type QueuedPrompt } from "@/client/hooks/use-prompt-queue";
import { PaperclipIcon, StackIcon, TrashIcon } from "@phosphor-icons/react";

import { Button } from "../ui/button";

export function QueuedPrompts({
  onRemove,
  prompts,
}: {
  onRemove: (id: string) => void;
  prompts: QueuedPrompt[];
}) {
  if (prompts.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <StackIcon className="size-3.5" />
        Queued
        <span className="tabular-nums opacity-70">{prompts.length}</span>
      </div>
      {/* Cap how much vertical space the queue can claim from the composer;
          overflow scrolls within this band, fading at the edges. */}
      <div className="scroll-fade-y flex max-h-40 flex-col gap-1.5 overflow-y-auto">
        {prompts.map((prompt, index) => {
          const attachmentCount =
            (prompt.files?.length ?? 0) + (prompt.folders?.length ?? 0);
          return (
            <div
              className="flex items-center gap-2 rounded-2xl border bg-muted/40 py-1.5 pr-1.5 pl-3 text-sm"
              key={prompt.id}
            >
              <span className="text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {prompt.prompt}
              </span>
              {attachmentCount > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                  <PaperclipIcon className="size-3.5" />
                  {attachmentCount}
                </span>
              )}
              <Button
                aria-label="Remove queued prompt"
                className="size-6 p-0 text-muted-foreground"
                onClick={() => {
                  onRemove(prompt.id);
                }}
                size="sm"
                variant="ghost"
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
