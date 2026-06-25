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
    <div className="flex flex-col gap-y-2">
      <h2 className="text-sm font-semibold">Instructions</h2>
      <p className="text-xs text-muted-foreground">
        Add details about this project for Instrument to remember for each task.
      </p>
      <Textarea
        className="min-h-64 resize-none rounded-lg bg-muted/30 text-sm leading-relaxed"
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value);
        }}
        placeholder="Instructions for every task in this project..."
        value={value}
      />
    </div>
  );
}
