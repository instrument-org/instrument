import { SetupNetworkStatusPill } from "@/client/components/network-status/network-status-pill";
import { Toaster } from "@/client/components/ui/sonner";
import { WindowControls } from "@/client/components/window-controls";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useHoldWindow } from "@/client/hooks/use-hold-window";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { isLastSetupStep, SETUP_PAGES } from "./setup-pages";
import { useSetupState } from "./use-setup-state";

/** The toaster setup's own toasts go to (`toasterId`), the one shown over it. */
const SETUP_TOASTER_ID = "setup";

// The developer panel, for Skip setup: loaded only in developer mode.
const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

/**
 * Setup, drawn over the whole app window while it is up, with the app loaded
 * behind it. It holds the window with no way to close: the tab chords, the
 * command menu and back and forward wait until it is done.
 */
export function SetupHost() {
  const step = useSetupState()?.step ?? null;
  const isDeveloperMode = useDeveloperMode();
  useHoldWindow(step !== null);
  const { mutate: answer } = useMutation(
    rpcClient.setup.answer.mutationOptions(),
  );
  const { mutate: finish } = useMutation(
    rpcClient.setup.finish.mutationOptions(),
  );

  if (step === null) {
    return null;
  }
  const Page = SETUP_PAGES[step];
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-ground"
      data-testid="setup"
    >
      {/* The window's band, which drags it; the system draws the lights at
        its left on macOS, and setup draws minimize and close elsewhere. */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
          isMacOS() && "pr-2",
        )}
        style={{ height: `${TOOLBAR_HEIGHT}px` }}
      >
        <SetupNetworkStatusPill />
        {isDeveloperMode && (
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        )}
        <WindowControls />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
        <Page
          isLast={isLastSetupStep(step)}
          onContinue={() => {
            answer({ step });
          }}
          onFinish={() => {
            finish(undefined);
          }}
          step={step}
        />
      </div>
      <Toaster id={SETUP_TOASTER_ID} />
    </div>
  );
}
