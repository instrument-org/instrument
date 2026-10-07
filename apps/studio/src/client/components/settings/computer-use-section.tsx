import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { CircleIcon } from "@phosphor-icons/react/Circle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { toast } from "sonner";

type Status = RPCOutput["features"]["computerUse"]["status"];

/**
 * Walks the person through what Computer Use needs before the agent is
 * offered it: Accessibility, Screen Recording, then one real capture through
 * the driver. Every step reads its state again whenever the window regains
 * focus, since the grants are given in System Settings and coming back here is
 * when they change.
 */
export function ComputerUseSection() {
  const status = useQuery(rpcClient.features.computerUse.status.queryOptions());
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const refetchStatus = status.refetch;
  useEffect(() => {
    void refetchStatus();
  }, [windowFocusChanged, refetchStatus]);

  const data = status.data;
  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Computer Use</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Lets the agent work in the other apps on this computer: read their
          windows, then click, type, and scroll in them, mostly without moving
          your pointer.
        </p>
        <p className="mt-3 text-sm">
          {data.ready
            ? "Set up. The agent can use the apps on this computer."
            : "Not set up yet. The agent can't use other apps until the steps below are done."}
        </p>
      </div>

      <div className="space-y-4">
        {data.permissions.supported && (
          <>
            <AccessibilityStep data={data} />
            <ScreenRecordingStep data={data} />
          </>
        )}
        <TestStep
          appName={data.appName}
          number={data.permissions.supported ? 3 : 1}
          ready={data.ready}
          onFinished={() => {
            void refetchStatus();
          }}
        />
      </div>
    </div>
  );
}

