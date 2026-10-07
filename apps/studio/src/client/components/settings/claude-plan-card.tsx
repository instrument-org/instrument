import { openLogin } from "@/client/atoms/login-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
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
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { capitalize } from "radashi";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const INSTALL_URL = "https://code.claude.com/docs/en/setup";

/** A usage window this full is worth pointing out a way past. */
const RUNNING_LOW_PERCENT = 80;

type Status = RPCOutput["claudePlan"]["refresh"];

/**
 * The Claude account as a row among the providers, beside the ChatGPT
 * account's. Signing in happens in Claude Code, Anthropic's own app, which
 * Instrument installs a copy of when the computer has none it can use. When
 * something stands in the way, the card says what and offers the one press
 * that fixes it.
 */
export function ClaudePlanCard() {
  const { data: status } = useQuery(
    rpcClient.claudePlan.live.status.experimental_liveOptions(),
  );
  const [signingIn, setSigningIn] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const connecting = useRef(false);

  // Signed in from the browser or terminal this card opened: the account is connected,
  // as from onboarding, so its recommended model becomes the default.
  useEffect(() => {
    if (!signingIn || status?.kind !== "signed-in" || connecting.current) {
      return;
    }
    connecting.current = true;
    setSigningIn(false);
    void rpcClient.claudePlan.connect.call({}).then((result) => {
      connecting.current = false;
      toast.success("Connected your Claude account", {
        description: result.modelName
          ? `New chats use ${result.modelName} from your subscription.`
          : "Its models are in the model picker.",
      });
    });
  }, [signingIn, status?.kind]);

  if (!status) {
    return null;
  }

  return (
    <Card className="gap-0 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center">
          <AIProviderIcon type="claude-plan" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate font-medium text-foreground">
            Claude account
          </h3>
          <p className="text-sm text-muted-foreground">
            {status.kind === "signed-in"
              ? [status.email, status.plan && capitalize(status.plan)]
                  .filter(Boolean)
                  .join(" · ")
              : "Pay for Claude Pro or Max? Use it here."}
          </p>
        </div>
      </div>
      <div className="pl-11">
        <Problem
          onSetup={() => {
            setSettingUp(true);
          }}
          onSigningIn={setSigningIn}
          signingIn={signingIn}
          status={status}
        />
        {status.kind === "signed-in" && <PlanUsage />}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{sourceLine(status)}</p>
          <Button
            onClick={() => {
              setSettingUp(true);
            }}
            size="sm"
            variant="outline"
          >
            Installation and account…
          </Button>
        </div>
      </div>
      <SetupDialog
        onOpenChange={setSettingUp}
        open={settingUp}
        setup={status.setup}
      />
    </Card>
  );
}

/** What stands between the person and their subscription, and the press that fixes it. */
function Problem({
  onSetup,
  onSigningIn,
  signingIn,
  status,
}: {
  onSetup: () => void;
  onSigningIn: (signingIn: boolean) => void;
  signingIn: boolean;
  status: Status;
}) {
  const openLink = useOpenExternalLink();
  const install = useMutation(rpcClient.claudePlan.install.mutationOptions());
  const signIn = useMutation(rpcClient.claudePlan.signIn.mutationOptions());
  const refresh = useMutation(rpcClient.claudePlan.refresh.mutationOptions());
  const [command, setCommand] = useState<string>();
  const [via, setVia] = useState<"browser" | "terminal">("browser");

  const installButton = status.canInstall ? (
    <Button
      key="install"
      onClick={() => {
        install.mutate({});
      }}
    >
      Install Claude Code
    </Button>
  ) : (
    <Button
      key="install"
      onClick={() => {
        openLink(INSTALL_URL, { addReferral: false });
      }}
    >
      Get Claude Code
    </Button>
  );
  const ownCopyButton = (
    <Button key="own-copy" onClick={onSetup} variant="outline">
      Use my own copy…
    </Button>
  );
  const signInButton = (
    <Button
      disabled={signIn.isPending}
      key="sign-in"
      onClick={() => {
        onSigningIn(true);
        void signIn.mutateAsync({}).then((result) => {
          setCommand(result.opened ? undefined : result.command);
          setVia(result.via);
        });
      }}
    >
      Sign in
    </Button>
  );
  const checkAgainButton = (
    <Button
      disabled={refresh.isPending}
      key="check-again"
      onClick={() => {
        refresh.mutate({});
      }}
      variant="outline"
    >
      Check again
    </Button>
  );

  if (status.install?.state === "downloading") {
    const { received, total } = status.install;
    const percent = total > 0 ? (received / total) * 100 : 0;
    return (
      <Callout title="Installing Claude Code">
        <p>
          {total > 0
            ? `${megabytes(received)} of ${megabytes(total)} MB. You can keep working while it downloads.`
            : "Starting the download."}
        </p>
        <Progress className="mt-1 w-full" value={percent} />
      </Callout>
    );
  }
  if (status.install?.state === "failed") {
    return (
      <Callout
        actions={[installButton, ownCopyButton]}
        title="Claude Code didn't install"
        warning
      >
        <p>{status.install.failed}</p>
      </Callout>
    );
  }

  switch (status.kind) {
    case "not-installed": {
      return status.setup.executablePath ? (
        <Callout
          actions={[
            <Button key="setup" onClick={onSetup}>
              Choose another…
            </Button>,
          ]}
          title="Claude Code isn't at the path you chose"
          warning
        >
          <p>Nothing runs at {status.setup.executablePath}.</p>
        </Callout>
      ) : (
        <Callout
          actions={[installButton, ownCopyButton]}
          title="Install Claude Code to use your subscription"
        >
          <p>
            {APP_NAME} runs your Claude subscription through Claude Code,
            Anthropic&apos;s own app. You sign in to it with your Claude
            account.
          </p>
        </Callout>
      );
    }
    case "outdated": {
      return (
        <Callout
          actions={
            status.source === "chosen" ? [ownCopyButton] : [installButton]
          }
          title="This Claude Code is too old"
          warning
        >
          <p>
            Claude Code {status.version} is older than {APP_NAME} needs.
            {status.source === "chosen"
              ? " Update it, or choose another."
              : ` Install the version ${APP_NAME} works with.`}
          </p>
        </Callout>
      );
    }
    case "signed-out":
    case "not-a-plan": {
      const title =
        status.kind === "signed-out"
          ? "Sign in to Claude Code"
          : "Claude Code is signed in with an API key";
      if (signingIn) {
        return (
          <Callout actions={[checkAgainButton]} title={title}>
            <p>
              {command
                ? `Run ${command} in a terminal, then come back.`
                : via === "browser"
                  ? `Finish signing in to Claude in your browser. ${APP_NAME} picks it up as soon as you're done.`
                  : `Finish signing in in the terminal and your browser. ${APP_NAME} picks it up when you come back.`}
            </p>
          </Callout>
        );
      }
      return (
        <Callout actions={[signInButton]} title={title} warning>
          <p>
            {status.kind === "signed-out"
              ? `${status.expired ? "Your Claude sign-in ran out. " : ""}Sign in with the Claude account your Pro or Max subscription is on. It opens in your browser.`
              : `${APP_NAME} uses a Claude subscription. Sign in again with your Claude account.`}
          </p>
        </Callout>
      );
    }
    case "signed-in": {
      return null;
    }
  }
}

