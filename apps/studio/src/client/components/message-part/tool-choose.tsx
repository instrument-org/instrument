import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";

type ChoosePart = Extract<SessionMessagePart.ToolPart, { type: "tool-choose" }>;

export function ToolChoose({
  part,
  taskId,
}: {
  part: ChoosePart;
  taskId: TaskId;
}) {
  const answer = useMutation(
    rpcClient.workspace.session.answerToolCall.mutationOptions({
      onError: (error) => {
        toast.error("Could not send the answer", {
          description: error.message,
        });
      },
    }),
  );

  if (!part.input) {
    return <ToolCardEmpty message="The question has not arrived yet." />;
  }

  const hasOutput = part.state === "output-available";
  const selected = hasOutput ? part.output.selectedChoice : undefined;
  // The call waits on the user until it has an output, and the rows are how
  // they answer it.
  const isPending = part.state === "input-available";

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("choose")}
        </p>
      </ToolCardHeader>

      <ToolCardSection collapsedHeight={256}>
        <p className="mb-3 text-sm">{part.input.question}</p>
        <div className="space-y-1">
          {part.input.choices?.map((choice, index) => {
            const isSelected = choice === selected;
            const row = (
              <>
                <CheckIcon
                  className={cn(
                    "size-3 shrink-0",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />
                {choice}
              </>
            );
            const className = cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-sm",
              isSelected
                ? "bg-foreground/8 text-foreground"
                : "text-muted-foreground",
              isPending && "hover:bg-foreground/5 hover:text-foreground",
            );
            return isPending ? (
              <button
                className={className}
                disabled={answer.isPending}
                key={index}
                onClick={() => {
                  answer.mutate({
                    id: taskId,
                    output: { selectedChoice: choice },
                    toolCallId: part.toolCallId,
                    toolName: "choose",
                  });
                }}
                type="button"
              >
                {row}
              </button>
            ) : (
              <div className={className} key={index}>
                {row}
              </div>
            );
          })}
        </div>
      </ToolCardSection>
    </ToolCard>
  );
}
