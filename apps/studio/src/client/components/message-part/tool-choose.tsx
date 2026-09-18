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
import { useHasLiveSession } from "./use-live-session";

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

  const isWaitedOn = useHasLiveSession(part.metadata.sessionId);

  if (!part.input) {
    return <ToolCardEmpty message="The question has not arrived yet." />;
  }

  const hasOutput = part.state === "output-available";
  const selected = hasOutput ? part.output.selectedChoice : undefined;
  // The call waits on the user until it has an output, and the rows are how
  // they answer it -- for as long as anything is still listening for one.
  const isUnanswered = part.state === "input-available";
  const isPending = isUnanswered && isWaitedOn;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("choose")}
        </p>
      </ToolCardHeader>

      <ToolCardSection collapsedHeight={256}>
        <p className="mb-3 text-sm">{part.input.question}</p>
        <div
          className="space-y-1.5"
          role={isPending ? "radiogroup" : undefined}
        >
          {part.input.choices?.map((choice, index) => {
            const isSelected = choice === selected;
            // A radio, so a choice reads as one thing to pick among several
            // before it is picked: a ring while open, the ring filled once
            // chosen, and a check in the ring where the answer stands.
            const row = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    isSelected
                      ? "border-brand-600 bg-brand-600 text-brand-foreground"
                      : "border-border bg-background",
                  )}
                >
                  {isSelected && (
                    <CheckIcon className="size-2.5" weight="bold" />
                  )}
                </span>
                <span className="min-w-0 flex-1">{choice}</span>
              </>
            );
            const className = cn(
              "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm",
              isSelected
                ? "border-brand-600/40 bg-brand-500/8 text-foreground"
                : isPending
                  ? "border-border text-foreground hover:border-foreground/30 hover:bg-foreground/5"
                  : "border-transparent text-muted-foreground",
            );
            return isPending ? (
              <button
                aria-checked={isSelected}
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
                role="radio"
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
        {isUnanswered && !isWaitedOn ? (
          <p className="mt-3 text-xs text-muted-foreground">
            This question ended without an answer.
          </p>
        ) : null}
      </ToolCardSection>
    </ToolCard>
  );
}
