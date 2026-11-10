import { openReportDialog } from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import { ButtonGroup } from "@/client/components/ui/button-group";
import { feedbackReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type FeedbackTag } from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import {
  type ChatId,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { SmileyIcon } from "@phosphor-icons/react/Smiley";
import { SmileyMehIcon } from "@phosphor-icons/react/SmileyMeh";
import { SmileySadIcon } from "@phosphor-icons/react/SmileySad";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation } from "@tanstack/react-query";

import { ToolCard } from "./tool-card";

const ANSWERS: readonly {
  Icon: typeof SmileyIcon;
  label: string;
  tag: FeedbackTag;
}[] = [
  { Icon: SmileyIcon, label: "Good", tag: "good" },
  { Icon: SmileyMehIcon, label: "Fine", tag: "okay" },
  { Icon: SmileySadIcon, label: "Bad", tag: "bad" },
];

/**
 * The card asking how the chat went, in the transcript under the footer of the
 * turn it came after. It stays there until the person closes it or sends. An
 * answer opens the feedback dialog with its tag picked, and canceling the
 * dialog leaves the card waiting.
 */
export function RatingCard({
  chatId,
  part,
}: {
  chatId: ChatId;
  part: Extract<SessionMessagePart.DataPart, { type: "data-ratingCard" }>;
}) {
  const settle = useMutation(
    rpcClient.workspace.chats.settleRatingCard.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't update the card", { cause: error });
      },
    }),
  );
  const settleAs = (outcome: "dismissed" | "sent") => {
    settle.mutate({
      id: chatId,
      messageId: part.metadata.messageId,
      outcome,
      partId: part.metadata.id,
      sessionId: part.metadata.sessionId,
    });
  };
  const sent = part.data.outcome === "sent";

  return (
    <ToolCard
      className={cn(
        "relative mt-0 max-w-130 p-3.5",
        sent ? "border-transparent bg-foreground/4" : "shadow-xs",
      )}
    >
      {!sent && (
        <Button
          aria-label="Close"
          className="absolute top-1.5 right-1.5 text-muted-foreground"
          disabled={settle.isPending}
          onClick={() => {
            settleAs("dismissed");
          }}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
      <div className="flex gap-2.5">
        <span className="grid size-6.5 shrink-0 place-items-center rounded-lg bg-foreground/5 text-foreground/60">
          <MegaphoneSimpleIcon className="size-3.75" weight="bold" />
        </span>
        <div className="min-w-0 flex-1 pt-0.75">
          <p className="text-sm font-medium">How did {APP_NAME} do here?</p>
          {sent ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CheckIcon className="size-3.5 text-brand-600" />
              Sent to the {APP_NAME} team
            </p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-pretty text-muted-foreground">
                Every note you send is read by the people building Instrument.
              </p>
              <ButtonGroup aria-label="Your answer" className="mt-2.5">
                {ANSWERS.map(({ Icon, label, tag }) => (
                  <Button
                    // The group joins them, so neighbors share one border.
                    className="not-first:-ml-px"
                    key={tag}
                    onClick={() => {
                      openReportDialog(
                        feedbackReport({
                          chatId,
                          onSent: () => {
                            settleAs("sent");
                          },
                          surface: "rating-card",
                          tag,
                        }),
                      );
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <Icon />
                    {label}
                  </Button>
                ))}
              </ButtonGroup>
            </>
          )}
        </div>
      </div>
    </ToolCard>
  );
}
