import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

type Status = RPCOutput["features"]["computerUse"]["status"];

/** How often a step waiting on a switch in System Settings checks it. */
const WAITING_POLL_MS = 1000;

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
          With Computer Use, the agent can work in your other apps the way you
          would, usually without moving your pointer.
        </p>
        <p className="mt-3 text-sm">
          {data.ready
            ? "You're all set. The agent can use your other apps."
            : "Finish these steps so the agent can use your other apps."}
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
  const focus = useMutation(
    rpcClient.features.computerUse.focus.mutationOptions(),
  );
  const pane = accessibilityPaneName(data.macOSMajor);
  const asked = request.isSuccess || openSettings.isSuccess;

  // macOS applies this grant at once, so while the switch is waited on the
  // step checks it, and brings the app back over System Settings when it
  // turns on.
  useQuery({
    ...rpcClient.features.computerUse.status.queryOptions(),
    enabled: asked && !done,
    refetchInterval: WAITING_POLL_MS,
  });
  const focusApp = focus.mutate;
  useEffect(() => {
    if (asked && done) {
      focusApp(undefined);
      toast.success(`${pane} is on.`);
    }
  }, [asked, done, focusApp, pane]);

  return (
    <Step
      description="The agent needs this to click and type in other apps."
      done={done}
      number={1}
      open={open}
      title={pane}
    >
      <p>Press Allow, then turn on {data.appName} in the list that opens.</p>
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
          Open System Settings
        </Button>
      </div>
      {asked && (
        <Walkthrough>
          <PromptMock
            choose="Open System Settings"
            label="macOS asks"
            other="Deny"
          >
            “{data.appName}” would like to control this computer using
            accessibility features.
          </PromptMock>
          <PaneMock appName={data.appName} label="Then" pane={pane} />
        </Walkthrough>
      )}
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
      description="The agent needs this to see what's in other apps' windows."
      done={done}
      number={2}
      open={open}
      title={pane}
    >
      <p>
        Press Allow, turn on {data.appName} in the list, then press Quit &amp;
        Reopen. You'll come right back here.
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
          Open System Settings
        </Button>
      </div>
      {asked && (
        <>
          <Walkthrough>
            <PromptMock
              choose="Open System Settings"
              label="macOS may ask"
              other="Deny"
            >
              “{data.appName}” would like to record this computer's screen and
              audio.
            </PromptMock>
            <PaneMock appName={data.appName} label="Then" pane={pane} />
            <PromptMock choose="Quit & Reopen" label="Last" other="Later">
              “{data.appName}” may not be able to record the contents of your
              screen until it is quit.
            </PromptMock>
          </Walkthrough>
          <p className="text-muted-foreground">
            {data.canRelaunch ? (
              <>
                Pressed Later?{" "}
                <button
                  className="underline underline-offset-2"
                  disabled={relaunch.isPending}
                  onClick={() => {
                    relaunch.mutate(undefined);
                  }}
                  type="button"
                >
                  Relaunch now
                </button>
                .
              </>
            ) : (
              `Pressed Later? Quit and reopen ${data.appName} yourself.`
            )}
          </p>
        </>
      )}
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
      description="Watch the agent's cursor move across this window, then see what the agent sees."
      done={result?.ok === true}
      failed={result?.ok === false}
      number={number}
      open={open}
      title="Try it"
    >
      {result?.ok === false && (
        <p className="text-destructive">That didn't work: {result.detail}</p>
      )}
      {result?.ok === true && <Capture image={result.image} />}
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
      {isMacOS() && verify.isPending && (
        <Walkthrough>
          <PromptMock
            choose="Allow"
            label="macOS may ask"
            other="Open System Settings"
          >
            “{appName}” is requesting to bypass the system private window picker
            and directly access your screen and audio.
          </PromptMock>
        </Walkthrough>
      )}
    </Step>
  );
}

/** The window as the agent captured it, which opens larger when pressed. */
function Capture({ image }: { image: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <figure className="space-y-1.5">
      <button
        className="block overflow-hidden rounded-md border"
        onClick={() => {
          setZoomed(true);
        }}
        type="button"
      >
        <img
          alt="This window, as the agent sees it"
          className="w-72"
          src={image}
        />
      </button>
      <figcaption className="text-muted-foreground">
        This is this window as the agent sees it. The picture isn't saved
        anywhere.
      </figcaption>
      <Dialog onOpenChange={setZoomed} open={zoomed}>
        <DialogContent maxWidth="60rem">
          <DialogTitle>What the agent sees</DialogTitle>
          <img
            alt="This window, as the agent sees it"
            className="w-full rounded-md border"
            src={image}
          />
        </DialogContent>
      </Dialog>
    </figure>
  );
}

/**
 * Small likenesses of what macOS shows next, in order, with the control to
 * press marked: the real prompts and panes cover this window, and these say
 * which answer the agent needs. Shown only after the press that raises them.
 */
function Walkthrough({ children }: { children: ReactNode }) {
  return <ol className="flex flex-wrap items-start gap-3">{children}</ol>;
}

function MockFrame({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <li className="w-52 space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="space-y-2 rounded-xl border bg-popover p-3 text-xs text-popover-foreground shadow-sm">
        {children}
      </div>
    </li>
  );
}

function PromptMock({
  children,
  choose,
  label,
  other,
}: {
  children: ReactNode;
  choose: string;
  label: string;
  other: string;
}) {
  return (
    <MockFrame label={label}>
      <p className="leading-snug font-medium">{children}</p>
      <div className="flex flex-col gap-1.5">
        <span className="rounded-full bg-brand-600 py-0.5 text-center text-white ring-2 ring-brand-500 ring-offset-2 ring-offset-popover">
          {choose}
        </span>
        <span className="rounded-full bg-muted py-0.5 text-center text-muted-foreground">
          {other}
        </span>
      </div>
    </MockFrame>
  );
}

/** A System Settings privacy list, with this app's switch turned on. */
function PaneMock({
  appName,
  label,
  pane,
}: {
  appName: string;
  label: string;
  pane: string;
}) {
  return (
    <MockFrame label={label}>
      <p className="font-medium">{pane}</p>
      <div className="divide-y rounded-lg bg-muted/60">
        <PaneRow />
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="size-3.5 shrink-0 rounded bg-brand-600" />
          <span className="min-w-0 flex-1 truncate">{appName}</span>
          <MockSwitch on />
        </div>
        <PaneRow />
      </div>
    </MockFrame>
  );
}

function PaneRow() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <span className="size-3.5 shrink-0 rounded bg-muted-foreground/30" />
      <span className="h-1.5 flex-1 rounded-full bg-muted-foreground/20" />
      <MockSwitch />
    </div>
  );
}

function MockSwitch({ on = false }: { on?: boolean }) {
  return (
    <span
      className={
        on
          ? "flex h-3.5 w-6 shrink-0 items-center justify-end rounded-full bg-brand-600 px-0.5 ring-2 ring-brand-500 ring-offset-2 ring-offset-muted"
          : "flex h-3.5 w-6 shrink-0 items-center rounded-full bg-muted-foreground/30 px-0.5"
      }
    >
      <span className="size-2.5 rounded-full bg-white" />
    </span>
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
      <div className="min-w-0 flex-1 space-y-3 text-sm">
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
