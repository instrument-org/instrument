import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { toast } from "sonner";

type Status = RPCOutput["features"]["computerUse"]["status"];

/**
 * Walks the person through what Computer Use needs before the agent is
 * offered it: Accessibility, Screen Recording, then a test through the
 * driver. All three stay in view, one line each, and only the step to do next
 * is open, so the whole path is visible at a glance. Every step reads its
 * state again whenever the window regains focus, since the grants are given
 * in System Settings and coming back here is when they change.
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
  const permissions = data.permissions;
  const current = !permissions.supported
    ? "test"
    : !permissions.accessibility
      ? "accessibility"
      : permissions.screenRecording !== "granted"
        ? "screen-recording"
        : "test";

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
            : "Not set up yet. The agent can't use other apps until these steps are done."}
        </p>
      </div>

      <div className="space-y-2">
        {permissions.supported && (
          <>
            <AccessibilityStep
              data={data}
              done={permissions.accessibility}
              open={current === "accessibility"}
            />
            <ScreenRecordingStep
              data={data}
              done={permissions.screenRecording === "granted"}
              open={current === "screen-recording"}
            />
          </>
        )}
        <TestStep
          appName={data.appName}
          number={permissions.supported ? 3 : 1}
          onFinished={() => {
            void refetchStatus();
          }}
          open={current === "test"}
          ready={data.ready}
        />
      </div>
    </div>
  );
}

function AccessibilityStep({
  data,
  done,
  open,
}: {
  data: Status;
  done: boolean;
  open: boolean;
}) {
  const request = useMutation(
    rpcClient.features.computerUse.requestAccessibility.mutationOptions(),
  );
  const openSettings = useMutation(
    rpcClient.features.computerUse.openSettings.mutationOptions(),
  );
  const pane = accessibilityPaneName(data.macOSMajor);

  return (
    <Step
      description={`Lets ${data.appName} read and use the controls in other apps' windows.`}
      done={done}
      number={1}
      open={open}
      title={pane}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-56 flex-1 space-y-3">
          <p>
            Choose Allow, then turn on {data.appName} in the {pane} list that
            macOS opens.
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
                openSettings.mutate({ permission: "accessibility" });
              }}
              size="sm"
              variant="outline"
            >
              Open {pane}
            </Button>
          </div>
        </div>
        {request.isSuccess && (
          <PromptHint choose="Open System Settings" other="Deny">
            “{data.appName}” would like to control this computer using
            accessibility features.
          </PromptHint>
        )}
      </div>
    </Step>
  );
}

function ScreenRecordingStep({
  data,
  done,
  open,
}: {
  data: Status;
  done: boolean;
  open: boolean;
}) {
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
          toast(`Quit and reopen ${data.appName} to finish.`);
        }
      },
    }),
  );
  const pane = screenRecordingPaneName(data.macOSMajor);
  const asked = request.isSuccess || openSettings.isSuccess;

  return (
    <Step
      description={`Lets ${data.appName} see what other apps' windows show.`}
      done={done}
      number={2}
      open={open}
      title={pane}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-56 flex-1 space-y-3">
          <p>
            {asked
              ? `Turn on ${data.appName} in the ${pane} list, then relaunch. macOS applies this one only after a restart, and ${data.appName} reopens here.`
              : `Choose Allow, then turn on ${data.appName} in the ${pane} list.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {asked ? (
              <Button
                disabled={relaunch.isPending}
                onClick={() => {
                  relaunch.mutate(undefined);
                }}
                size="sm"
              >
                {data.canRelaunch ? `Relaunch ${data.appName}` : "Check again"}
              </Button>
            ) : (
              <Button
                disabled={request.isPending}
                onClick={() => {
                  request.mutate(undefined);
                }}
                size="sm"
              >
                Allow
              </Button>
            )}
            <Button
              onClick={() => {
                openSettings.mutate({ permission: "screen-recording" });
              }}
              size="sm"
              variant="outline"
            >
              Open {pane}
            </Button>
          </div>
        </div>
        {request.isSuccess && (
          <PromptHint choose="Open System Settings" other="Deny">
            “{data.appName}” would like to record this computer's screen and
            audio.
          </PromptHint>
        )}
      </div>
    </Step>
  );
}

function TestStep({
  appName,
  number,
  onFinished,
  open,
  ready,
}: {
  appName: string;
  number: number;
  onFinished: () => void;
  open: boolean;
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
      description="Watch the agent's cursor cross this window and see what it sees. It clicks nothing and saves nothing."
      done={result?.ok === true}
      failed={result?.ok === false}
      number={number}
      open={open}
      title="Try it"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-56 flex-1 space-y-3">
          {result?.ok === false && (
            <p className="text-destructive">
              That didn't work: {result.detail}
            </p>
          )}
          {result?.ok === true && (
            <figure className="space-y-1.5">
              <img
                alt="Your screen, as the agent sees it"
                className="w-full max-w-80 rounded-md border"
                src={result.image}
              />
              <figcaption className="text-muted-foreground">
                Your screen as the agent sees it. This picture is gone when you
                leave this page.
              </figcaption>
            </figure>
          )}
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
        {isMacOS() && verify.isPending && (
          <PromptHint choose="Allow" other="Open System Settings">
            “{appName}” is requesting to bypass the system private window picker
            and directly access your screen and audio.
          </PromptHint>
        )}
      </div>
    </Step>
  );
}

/**
 * A small likeness of the system prompt the button just raised, beside the
 * step, with the button to choose marked: the real prompt covers this window,
 * and this says which answer the agent needs. Only after the press, since
 * before it there is nothing on screen to recognize.
 */
function PromptHint({
  children,
  choose,
  other,
}: {
  children: ReactNode;
  choose: string;
  other: string;
}) {
  return (
    <aside className="w-48 shrink-0 space-y-2 rounded-xl border bg-muted p-3 text-xs">
      <p className="text-muted-foreground">macOS asks:</p>
      <p className="leading-snug font-medium">{children}</p>
      <div className="flex flex-col gap-1">
        <span className="rounded-full bg-primary py-0.5 text-center text-primary-foreground">
          {choose} ← choose this
        </span>
        <span className="rounded-full bg-background py-0.5 text-center text-muted-foreground">
          {other}
        </span>
      </div>
    </aside>
  );
}

function Step({
  children,
  description,
  done,
  failed = false,
  number,
  open,
  title,
}: {
  children: ReactNode;
  description: string;
  done: boolean;
  failed?: boolean;
  number: number;
  open: boolean;
  title: string;
}) {
  return (
    <Card className="flex-row items-start gap-3 p-4">
      <span
        aria-label={done ? "Done" : `Step ${number}`}
        className={
          done
            ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-success-700 text-white dark:bg-success-500"
            : failed
              ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive text-xs font-medium text-white"
              : open
                ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
                : "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground"
        }
      >
        {done ? <CheckIcon className="size-3.5" weight="bold" /> : number}
      </span>
      <div className="flex-1 space-y-3 text-sm">
        <div className="pt-0.5">
          <p
            className={
              open || done ? "font-medium" : "font-medium text-muted-foreground"
            }
          >
            {title}
          </p>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {open && children}
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
