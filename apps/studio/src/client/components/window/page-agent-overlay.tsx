import { BorderSweep } from "@/client/components/shimmer-sweep";
import { Button } from "@/client/components/ui/button";
import { useTargetsAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { browserTargetOf, type ChatId } from "@instrument-org/workspace/client";
import { CursorClickIcon } from "@phosphor-icons/react/CursorClick";
import { HandIcon } from "@phosphor-icons/react/Hand";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { useMutation, useQuery } from "@tanstack/react-query";

/**
 * What a chat's page says about the agent over the page itself: while the
 * chat waits on the person there (`instrument window wait`), an amber glow and
 * a pill saying so, and the card above the reply box has Done; while its agent
 * is using the page, a glow, the arc round its edge and a chip with Take over,
 * which stops the chat and hands the page to the person. Nothing otherwise.
 */
export function PageAgentOverlay({
  chatId,
  isChatWorking,
  tabId,
}: {
  chatId: ChatId;
  /** Whether the chat or any task of it is at work. */
  isChatWorking: boolean;
  tabId: string;
}) {
  const target = browserTargetOf(tabId);
  const isUsing = useTargetsAgentActivity([target], isChatWorking).has(target);
  const { data: asks } = useQuery(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }),
  );
  const waiting = asks?.find(
    (ask) =>
      ask.kind === "page" && ask.target === tabId && ask.status === "open",
  );
  const isWaiting = waiting !== undefined;
  const waitingFor =
    (waiting?.kind === "page" && waiting.askers[0]?.title) ||
    "Instrument is waiting for you";
  const takeOver = useMutation(
    rpcClient.workspace.session.takeOver.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't take over the page", { cause: error });
      },
    }),
  );

  if (isWaiting) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="page-glow" data-tone="waiting" />
        <div className="absolute inset-x-0 bottom-4 flex justify-center">
          <span
            className="flex h-8 items-center gap-1.5 rounded-full border border-warning-300 bg-warning-100 px-3.5 text-[12.5px] font-medium text-warning-900 shadow-md dark:border-transparent dark:bg-warning-300 dark:text-warning-900"
            role="status"
          >
            <QuestionIcon className="size-3.5" />
            {waitingFor}
          </span>
        </div>
      </div>
    );
  }
  if (!isUsing) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="page-glow" />
      <BorderSweep />
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <div
          className="pointer-events-auto flex h-8 items-center gap-1 rounded-full border border-border bg-background/95 pr-1 pl-3 text-[12.5px] shadow-md"
          role="status"
        >
          <CursorClickIcon className="size-3.5 text-muted-foreground" />
          <span className="pr-1.5 text-foreground/80">
            Instrument is using this page
          </span>
          <span aria-hidden className="h-4 w-px bg-border" />
          <Button
            className="h-6 gap-1 rounded-full px-2 text-[12.5px]"
            disabled={takeOver.isPending}
            onClick={() => {
              takeOver.mutate({ id: chatId, tab: tabId });
            }}
            size="sm"
            variant="ghost"
          >
            <HandIcon className="size-3.5" />
            Take over
          </Button>
        </div>
      </div>
    </div>
  );
}
