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
            Choose Allow, then in the window macOS opens, turn on Instrument
            under Privacy &amp; Security, {pane}.
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
  const state = data.permissions.screenRecording;
  const done = state === "granted";
  const pane = screenRecordingPaneName(data.macOSMajor);
  const neverAsked = state === "not-determined";

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
            {neverAsked
              ? `Choose Allow and macOS asks once. If you miss it, turn on Instrument under Privacy & Security, ${pane}.`
              : `Turn on Instrument under Privacy & Security, ${pane}. macOS applies it the next time Instrument opens, so relaunch afterward.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {neverAsked && (
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
              variant={neverAsked ? "outline" : "default"}
            >
              Open {pane}
            </Button>
            {!neverAsked && (
              <Button
                disabled={relaunch.isPending}
                onClick={() => {
                  relaunch.mutate(undefined);
                }}
                size="sm"
                variant="outline"
              >
                {data.canRelaunch ? "Relaunch Instrument" : "Check again"}
              </Button>
            )}
          </div>
        </>
      )}
    </Step>
  );
}

function TestStep({
  number,
  onFinished,
  ready,
}: {
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
      description="Takes one small picture of the screen through the same driver the agent uses."
      done={result?.ok === true}
      doneLabel="Passed"
      failed={result?.ok === false}
      number={number}
      title="Try it"
    >
      {isMacOS() && (
        <p>
          macOS may ask whether Instrument can bypass the system's private
          window picker and record the screen directly. Choose Allow; the agent
          needs it to see windows.
        </p>
      )}
      {result?.ok === false && (
        <p className="text-destructive">Didn't work: {result.detail}</p>
      )}
      {result?.ok === true && <p>Worked. The driver can see the screen.</p>}
      <div>
        <Button
          disabled={!ready || verify.isPending}
          onClick={() => {
            verify.mutate(undefined);
          }}
          size="sm"
          variant={result?.ok ? "outline" : "default"}
        >
          {verify.isPending ? "Testing…" : "Run a test"}
        </Button>
      </div>
    </Step>
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
