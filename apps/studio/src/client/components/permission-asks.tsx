import { MacAppIcon } from "@/client/components/mac-app-icon";
import { rpcClient } from "@/client/rpc/client";
import { FolderRow } from "@/client/components/folder-row";
import { isInside, segmentsOf } from "@/client/components/window/host-path";
import { toast } from "@/client/lib/toast";
import {
  askTargetName,
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { openSettings } from "@/client/atoms/settings-modal";
import { privacyPaneForApp } from "@/client/lib/privacy-pane";
import { cn } from "@/client/lib/utils";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { ShieldSlashIcon } from "@phosphor-icons/react/ShieldSlash";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { XIcon } from "@phosphor-icons/react/X";

import { Button } from "./ui/button";
import { Delayed } from "./ui/delayed";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Decision = "allowed" | "always" | "declined";
type Ask = NonNullable<ReturnType<typeof useAsks>>[number];

/** The chat's open permission cards; its questions draw under their calls. */
function useAsks(chatId: ChatId) {
  return useQuery(
    rpcClient.workspace.chats.live.asks.experimental_liveOptions({
      input: { id: chatId },
    }),
  ).data?.filter((ask) => ask.kind !== "question");
}

const onAnswerError = {
  onError: (error: Error) => {
    toast.error("Couldn't send your answer", { cause: error });
  },
};

/**
 * What each folder of sign-ins the agent asks first about holds, by its path
 * in the home folder, as the workspace's passwords place lists them.
 */
const SIGN_IN_LINES: Record<string, string> = {
  ".aws": "This folder has the keys to your Amazon Web Services account.",
  ".azure": "This folder has your sign-in to Microsoft Azure.",
  ".config/gcloud": "This folder has your sign-in to Google Cloud.",
  ".config/gh": "This folder has your sign-in to GitHub.",
  ".config/op": "This folder has your sign-in to 1Password.",
  ".docker/config.json":
    "This file has your sign-ins to the places Docker gets images from.",
  ".git-credentials": "This file has the passwords git signs in with.",
  ".gnupg": "This folder has the keys you sign and encrypt things with.",
  ".kube": "This folder has the keys to your Kubernetes clusters.",
  ".netrc": "This file has passwords for websites and servers.",
  ".password-store": "This folder has your saved passwords.",
  ".ssh": "This folder has the keys you sign in to other computers with.",
};

/** What a folder of sign-ins holds, said plainly; undefined for any other folder. */
function signInLine(target: string): string | undefined {
  const home = window.api.homeDir;
  if (!isInside(target, home)) {
    return undefined;
  }
  const inHome = segmentsOf(target).slice(segmentsOf(home).length).join("/");
  return SIGN_IN_LINES[inHome];
}

/**
 * Every open ask, just above the composer and only there: a task's ask has no
 * call in the chat's transcript to draw under, and one place keeps several
 * from piling up. The oldest is drawn whole with the rest tucked under it,
 * and answering it brings up the next.
 */
export function PermissionAsksFoot({ chatId }: { chatId: ChatId }) {
  const asks = useAsks(chatId);
  const [first] = asks ?? [];
  if (!asks || !first) {
    return null;
  }
  const waiting = asks.length - 1;
  return (
    <div className={cn("@container/asks relative mb-2", waiting > 0 && "pb-2")}>
      {waiting > 1 ? (
        <div className="absolute inset-x-6 bottom-0 h-6 rounded-b-2xl border border-border bg-card/70" />
      ) : null}
      {waiting > 0 ? (
        <div className="absolute inset-x-3 bottom-1 h-6 rounded-b-2xl border border-border bg-card shadow-xs" />
      ) : null}
      <PermissionAskCard
        ask={first}
        chatId={chatId}
        key={first.id}
        stack={asks}
      />
    </div>
  );
}

function PermissionAskCard({
  ask,
  chatId,
  stack,
}: {
  ask: Ask;
  chatId: ChatId;
  /** Every open ask, this one first, for the count and the no to all. */
  stack: readonly Ask[];
}) {
  const answer = useMutation(
    rpcClient.workspace.permissions.answer.mutationOptions(onAnswerError),
  );
  const declineAll = useMutation(
    rpcClient.workspace.permissions.declineAll.mutationOptions(onAnswerError),
  );
  const busy = answer.isPending || declineAll.isPending;
  const isFolder = ask.kind === "folder";
  const refused = ask.status === "macos-refused";
  const asking = ask.status === "macos-asking";
  const isPrivate = ask.status === "macos-private";
  const blocked = ask.status === "windows-blocked";
  const name = askTargetName(ask.kind, ask.target);
  // What the agent said it needs this for, from the first to ask.
  const reason = ask.askers[0]?.reason;
  // A card waiting on macOS's own prompt settles once the person answers it,
  // whoever raised it: the look that waits on the answer runs from here too.
  const retry = useMutation(
    rpcClient.workspace.permissions.retry.mutationOptions(),
  );
  useEffect(() => {
    if (asking) {
      retry.mutate({ askId: ask.id, id: chatId });
    }
    // Once a card starts asking; the look waits as long as the prompt does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, ask.id]);
  const holds = isFolder ? signInLine(ask.target) : undefined;
  const pending = answer.isPending ? answer.variables.decision : undefined;
  const choice = (decision: Decision) => ({
    disabled: busy,
    onClick: () => {
      answer.mutate({ askId: ask.id, decision, id: chatId });
    },
    pending: pending === decision,
  });

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card p-3 shadow-xs",
        refused || isPrivate || blocked
          ? "border-warning-300 dark:border-warning-700"
          : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{cardTitle(ask, name)}</p>
        {stack.length > 1 ? (
          <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {`1 of ${stack.length}`}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Don’t allow any of these"
                  className="size-6"
                  disabled={busy}
                  onClick={() => {
                    declineAll.mutate({ id: chatId });
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <XIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Don’t allow any of these</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {asking || isPrivate || blocked ? (
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {asking
            ? // oxlint-disable-next-line studio/no-os-words -- macOS alone asks this way
              "Choose Allow in the window your Mac opened."
            : blocked
              ? "Ransomware protection only lets programs it trusts change this folder."
              : "Only the app it belongs to can open it, so Instrument can’t read it."}
        </p>
      ) : reason || refused ? (
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {reason ?? `Instrument needs access to ${name} to finish your task.`}
        </p>
      ) : null}
      {isFolder ? (
        <FolderRow
          className="mt-2.5 rounded-xl bg-muted/50 px-3 py-2"
          path={ask.target}
        />
      ) : (
        <div className="mt-2.5 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2">
          <span className="grid size-8 shrink-0 place-items-center">
            <MacAppIcon app={ask.target} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{ask.target}</span>
        </div>
      )}
      {holds ? (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-warning-700 dark:text-warning-300">
          <ShieldWarningIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{holds}</span>
        </p>
      ) : null}
      {/* A chat too narrow for the three in a row stacks them, each the
      card's width, rather than wrapping into a ragged pair. */}
      <div className="mt-3 flex items-center gap-2 @max-md/asks:flex-col @max-md/asks:items-stretch @max-md/asks:gap-1.5">
        {refused ? (
          <MacFixes ask={ask} busy={busy} chatId={chatId} />
        ) : blocked ? (
          <WindowsFixes ask={ask} busy={busy} chatId={chatId} />
        ) : asking || isPrivate ? null : (
          <>
            <AnswerButton {...choice("allowed")}>
              Allow in this chat
            </AnswerButton>
            <AnswerButton {...choice("always")} variant="outline">
              Always allow
            </AnswerButton>
          </>
        )}
        <AnswerButton
          {...choice("declined")}
          className="ml-auto text-muted-foreground @max-md/asks:ml-0"
          variant="ghost"
        >
          {isPrivate ? "OK" : "Don’t allow"}
        </AnswerButton>
      </div>
    </div>
  );
}

// oxlint-disable studio/no-os-words -- macOS alone asks, refuses or keeps things private this way, so these show only there
/** What a card asks, or says macOS is doing about what it asks for. */
function cardTitle(ask: Ask, name: string): string {
  switch (ask.status) {
    case "macos-asking":
      return `Your Mac is asking about ${name}`;
    case "macos-private":
      return `Your Mac keeps ${name} private`;
    case "macos-refused":
      return ask.kind === "folder"
        ? `Your Mac prevented Instrument from accessing ${name}`
        : `Your Mac prevented Instrument from using ${name}`;
    case "windows-blocked":
      return `Windows is blocking Instrument from changing ${name}`;
    default:
      return ask.kind === "folder"
        ? "Can Instrument use this folder?"
        : "Can Instrument use this app?";
  }
}

/** The pane of Privacy & Security where what a card asks for is allowed. */
function privacyPane(ask: Ask) {
  return ask.kind === "folder"
    ? ("FilesAndFolders" as const)
    : privacyPaneForApp(ask.target);
}

/**
 * The ways past a folder or app macOS refused after the person allowed it:
 * for a folder, pick it in the Mac's own panel, which is a lasting grant;
 * for either, turn it on in its pane of System Settings. While Settings is
 * open the card waits the way a sign-in does, asking again each time the
 * window comes back, until macOS lets the app in (and the card goes) or the
 * person cancels.
 */
function MacFixes({
  ask,
  busy,
  chatId,
}: {
  ask: Ask;
  busy: boolean;
  chatId: ChatId;
}) {
  const [inSettings, setInSettings] = useState(false);
  const retry = useMutation(
    rpcClient.workspace.permissions.retry.mutationOptions(onAnswerError),
  );
  const systemSettings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  const tryAgain = () => {
    retry.mutate({ askId: ask.id, id: chatId });
  };
  useEffect(() => {
    if (!inSettings) {
      return;
    }
    window.addEventListener("focus", tryAgain);
    return () => {
      window.removeEventListener("focus", tryAgain);
    };
  });
  const name = askTargetName(ask.kind, ask.target);
  const choose = async () => {
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Allow",
      message: `Choose ${name} to allow Instrument to access this folder.`,
      startingAt: ask.target,
    });
    if (picked) {
      tryAgain();
    }
  };
  const isFolder = ask.kind === "folder";
  return (
    <>
      {isFolder ? (
        <AnswerButton
          disabled={busy || retry.isPending || inSettings}
          onClick={() => {
            void choose();
          }}
          pending={retry.isPending && !inSettings}
        >
          Allow
        </AnswerButton>
      ) : null}
      <Button
        className="relative"
        disabled={busy}
        onClick={() => {
          if (inSettings) {
            setInSettings(false);
            return;
          }
          systemSettings.mutate({ pane: privacyPane(ask) });
          setInSettings(true);
        }}
        size="sm"
        variant={isFolder ? "outline" : "default"}
      >
        {/* The label stays in place, unseen, under the waiting state, so
        the button keeps its width and nothing beside it moves. */}
        <span className={cn(inSettings && "invisible")}>
          Open System Settings
        </span>
        {inSettings ? (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5">
            <Spinner className="size-3.5" delay={0} />
            Cancel
          </span>
        ) : null}
      </Button>
    </>
  );
}
// oxlint-enable studio/no-os-words

// oxlint-disable studio/no-os-words -- Windows' ransomware protection blocks this way, so these show only there
/**
 * The ways past Windows' ransomware protection keeping the app's programs
 * out of a folder: let exactly those through, behind Windows' own prompt
 * for an administrator's yes, which wakes the chat to try again; or allow
 * them by hand in Windows Security, then try again.
 */
function WindowsFixes({
  ask,
  busy,
  chatId,
}: {
  ask: Ask;
  busy: boolean;
  chatId: ChatId;
}) {
  const [inSecurity, setInSecurity] = useState(false);
  const allow = useMutation(
    rpcClient.workspace.permissions.allowThroughProtection.mutationOptions({
      ...onAnswerError,
      onSuccess: ({ outcome }) => {
        if (outcome === "failed") {
          toast.error(
            "Windows didn’t take the change. Try Windows Security instead.",
          );
        }
      },
    }),
  );
  const retry = useMutation(
    rpcClient.workspace.permissions.retry.mutationOptions(onAnswerError),
  );
  const security = useMutation(
    rpcClient.features.openRansomwareProtection.mutationOptions(),
  );
  const working = busy || allow.isPending || retry.isPending;
  return (
    <>
      <AnswerButton
        disabled={working}
        onClick={() => {
          allow.mutate({ askId: ask.id, id: chatId });
        }}
        pending={allow.isPending}
      >
        Allow
      </AnswerButton>
      {inSecurity ? (
        <AnswerButton
          disabled={working}
          onClick={() => {
            retry.mutate({ askId: ask.id, id: chatId });
          }}
          pending={retry.isPending}
          variant="outline"
        >
          Try again
        </AnswerButton>
      ) : (
        <AnswerButton
          disabled={working}
          onClick={() => {
            security.mutate(undefined);
            setInSecurity(true);
          }}
          pending={false}
          variant="outline"
        >
          Open Windows Security
        </AnswerButton>
      )}
    </>
  );
}
// oxlint-enable studio/no-os-words

/**
 * One answer. Pressed, it keeps its label and the others are disabled; only a
 * wait long enough to notice (the first macOS prompt for a folder) covers the
 * label with a spinner, at the button's own width.
 */
function AnswerButton({
  children,
  className,
  disabled,
  onClick,
  pending,
  variant = "brand",
}: {
  children: string;
  className?: string;
  disabled: boolean;
  onClick: () => void;
  pending: boolean;
  variant?: "brand" | "ghost" | "outline";
}) {
  return (
    <Button
      className={cn("relative", className)}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      variant={variant}
    >
      {children}
      {pending ? (
        <Delayed>
          <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-inherit">
            <Spinner className="size-3.5" delay={0} />
          </span>
        </Delayed>
      ) : null}
    </Button>
  );
}

/** The line that marks why the chat woke: what the user answered to an ask. */
export function PermissionAnswerNote({
  data,
}: {
  data: SessionMessageDataPart.PermissionAnswerDataPart;
}) {
  const shown = askTargetName(data.kind, data.target);
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      {data.answer === "declined" ? (
        <ShieldSlashIcon className="size-3.5 shrink-0" />
      ) : (
        <ShieldCheckIcon className="size-3.5 shrink-0" />
      )}
      <span>
        {data.answer !== "declined" && data.through === "windows-protection"
          ? `Windows now lets Instrument change ${shown}.`
          : data.answer === "allowed"
            ? `You allowed ${shown} in this chat.`
            : data.answer === "always"
              ? `You allowed ${shown} for every chat.`
              : `You didn’t allow ${shown} in this chat.`}
      </span>
      {data.answer === "always" ? (
        // Where an answer for every chat is taken back.
        <button
          className="font-medium text-foreground/80 underline decoration-border underline-offset-2 hover:decoration-foreground/50"
          onClick={() => {
            openSettings({ tab: "Permissions" });
          }}
          type="button"
        >
          Settings
        </button>
      ) : null}
    </p>
  );
}
