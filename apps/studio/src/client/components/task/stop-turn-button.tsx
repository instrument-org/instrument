import { Button } from "@/client/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useMutation } from "@tanstack/react-query";

/**
 * Stops the turn a chat's own conversation is running, drawn beside its Send
 * while that turn runs and nowhere otherwise. Send stays a send, since a
 * message written mid-turn joins the turn. Only the chat's own turn ends: its
 * tasks keep working, and each has a stop of its own.
 */
export function StopTurnButton({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  /** The chat's own session, whose turn this stops. */
  sessionId: StoreId.Session | undefined;
}) {
  const { isAgentAlive } = useAgentSessionStatus({ id: chatId, sessionId });
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  if (!isAgentAlive || !sessionId) {
    return null;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Stop"
          className="size-7 shrink-0 rounded-full p-0"
          disabled={stop.isPending}
          onClick={() => {
            stop.mutate({ id: chatId, sessionId });
          }}
          variant="outline"
        >
          <StopIcon className="size-3.5" weight="fill" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Stop</TooltipContent>
    </Tooltip>
  );
}
