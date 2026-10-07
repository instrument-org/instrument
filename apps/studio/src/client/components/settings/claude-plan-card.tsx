import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Progress } from "@/client/components/ui/progress";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { capitalize } from "radashi";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const INSTALL_URL = "https://code.claude.com/docs/en/setup";

type Status = RPCOutput["claudePlan"]["refresh"];

/**
 * The Claude plan as a row among the providers, beside the ChatGPT plan's. It
 * only reports what the Claude Code CLI on this computer says: installing and
 * signing in both happen in the CLI, never in the app.
 */
export function ClaudePlanCard() {
  const { data: status } = useQuery(
    rpcClient.claudePlan.live.status.experimental_liveOptions(),
  );
  const openLink = useOpenExternalLink();
  const signIn = useMutation(rpcClient.claudePlan.signIn.mutationOptions());
  const refresh = useMutation(rpcClient.claudePlan.refresh.mutationOptions());
  const [command, setCommand] = useState<string | undefined>();
  const connecting = useRef(false);

  // Signed in from the terminal this card opened: the account is connected,
  // as from onboarding, so its recommended model becomes the default.
  useEffect(() => {
    if (
      command === undefined ||
      status?.kind !== "signed-in" ||
      connecting.current
    ) {
      return;
    }
    connecting.current = true;
    setCommand(undefined);
    void rpcClient.claudePlan.connect.call({}).then((result) => {
      connecting.current = false;
      toast.success("Connected your Claude account", {
        description: result.modelName
          ? `New chats use ${result.modelName} from your subscription.`
          : "Its models are in the model picker.",
      });
    });
  }, [command, status?.kind]);
  const [settingUp, setSettingUp] = useState(false);

  if (!status) {
    return null;
  }

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center">
            <AIProviderIcon type="claude-plan" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate font-medium text-foreground">
              Claude account
            </h3>
            <p className="text-sm text-muted-foreground">
              {describe(status, command)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.kind === "not-installed" && (
            <Button
              onClick={() => {
                openLink(INSTALL_URL, { addReferral: false });
              }}
              variant="outline"
            >
              Install Claude Code
            </Button>
          )}
          {(status.kind === "signed-out" || status.kind === "not-a-plan") && (
            <Button
              disabled={signIn.isPending}
              onClick={() => {
                void signIn.mutateAsync({}).then((result) => {
                  setCommand(result.opened ? "opened" : result.command);
                });
              }}
            >
              Sign in
            </Button>
          )}
        </div>
      </div>
      {status.kind === "signed-in" && <PlanUsage />}
      <div className="mt-2 flex items-center gap-1 pl-9">
        {status.kind !== "signed-in" && (
          <Button
            className="text-muted-foreground"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate({});
            }}
            size="xs"
            variant="ghost"
          >
            Check again
          </Button>
        )}
        <Button
          className="text-muted-foreground"
          onClick={() => {
            setSettingUp(true);
          }}
          size="xs"
          variant="ghost"
        >
          Installation and account…
        </Button>
      </div>
      <SetupDialog
        onOpenChange={setSettingUp}
        open={settingUp}
        setup={status.setup}
      />
    </Card>
  );
}

/** The plan's usage windows, read when the card shows and on request. */
function PlanUsage() {
  const usage = useQuery({
    ...rpcClient.claudePlan.usage.queryOptions(),
    staleTime: 60_000,
  });
  const windows = usage.data?.windows ?? [];

  return (
    <div className="mt-4 flex flex-col gap-3 pl-11">
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
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {usage.isError
            ? "Couldn't read your plan's usage from Claude Code."
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
    </div>
  );
}

/**
 * Which Claude Code install and config folder to use, for a computer with more
 * than one, or an install we did not find.
 */
function SetupDialog({
  onOpenChange,
  open,
  setup,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  setup: Status["setup"];
}) {
  const save = useMutation(rpcClient.claudePlan.setSetup.mutationOptions());
  const [executablePath, setExecutablePath] = useState(
    setup.executablePath ?? "",
  );
  const [configDir, setConfigDir] = useState(setup.configDir ?? "");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent maxWidth="34rem">
        <DialogHeader>
          <DialogTitle>Claude Code installation and account</DialogTitle>
          <DialogDescription>
            Choose an installation and account when you have more than one.
            Leave either blank to use the default.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="claude-executable">Claude Code installation</Label>
            <Input
              id="claude-executable"
              onChange={(event) => {
                setExecutablePath(event.target.value);
              }}
              placeholder="~/.local/bin/claude"
              value={executablePath}
            />
            <p className="text-xs text-muted-foreground">
              The full path to the claude executable.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="claude-config-dir">Account folder</Label>
            <Input
              id="claude-config-dir"
              onChange={(event) => {
                setConfigDir(event.target.value);
              }}
              placeholder="~/.claude"
              value={configDir}
            />
            <p className="text-xs text-muted-foreground">
              The config folder holding the Claude sign-in to use, as
              CLAUDE_CONFIG_DIR names it.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              void save.mutateAsync({ configDir, executablePath }).then(() => {
                onOpenChange(false);
              });
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(status: Status, command: string | undefined) {
  switch (status.kind) {
    case "not-installed": {
      return status.setup.executablePath
        ? `Nothing runs at ${status.setup.executablePath}. Check the path under Installation and account.`
        : "Pay for Claude Pro or Max? Use it here, through Claude Code. Install it and sign in, then come back. Already installed somewhere else? Choose where under Installation and account.";
    }
    case "outdated": {
      return `Claude Code ${status.version} is too old for ${APP_NAME}. Update it, then come back.`;
    }
    case "signed-out": {
      if (command === "opened") {
        return "Finish signing in to Claude in the terminal and your browser, then come back.";
      }
      if (command) {
        return `Run ${command} in a terminal, then come back.`;
      }
      return "Pay for Claude Pro or Max? Use it here. Sign in to Claude Code with the account your subscription is on.";
    }
    case "not-a-plan": {
      return "Claude Code is signed in with an API key or a cloud provider, not a Claude subscription. Sign in again with your Claude account.";
    }
    case "signed-in": {
      // The CLI names the subscription in lowercase: `pro`, `max`.
      return [status.email, status.plan && capitalize(status.plan)]
        .filter(Boolean)
        .join(" · ");
    }
  }
}
