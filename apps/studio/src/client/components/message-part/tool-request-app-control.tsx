import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessagePart,
  type ChatId,
} from "@instrument-org/workspace/client";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "@/client/lib/toast";

import { openSettings } from "@/client/atoms/settings-modal";

import { Button } from "../ui/button";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
import { useHasLiveSession } from "./use-live-session";

type RequestAppControlPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-request_app_control" }
>;

/**
 * The agent asking to control an app on this computer. The card offers to
 * allow the app for this chat or always. An app already marked Not allowed
 * gets no buttons: the agent is told no at once and the card says why.
 */
export function ToolRequestAppControl({
  part,
  chatId,
}: {
  part: RequestAppControlPart;
  chatId: ChatId;
}) {
  const answer = useMutation(
    rpcClient.workspace.session.answerToolCall.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't send your answer", { cause: error });
      },
    }),
  );
  const allowApp = useMutation(
    rpcClient.workspace.permissions.allowApp.mutationOptions(),
  );
  const isWaitedOn = useHasLiveSession(part.metadata.sessionId);
  const askedApp = part.input?.app;
  const reach = useQuery({
    ...rpcClient.workspace.permissions.appReach.queryOptions({
      input: { app: askedApp ?? "", id: chatId },
    }),
    enabled: askedApp !== undefined,
  });
  const isClosed = reach.data?.level === "never";
  const declineClosed =
    isClosed &&
    isWaitedOn &&
    part.state === "input-available" &&
    !answer.isPending &&
    !answer.isSuccess;
  useEffect(() => {
    if (declineClosed) {
      answer.mutate({
        id: chatId,
        output: { closed: true, status: "declined" },
        toolCallId: part.toolCallId,
        toolName: "request_app_control",
      });
    }
  }, [declineClosed, answer, chatId, part.toolCallId]);

  if (!part.input?.app) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }

  const { app, reason } = part.input;
  const isUnanswered = part.state === "input-available";
  const isPending = isUnanswered && isWaitedOn;
  const isBusy = allowApp.isPending || answer.isPending;
  const wasClosed =
    isClosed ||
    (part.state === "output-available" &&
      part.output.status === "declined" &&
      part.output.closed === true);

  const allow = async (always: boolean) => {
    try {
      await allowApp.mutateAsync({ always, app, id: chatId });
    } catch (error) {
      toast.error("Couldn't allow the app", { cause: error });
      return;
    }
    answer.mutate({
      id: chatId,
      output: { status: "granted" },
      toolCallId: part.toolCallId,
      toolName: "request_app_control",
    });
  };

  const decline = () => {
    answer.mutate({
      id: chatId,
      output: { status: "declined" },
      toolCallId: part.toolCallId,
      toolName: "request_app_control",
    });
  };

  return (
    <ToolCard>
      <ToolCardSection collapsedHeight={256}>
        <p className="flex items-start gap-2 text-sm font-medium">
          <AppWindowIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{`Let Instrument use ${app}?`}</span>
        </p>
        <p className="mt-1 pl-6 text-sm text-muted-foreground">{reason}</p>
        {wasClosed ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {`You marked ${app} Not allowed. `}
            <button
              className="underline underline-offset-2"
              onClick={() => {
                openSettings({ tab: "Permissions" });
              }}
              type="button"
            >
              Change it in Settings
            </button>
          </p>
        ) : isPending ? (
          <>
            {reach.data?.reachesEveryFile ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {`Allowing ${app} lets Instrument reach every file on your Mac.`}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={isBusy}
                onClick={() => {
                  void allow(false);
                }}
                size="sm"
              >
                Allow in this chat
              </Button>
              <Button
                disabled={isBusy}
                onClick={() => {
                  void allow(true);
                }}
                size="sm"
                variant="secondary"
              >
                Always allow
              </Button>
              <Button
                disabled={isBusy}
                onClick={decline}
                size="sm"
                variant="ghost"
              >
                Not now
              </Button>
            </div>
          </>
        ) : isUnanswered ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This request ended without an answer.
          </p>
        ) : part.state === "output-available" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {part.output.status === "granted"
              ? `You let Instrument use ${app}.`
              : "You said not now."}
          </p>
        ) : null}
      </ToolCardSection>
    </ToolCard>
  );
}
