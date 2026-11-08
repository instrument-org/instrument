import { PageFavicon } from "@/client/components/favicon";
import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { useMutation } from "@tanstack/react-query";
import { use } from "react";

import { TranscriptActionsContext } from "./transcript-actions";

/** A page's site as the line names it. */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || url;
  } catch {
    return url;
  }
}

/**
 * Take over, where it happened: while it is the last thing in the chat, the
 * chat is paused on the person, with Continue to give the page back; once
 * anything follows (Continue, a message), a quiet line that they used the
 * page. Giving it back draws nothing, since the reply that follows says what
 * came of it.
 */
export function PageTakeoverNote({
  chatId,
  data,
  isNewest,
}: {
  chatId: ChatId;
  data: SessionMessageDataPart.PageTakeoverDataPart;
  /** Nothing has come after it in the chat. */
  isNewest: boolean;
}) {
  const { isRunning } = use(TranscriptActionsContext);
  const giveBack = useMutation(
    rpcClient.workspace.session.giveBack.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't give the page back", { cause: error });
      },
    }),
  );
  if (data.stage === "returned") {
    return null;
  }
  const site = siteOf(data.page.url);
  if (!isNewest || isRunning) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PageFavicon
          className="size-3.5"
          hasTooltip={false}
          url={data.page.url}
        />
        <span>{`You took over ${site}.`}</span>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex size-5 items-center justify-center rounded-md bg-muted">
        <PauseIcon className="size-3" weight="fill" />
      </span>
      <span>{`Paused while you use ${site}`}</span>
      <Button
        className="h-6 rounded-md px-2 text-xs"
        disabled={giveBack.isPending || giveBack.isSuccess}
        onClick={() => {
          giveBack.mutate({ id: chatId, tab: data.tab });
        }}
        size="sm"
      >
        Continue
      </Button>
    </div>
  );
}
