import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { useAtomValue } from "jotai";
import { openLogin } from "@/client/atoms/login-modal";
import { settingAnchor } from "@/client/components/settings/settings-index";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { ClaudeSignInCode } from "@/client/components/claude-sign-in-code";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { DropdownMenuItem } from "@/client/components/ui/dropdown-menu";
import { Progress } from "@/client/components/ui/progress";
import {
  ProviderMoreMenu,
  DISABLED_LINE,
  DisableItem,
  useProviderSwitch,
} from "@/client/components/settings/provider-switch";
import { cn } from "@/client/lib/utils";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import {
  AIProviderConfigIdSchema,
  APP_NAME,
  CLAUDE_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { capitalize } from "radashi";
import { useClaudeConnect } from "@/client/hooks/use-connect";
import { showConnectToast } from "@/client/lib/connect-toast";
import { useEffect, useState } from "react";

const CLAUDE_ID = AIProviderConfigIdSchema.parse(
  CLAUDE_ACCOUNT_PROVIDER_CONFIG.id,
);

/** A usage window this full is worth pointing out a way past. */
const RUNNING_LOW_PERCENT = 80;

type Status = RPCOutput["claudeAccount"]["signIn"]["status"];

/**
 * The Claude account as a row among the providers, laid out like the ChatGPT
 * account's. One press connects it: Instrument installs its own copy of
 * Claude Code when it needs to, and the sign-in finishes on Anthropic's page
 * in the browser. Usage opens on request, since reading it starts Claude Code.
 */
export function ClaudeAccountCard() {
  const flow = useClaudeConnect();
  const { status } = flow;
  const signOut = useMutation(
    rpcClient.claudeAccount.signOut.mutationOptions(),
  );
  const providerSwitch = useProviderSwitch();
  const settings = useAtomValue(settingsModalAtom);
  const [showUsage, setShowUsage] = useState(
    settings?.providerUsage === "claude-account",
  );
  useEffect(() => {
    if (settings?.providerUsage === "claude-account") {
      setShowUsage(true);
    }
  }, [settings]);
  if (!status) {
    return null;
  }

  const installing = status.install?.state === "downloading";
  const waiting = status.signingIn || installing || flow.waiting;
  const off = status.kind === "signed-in" && providerSwitch.isOff(CLAUDE_ID);

  return (
    <Card className="gap-0 p-4">
      <div
        className="flex items-start justify-between gap-4"
        {...settingAnchor("claude-account")}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-start gap-3",
            off && "opacity-50 grayscale",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center">
            <AIProviderIcon type="claude-account" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">
              Claude account
            </h3>
            <p className="text-sm text-muted-foreground">
              {off
                ? DISABLED_LINE
                : flow.phase === "checking"
                  ? "Checking your Claude plan."
                  : describe(status)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {off ? (
            <Button
              onClick={() => {
                providerSwitch.setEnabled(CLAUDE_ID, true);
              }}
              variant="outline"
            >
              Enable
            </Button>
          ) : status.kind === "signed-in" ? (
            <Button
              aria-expanded={showUsage}
              onClick={() => {
                setShowUsage(!showUsage);
              }}
              variant="outline"
            >
              <CaretRightIcon
                className={
                  showUsage
                    ? "rotate-90 transition-transform"
                    : "transition-transform"
                }
              />
              Usage
            </Button>
          ) : null}
          {status.kind === "signed-in" ? (
            <ProviderMoreMenu label="Claude account">
              {!off && (
                <DisableItem
                  onSelect={() => {
                    providerSwitch.setEnabled(CLAUDE_ID, false);
                  }}
                />
              )}
              <DropdownMenuItem
                disabled={signOut.isPending}
                onSelect={() => {
                  signOut.mutate({});
                }}
              >
                Sign out
              </DropdownMenuItem>
            </ProviderMoreMenu>
          ) : (
            <BrowserHandoffButton
              onCancel={() => {
                if (flow.waiting) {
                  flow.cancel();
                  return;
                }
                // A sign-in started somewhere else.
                void rpcClient.claudeAccount.cancelSignIn.call({});
              }}
              onStart={() => {
                void flow.start().then((result) => {
                  if (result) {
                    showConnectToast(result, "claude");
                  }
                });
              }}
              waiting={waiting}
            >
              Continue with Claude
            </BrowserHandoffButton>
          )}
        </div>
      </div>
      {status.kind !== "signed-in" && status.signingIn && status.signInLink && (
        <ClaudeSignInCode className="mt-2 pl-11" link={status.signInLink} />
      )}
      {status.kind === "signed-in" && !off && showUsage && <PlanUsage />}
    </Card>
  );
}

/** One line for where the account stands and, when it needs it, what to do. */
function describe(status: Status) {
  if (status.install?.state === "downloading") {
    const { received, total } = status.install;
    const percent = total > 0 ? Math.round((received / total) * 100) : 0;
    return `Getting Claude Code ready, ${percent}% done.`;
  }
  if (status.finishing) {
    return "Connecting your Claude account.";
  }
  if (status.signingIn) {
    return "Finish signing in to Claude in your browser.";
  }
  if (status.install?.state === "failed") {
    return `Claude Code didn't install: ${status.install.failed}`;
  }
  switch (status.kind) {
    case "signed-in": {
      // Claude Code names the subscription in lowercase: `pro`, `max`.
      return [status.email, status.plan && capitalize(status.plan)]
        .filter(Boolean)
        .join(" · ");
    }
    case "signed-out": {
      return status.expired
        ? "You're signed out. Continue with Claude to sign in again."
        : "Pay for Claude Pro or Max? Use it here.";
    }
    case "not-a-plan": {
      return "This sign-in uses an API key rather than a Claude subscription. Continue with Claude to sign in with your Claude account.";
    }
    case "not-installed": {
      return status.canInstall
        ? "Pay for Claude Pro or Max? Use it here."
        : `Claude Code doesn't run on this computer, so ${APP_NAME} can't use a Claude subscription here.`;
    }
  }
}

/** The subscription's usage windows, read when opened and on request. */
function PlanUsage() {
  const usage = useQuery({
    ...rpcClient.claudeAccount.usage.queryOptions(),
    staleTime: 60_000,
  });
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const windows = usage.data?.windows ?? [];
  const runningLow = windows.some(
    (window) => window.used >= RUNNING_LOW_PERCENT,
  );

  return (
    <div className="mt-4 flex flex-col gap-3 pl-11">
      {usage.isPending && (
        <p className="text-sm text-muted-foreground">Reading your usage…</p>
      )}
      {windows.map((window) => (
        <div className="flex flex-col gap-1.5" key={window.label}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium text-foreground">
              {window.label} usage
            </span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round(window.used)}% used
            </span>
          </div>
          <Progress value={window.used} />
          {window.resetsAt && (
            <p className="text-xs text-muted-foreground">
              Resets {format(new Date(window.resetsAt), "MMM d 'at' h:mm a")}
            </p>
          )}
        </div>
      ))}
      {runningLow && hasToken === false && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-sm text-muted-foreground">
            Running low? {APP_NAME}&apos;s own models keep you going until your
            Claude usage resets.
          </p>
          <Button
            onClick={() => {
              openLogin({ instrumentOnly: true });
            }}
            size="sm"
          >
            Try {APP_NAME}
          </Button>
        </div>
      )}
      {!usage.isPending && (
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>
            {usage.isError
              ? "Couldn't read your subscription's usage from Claude Code."
              : `Your Claude account's usage, including outside ${APP_NAME}.`}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {usage.dataUpdatedAt > 0 && (
              <span>Updated {format(usage.dataUpdatedAt, "h:mm a")}</span>
            )}
            <Button
              aria-label="Refresh usage"
              disabled={usage.isFetching}
              onClick={() => {
                void usage.refetch();
              }}
              size="icon-sm"
              variant="ghost"
            >
              <ArrowClockwiseIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