function AccessibilityStep({ data }: { data: Status }) {
  const request = useMutation(
    rpcClient.features.computerUse.requestAccessibility.mutationOptions(),
  );
  const openSettings = useMutation(
    rpcClient.features.computerUse.openSettings.mutationOptions(),
  );
  if (!data.permissions.supported) {
    return null;
  }
  const done = data.permissions.accessibility;
  const pane = accessibilityPaneName(data.macOSMajor);

  return (
    <Step
      description="Lets Instrument read the controls in other apps' windows and click and type in them."
      done={done}
      number={1}
      title={pane}
    >
      {!done && (
        <>
          <p>
            Choose Allow. macOS shows the prompt below; choose Open System
            Settings in it, then turn on {data.appName} in the list.
          </p>
          <SystemPrompt
            body="Grant access to this application in Privacy & Security settings."
            buttons={["Open System Settings", "Deny"]}
            highlight="Open System Settings"
            title={`“${data.appName}” would like to control this computer using accessibility features.`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={request.isPending}
              onClick={() => {
                request.mutate(undefined);
              }}
              size="sm"
            >
              Allow
            </Button>
            <Button
              onClick={() => {
                openSettings.mutate({ permission: "accessibility" });
              }}
              size="sm"
              variant="outline"
            >
              Open {pane}
            </Button>
          </div>
        </>
      )}
    </Step>
  );
}

function ScreenRecordingStep({ data }: { data: Status }) {
  const request = useMutation(
    rpcClient.features.computerUse.requestScreenRecording.mutationOptions(),
  );
  const openSettings = useMutation(
    rpcClient.features.computerUse.openSettings.mutationOptions(),
  );
  const relaunch = useMutation(
    rpcClient.features.computerUse.relaunch.mutationOptions({
      onSuccess: ({ outcome }) => {
        if (outcome === "unsupported") {
          toast("Quit and reopen Instrument to finish.");
        }
      },
    }),
  );
  if (!data.permissions.supported) {
    return null;
  }
  const done = data.permissions.screenRecording === "granted";
  const pane = screenRecordingPaneName(data.macOSMajor);

  return (
    <Step
      description="Lets Instrument see what other apps' windows show."
      done={done}
      number={2}
      title={pane}
    >
      {!done && (
        <>
          <p>
            Choose Allow. macOS asks only the first time; after that, the pane
            opens with {data.appName} in its list, and you turn it on there.
          </p>
          <SystemPrompt
            body="Grant access to this application in Privacy & Security settings."
            buttons={["Open System Settings", "Deny"]}
            highlight="Open System Settings"
            title={`“${data.appName}” would like to record this computer's screen and audio.`}
          />
          <p>
            macOS applies this grant only after {data.appName} restarts. Once it
            is on, relaunch, and {data.appName} reopens on this screen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={request.isPending}
              onClick={() => {
                request.mutate(undefined);
              }}
              size="sm"
            >
              Allow
            </Button>
            <Button
              onClick={() => {
                openSettings.mutate({ permission: "screen-recording" });
              }}
              size="sm"
              variant="outline"
            >
              Open {pane}
            </Button>
            <Button
              disabled={relaunch.isPending}
              onClick={() => {
                relaunch.mutate(undefined);
              }}
              size="sm"
              variant="outline"
            >
              {data.canRelaunch ? `Relaunch ${data.appName}` : "Check again"}
            </Button>
          </div>
        </>
      )}
    </Step>
  );
}

function TestStep({
  appName,
  number,
  onFinished,
  ready,
}: {
  appName: string;
  number: number;
  onFinished: () => void;
  ready: boolean;
}) {
  const verify = useMutation(
    rpcClient.features.computerUse.verify.mutationOptions({
      onSettled: onFinished,
    }),
  );
  const result = verify.data;

  return (
    <Step
      description="Watch the agent's cursor move across this window, then see the picture of your screen it takes. It moves only a drawn cursor, clicks nothing, and keeps the picture nowhere."
      done={result?.ok === true}
      doneLabel="Passed"
      failed={result?.ok === false}
      number={number}
      title="Try it"
    >
      {isMacOS() && result?.ok !== true && (
        <>
          <p>
            The first time, macOS asks once more, so the agent can see windows
            directly. Choose Allow.
          </p>
          <SystemPrompt
            body={`This will allow ${appName} to record your screen and system audio, including personal or sensitive information that may be visible or audible.`}
            buttons={["Allow", "Open System Settings"]}
            highlight="Allow"
            title={`“${appName}” is requesting to bypass the system private window picker and directly access your screen and audio.`}
          />
        </>
      )}
      {result?.ok === false && (
        <p className="text-destructive">That didn't work: {result.detail}</p>
      )}
      {result?.ok === true && (
        <figure className="space-y-1.5">
          <img
            alt="Your screen, as the agent sees it"
            className="w-full max-w-md rounded-md border"
            src={result.image}
          />
          <figcaption className="text-muted-foreground">
            This is your screen as the agent sees it. The picture stays on this
            page and is gone when you leave it.
          </figcaption>
        </figure>
      )}
      <div>
        <Button
          disabled={!ready || verify.isPending}
          onClick={() => {
            verify.mutate(undefined);
          }}
          size="sm"
          variant={result?.ok ? "outline" : "default"}
        >
          {verify.isPending
            ? "Watch the cursor…"
            : result?.ok
              ? "Run it again"
              : "Run a test"}
        </Button>
      </div>
    </Step>
  );
}

/**
 * A drawing of the system prompt the person is about to meet, with the button
 * to choose ringed: they see the real one over this window and should know it
 * on sight. A likeness rather than a copy; macOS words these per version.
 */
function SystemPrompt({
  body,
  buttons,
  highlight,
  title,
}: {
  body: string;
  buttons: string[];
  highlight: string;
  title: string;
}) {
  return (
    <div
      aria-label="What the macOS prompt looks like"
      className="max-w-72 space-y-3 rounded-2xl border bg-muted p-4"
      role="img"
    >
      <div className="size-9 rounded-lg bg-primary/20" />
      <p className="text-xs leading-snug font-semibold">{title}</p>
      <p className="text-xs leading-snug text-muted-foreground">{body}</p>
      <div className="space-y-1.5">
        {buttons.map((label) => (
          <div
            className={
              label === highlight
                ? "rounded-full bg-primary py-1 text-center text-xs text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-muted"
                : "rounded-full bg-background py-1 text-center text-xs"
            }
            key={label}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Step({
  children,
  description,
  done,
  doneLabel = "Allowed",
  failed = false,
  number,
  title,
}: {
  children?: ReactNode;
  description: string;
  done: boolean;
  doneLabel?: string;
  failed?: boolean;
  number: number;
  title: string;
}) {
  const Icon = done ? CheckCircleIcon : failed ? WarningCircleIcon : CircleIcon;
  return (
    <Card className="flex-row items-start gap-3 p-4">
      <Icon
        className={
          done
            ? "mt-0.5 size-5 shrink-0 text-success-700 dark:text-success-300"
            : failed
              ? "mt-0.5 size-5 shrink-0 text-destructive"
              : "mt-0.5 size-5 shrink-0 text-muted-foreground"
        }
        weight={done ? "fill" : "regular"}
      />
      <div className="flex-1 space-y-2 text-sm">
        <div>
          <p className="font-medium">
            {number}. {title}
            {done && doneLabel && (
              <span className="ml-2 font-normal text-muted-foreground">
                {doneLabel}
              </span>
            )}
          </p>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </Card>
  );
}

// Renamed in macOS 27; the deep link still lands on it.
function accessibilityPaneName(major: number | undefined) {
  return major !== undefined && major >= 27
    ? "Device Control and Data Access"
    : "Accessibility";
}

function screenRecordingPaneName(major: number | undefined) {
  return major !== undefined && major >= 15
    ? "Screen & System Audio Recording"
    : "Screen Recording";
}
