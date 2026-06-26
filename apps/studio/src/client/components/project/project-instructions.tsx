import { Textarea } from "@/client/components/ui/textarea";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { debounce } from "radashi";
import { useMemo, useState } from "react";

export function ProjectInstructions({
  instructions,
  projectId,
}: {
  instructions: string;
  projectId: ProjectId;
}) {
  const [value, setValue] = useState(instructions);
  const [seenInstructions, setSeenInstructions] = useState(instructions);
  const [isFocused, setIsFocused] = useState(false);

  // Adopt instructions refreshed from disk, but never while the user is editing
  // (that would clobber their cursor and in-flight text). On-disk edits land on
  // the next focus after blur.
  if (instructions !== seenInstructions) {
    setSeenInstructions(instructions);
    if (!isFocused) {
      setValue(instructions);
    }
  }

  const { mutate } = useMutation(
    rpcClient.workspace.project.update.mutationOptions(),
  );

  const save = useMemo(
    () =>
      debounce({ delay: 500 }, (next: string) => {
        mutate({ id: projectId, instructions: next });
      }),
    [mutate, projectId],
  );

  return (
    <div className="shrink-0 overflow-hidden rounded-lg bg-card shadow-xs">
      <div className="flex flex-col px-3 pt-2">
        <h2 className="text-xs leading-none font-medium">Instructions</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Add details about this project for Instrument to remember for each
          task
        </p>
      </div>
      <div className="p-2">
        <Textarea
          className="max-h-64 min-h-64 resize-none overflow-y-auto rounded-md border-0 bg-muted/50 text-sm leading-relaxed shadow-none"
          onBlur={() => {
            setIsFocused(false);
          }}
          onChange={(e) => {
            setValue(e.target.value);
            save(e.target.value);
          }}
          onFocus={() => {
            setIsFocused(true);
          }}
          placeholder="Instructions for every task in this project..."
          value={value}
        />
      </div>
    </div>
  );
}
