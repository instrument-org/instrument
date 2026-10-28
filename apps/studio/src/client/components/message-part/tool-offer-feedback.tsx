import { openReportDialog } from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import { feedbackReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  type ChatId,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { useMutation } from "@tanstack/react-query";

import { ToolCard } from "./tool-card";

type OfferFeedbackPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-offer_feedback" }
>;

/**
 * The agent's offer to send the team a problem it found in the app: what
 * went wrong as its heading and why that points at the app under it, then
 * Review and send, which opens the feedback dialog with the write-up as a
 * part of its own, Not now, and a way to stop the offers. What the person
 * picks is written onto the call and never reaches the agent, and the card
 * settles into a quiet note of it.
 */
export function ToolOfferFeedback({
  chatId,
  part,
}: {
  chatId: ChatId;
  part: OfferFeedbackPart;
}) {
  const settle = useMutation(
    rpcClient.workspace.chats.settleFeedbackOffer.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't update the card", { cause: error });
      },
    }),
  );
  const turnOff = useMutation(
    rpcClient.problems.setOfferFeedback.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );

  if (
    part.state !== "output-available" ||
    !part.output.offered ||
    !part.input
  ) {
    return null;
  }
  const { reason, title, writeup } = part.input;
  const { outcome } = part.output;
  const settleAs = (next: "dismissed" | "sent") => {
    settle.mutate({
      id: chatId,
      messageId: part.metadata.messageId,
      outcome: next,
      partId: part.metadata.id,
      sessionId: part.metadata.sessionId,
    });
  };

  return (
    <ToolCard
      className={cn(
        "p-3.5",
        outcome ? "border-transparent bg-foreground/4" : "shadow-xs",
      )}
    >
      <div className="flex gap-2.5">
        <span className="grid size-6.5 shrink-0 place-items-center rounded-lg bg-foreground/5 text-foreground/60">
          <MegaphoneSimpleIcon className="size-3.75" weight="bold" />
        </span>
        <div className="min-w-0 flex-1 pt-0.75">
          <p className="text-sm font-medium text-pretty">{title}</p>
          {outcome === "sent" ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CheckIcon className="size-3.5 text-brand-600" />
              Sent to the {APP_NAME} team
            </p>
          ) : outcome === "dismissed" ? (
            <p className="mt-1 text-[13px] text-muted-foreground">Not sent</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-pretty text-muted-foreground">
                {reason} Want to send the {APP_NAME} team what happened?
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => {
                    openReportDialog(
                      feedbackReport({
                        chatId,
                        onSent: () => {
                          settleAs("sent");
                        },
                        surface: "agent-offer",
                        writeup: { text: writeup, title },
                      }),
                    );
                  }}
                  size="sm"
                  variant="brand"
                >
                  Review and send
                </Button>
                <Button
                  disabled={settle.isPending}
                  onClick={() => {
                    settleAs("dismissed");
                  }}
                  size="sm"
                  variant="outline"
                >
                  Not now
                </Button>
                <Button
                  className="text-muted-foreground"
                  disabled={settle.isPending || turnOff.isPending}
                  onClick={() => {
                    turnOff.mutate({ enabled: false });
                    settleAs("dismissed");
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Don’t offer again
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </ToolCard>
  );
}