function Callout({
  actions = [],
  children,
  title,
  warning = false,
}: {
  actions?: ReactNode[];
  children: ReactNode;
  title: string;
  warning?: boolean;
}) {
  return (
    <Alert className="mt-4 py-4" variant={warning ? "warning" : "default"}>
      {warning && <WarningIcon />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {children}
        {actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Which Claude Code is in use, for someone working out why it behaves as it does. */
function sourceLine(status: Status) {
  if (status.kind === "not-installed") {
    return "";
  }
  const whose =
    status.source === "ours"
      ? `installed by ${APP_NAME}`
      : status.source === "chosen"
        ? "the copy you chose"
        : "found on this computer";
  return `Claude Code ${status.version}, ${whose}`;
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1_000_000);
}

/** The plan's usage windows, read when the card shows and on request. */
function PlanUsage() {
  const usage = useQuery({
    ...rpcClient.claudePlan.usage.queryOptions(),
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
    <div className="mt-4 flex flex-col gap-3">
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
        <Callout
          actions={[
            <Button
              key="try"
              onClick={() => {
                openLogin({ hideManualProvider: true });
              }}
            >
              Try {APP_NAME}
            </Button>,
          ]}
          title="Your subscription is running low"
        >
          <p>
            {APP_NAME}&apos;s own models keep you going until your Claude usage
            resets.
          </p>
        </Callout>
      )}
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
    </div>
  );
}

/**
 * Which Claude Code install and which Claude sign-in to use, for a computer
 * with more than one. Each field takes a pasted path or one chosen in the
 * system's own panel.
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

  const choose = async (
    kind: "configDir" | "executable",
    set: (path: string) => void,
  ) => {
    const chosen = await rpcClient.claudePlan.pick.call({ kind });
    if (chosen) {
      set(chosen.path);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent maxWidth="36rem">
        <DialogHeader>
          <DialogTitle>Claude Code installation and account</DialogTitle>
          <DialogDescription>
            {APP_NAME} installs and uses its own copy of Claude Code. Choose
            another here when you want {APP_NAME} to use a copy or a Claude
            sign-in of your own. Leave a field empty to use the default.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <PathField
            description="The claude program to run."
            id="claude-executable"
            label="Claude Code installation"
            onChange={setExecutablePath}
            onChoose={() => {
              void choose("executable", setExecutablePath);
            }}
            placeholder={`The copy ${APP_NAME} installs`}
            value={executablePath}
          />
          <PathField
            description="A folder you signed in to Claude with through CLAUDE_CONFIG_DIR, for a second Claude account. Your usual sign-in needs nothing here."
            id="claude-config-dir"
            label="Account folder"
            onChange={setConfigDir}
            onChoose={() => {
              void choose("configDir", setConfigDir);
            }}
            placeholder="Your usual Claude sign-in"
            value={configDir}
          />
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

function PathField({
  description,
  id,
  label,
  onChange,
  onChoose,
  placeholder,
  value,
}: {
  description: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onChoose: () => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1"
          id={id}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          value={value}
        />
        <Button onClick={onChoose} variant="outline">
          Choose…
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
