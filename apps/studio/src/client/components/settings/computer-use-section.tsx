import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";

// oxlint-disable studio/no-os-words -- Computer Use is carried for macOS alone, so this screen shows nowhere else.

type Status = RPCOutput["features"]["computerUse"]["status"];

/** How often a step waiting on a switch in System Settings checks it. */
const WAITING_POLL_MS = 1000;

/** What macOS calls the Accessibility pane since macOS 27. */
function accessibilityPaneName(macOSMajor: number): string {
  return macOSMajor >= 27 ? "Device Control and Data Access" : "Accessibility";
}

/** What macOS calls the Screen Recording pane since macOS 15. */
function screenPaneName(macOSMajor: number): string {
  return macOSMajor >= 15
    ? "Screen & System Audio Recording"
    : "Screen Recording";
}

/**
 * What Computer Use needs from macOS before the agent is offered it. Both
 * steps read their state again as they wait on System Settings, since macOS
 * applies these switches at once and coming back here is when they've changed.
 */
export function ComputerUseSection() {
  const status = useQuery({
    ...rpcClient.features.computerUse.status.queryOptions(),
    refetchInterval: (query) =>
      query.state.data?.accessibility === true &&
      query.state.data.screenRecording
        ? false
        : WAITING_POLL_MS,
  });
  const data = status.data;
  const focus = useMutation(
    rpcClient.features.computerUse.focus.mutationOptions(),
  );
  const grantedBefore = useRef(data?.accessibility);
  useEffect(() => {
    if (grantedBefore.current === false && data?.accessibility === true) {
      focus.mutate({});
    }
    grantedBefore.current = data?.accessibility;
  }, [data?.accessibility, focus]);

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Computer Use</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.appName} can work in your other apps the way you would, usually
          without moving your pointer. It asks you about each app first, and you
          can see your answers in Permissions.
        </p>
        {!data.installed && (
          <p className="mt-3 text-sm">
            This build doesn&apos;t include what Computer Use needs.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <AccessibilityStep data={data} />
        <ScreenRecordingStep data={data} />
      </div>
    </div>
  );
}

function AccessibilityStep({ data }: { data: Status }) {
  const request = useMutation(
    rpcClient.features.computerUse.request.mutationOptions(),
  );
  return (
    <Step done={data.accessibility} title="See and use other apps">
      <p className="text-sm text-muted-foreground">
        macOS asks first. Turn on {data.appName} in{" "}
        {accessibilityPaneName(data.macOSMajor)}, and you&apos;ll be ready.
      </p>
      <Button
        disabled={!data.installed}
        onClick={() => {
          request.mutate({ permission: "accessibility" });
        }}
        size="sm"
      >
        Open System Settings
      </Button>
    </Step>
  );
}

function ScreenRecordingStep({ data }: { data: Status }) {
  const request = useMutation(
    rpcClient.features.computerUse.request.mutationOptions(),
  );
  return (
    <Step
      done={data.screenRecording}
      title="See pictures of windows (optional)"
    >
      <p className="text-sm text-muted-foreground">
        This helps when an app&apos;s buttons and text aren&apos;t enough to go
        on. Turn on {data.appName} in {screenPaneName(data.macOSMajor)}.
      </p>
      <Button
        disabled={!data.installed}
        onClick={() => {
          request.mutate({ permission: "screen-recording" });
        }}
        size="sm"
        variant="outline"
      >
        Open System Settings
      </Button>
    </Step>
  );
}

function Step({
  children,
  done,
  title,
}: {
  children: ReactNode;
  done: boolean;
  title: string;
}) {
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {done && <CheckIcon className="size-4 text-success" weight="bold" />}
        {title}
      </div>
      {!done && <div className="space-y-3">{children}</div>}
    </Card>
  );
}
