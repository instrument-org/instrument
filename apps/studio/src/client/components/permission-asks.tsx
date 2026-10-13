import { rpcClient } from "@/client/rpc/client";
import { getToolExplanation } from "@/client/lib/get-tool-explanation";
import { folderLabel, displayPath } from "@/client/lib/path-utils";
import { toast } from "@/client/lib/toast";
import {
  type ChatId,
  isToolPart,
  type SessionMessage,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";

import { InstrumentGlyph } from "./wordmark";
import { Button } from "./ui/button";
import { ToolCard, ToolCardSection } from "./message-part/tool-card";

type Decision = "allowed" | "always" | "declined";
type Ask = {
  id: string;
  kind: "folder" | "app";
  partId?: string | undefined;
  target: string;
};

function useAsks(chatId: ChatId) {
  return useQuery(
    rpcClient.workspace.permissions.liveAsks.experimental_liveOptions({
      input: { id: chatId },
    }),
  ).data;
}

function useAnswer(chatId: ChatId, ask: Ask) {
  const answer = useMutation(
    rpcClient.workspace.permissions.answer.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't send your answer", { cause: error });
      },
    }),
  );
  return {
    isBusy: answer.isPending,
    send: (decision: Decision, path?: string) => {
      answer.mutate({
        askId: ask.id,
        decision,
        id: chatId,
        ...(path && { path }),
      });
    },
  };
}

/** The folder as a reader names it, or the app by its own name. */
export function permissionTargetName(kind: Ask["kind"], target: string) {
  return kind === "folder" ? folderLabel(target) : target;
}

/**
 * What each folder of sign-ins the agent asks first about holds, by its path
 * in the home folder, as the workspace's passwords place lists them.
 */
const SIGN_IN_LINES: Record<string, string> = {
  ".aws": "This folder holds the keys to your Amazon Web Services account.",
  ".azure": "This folder holds your sign-in to Microsoft Azure.",
  ".config/gcloud": "This folder holds your sign-in to Google Cloud.",
  ".config/gh": "This folder holds your sign-in to GitHub.",
  ".config/op": "This folder holds your sign-in to 1Password.",
  ".docker/config.json":
    "This file holds your sign-ins to the places Docker gets images from.",
  ".git-credentials": "This file holds the passwords git signs in with.",
  ".gnupg": "This folder holds the keys you sign and encrypt things with.",
  ".kube": "This folder holds the keys to your Kubernetes clusters.",
  ".netrc": "This file holds passwords for websites and servers.",
  ".password-store": "This folder holds your saved passwords.",
  ".ssh": "This folder holds the keys you sign in to other computers with.",
};

/** What a folder of sign-ins holds, said plainly; undefined for any other folder. */
function signInLine(target: string): string | undefined {
  const home = window.api.homeDir.replace(/[\\/]+$/, "");
  if (!target.startsWith(home)) {
    return undefined;
  }
  const inHome = target
    .slice(home.length)
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  return SIGN_IN_LINES[inHome];
}

/** The explanation the tool call with this part id gave for itself. */
function explanationOf(
  messages: readonly SessionMessage.WithParts[],
  partId: string | undefined,
): string | undefined {
  if (partId === undefined) {
    return undefined;
  }
  for (const message of messages) {
    for (const part of message.parts) {
      if (isToolPart(part) && part.metadata.id === partId) {
        return getToolExplanation(part);
      }
    }
  }
  return undefined;
}

/** A folder's path from the home folder down, `Documents › Clients`; the home folder is its own name. */
function readablePath(target: string): string {
  const home = window.api.homeDir;
  const names = displayPath(target).split(/[/\\]/).filter(Boolean);
  const inHome = target === home || /^[/\\]/.test(target.slice(home.length));
  return (
    (inHome && target.startsWith(home) && names.length > 1
      ? names.slice(1)
      : names
    ).join(" › ") || target
  );
}

/**
 * The chat's open asks that the tool part with this id raised, drawn in full
 * under it.
 */
export function PermissionAsksForPart({
  chatId,
  explanation,
  partId,
}: {
  chatId: ChatId;
  /** What the call said it was doing, shown on its cards. */
  explanation: string | undefined;
  partId: string;
}) {
  const asks = useAsks(chatId)?.filter((ask) => ask.partId === partId);
  if (!asks?.length) {
    return null;
  }
  return asks.map((ask) => (
    <PermissionAskCard
      ask={ask}
      chatId={chatId}
      explanation={explanation}
      key={ask.id}
    />
  ));
}

/**
 * Every open ask at the foot of the chat, just above the composer. One that
 * a tool part also shows keeps the short form here; one with no part has only
 * this card, so it gets the whole set of answers.
 */
export function PermissionAsksFoot({
  chatId,
  messages,
}: {
  chatId: ChatId;
  /** The chat's messages, where the call that raised an ask is found. */
  messages: readonly SessionMessage.WithParts[];
}) {
  const asks = useAsks(chatId);
  if (!asks?.length) {
    return null;
  }
  return (
    <div className="mb-2 flex flex-col gap-2">
      {asks.map((ask) => (
        <PermissionAskCard
          ask={ask}
          chatId={chatId}
          compact={ask.partId !== undefined}
          explanation={explanationOf(messages, ask.partId)}
          key={ask.id}
        />
      ))}
    </div>
  );
}

function PermissionAskCard({
  ask,
  chatId,
  compact = false,
  explanation,
}: {
  ask: Ask;
  chatId: ChatId;
  compact?: boolean;
  explanation: string | undefined;
}) {
  const { isBusy, send } = useAnswer(chatId, ask);
  const name = permissionTargetName(ask.kind, ask.target);
  const holds = ask.kind === "folder" ? signInLine(ask.target) : undefined;
  const reach = useQuery({
    ...rpcClient.workspace.permissions.appReach.queryOptions({
      input: { app: ask.target, id: chatId },
    }),
    enabled: ask.kind === "app" && !compact,
  });
  const choose = async () => {
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Allow",
      startingAt: ask.target,
    });
    if (picked) {
      send("allowed", picked.path);
    }
  };

  if (compact) {
    return (
      <ToolCard className="mt-0 rounded-xl">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm">
              {`Let Instrument use “${name}”?`}
            </p>
            {explanation ? (
              <p className="truncate text-xs text-muted-foreground">
                {explanation}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={isBusy}
              onClick={() => {
                send("allowed");
              }}
              size="sm"
            >
              Allow
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => {
                send("declined");
              }}
              size="sm"
              variant="ghost"
            >
              Not now
            </Button>
          </div>
        </div>
      </ToolCard>
    );
  }

  return (
    <ToolCard>
      <ToolCardSection collapsedHeight={256}>
        <p className="text-sm">
          {ask.kind === "folder"
            ? `Let Instrument use “${name}”?`
            : `Let Instrument use ${name}?`}
        </p>
        {explanation ? (
          <p className="mt-1 text-sm text-muted-foreground">{explanation}</p>
        ) : null}
        {holds ? <p className="mt-1 text-sm">{holds}</p> : null}
        {ask.kind === "folder" ? (
          <p className="mt-1 text-xs break-all text-muted-foreground">
            {readablePath(ask.target)}
          </p>
        ) : reach.data?.reachesEveryFile ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {`Allowing ${name} lets Instrument reach every file on your Mac.`}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={isBusy}
            onClick={() => {
              send("allowed");
            }}
            size="sm"
          >
            Allow in this chat
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => {
              send("always");
            }}
            size="sm"
            variant="secondary"
          >
            Always allow
          </Button>
          {ask.kind === "folder" ? (
            <Button
              disabled={isBusy}
              onClick={() => {
                void choose();
              }}
              size="sm"
              variant="ghost"
            >
              Choose a folder…
            </Button>
          ) : null}
          <Button
            disabled={isBusy}
            onClick={() => {
              send("declined");
            }}
            size="sm"
            variant="ghost"
          >
            Not now
          </Button>
        </div>
      </ToolCardSection>
    </ToolCard>
  );
}

/** The line that marks why the chat woke: what the user answered to an ask. */
export function PermissionAnswerNote({
  data,
}: {
  data: SessionMessageDataPart.PermissionAnswerDataPart;
}) {
  const name = permissionTargetName(data.kind, data.target);
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <InstrumentGlyph className="size-3.5 shrink-0" />
      <span>
        {data.answer === "allowed"
          ? `You allowed “${name}” in this chat.`
          : data.answer === "always"
            ? `You allowed “${name}” for every chat.`
            : `You said not now to “${name}”.`}
      </span>
    </p>
  );
}
