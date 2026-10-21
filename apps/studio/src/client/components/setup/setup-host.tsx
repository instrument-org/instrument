import glowSrc from "@/client/assets/setup/glow.svg";
import { SetupNetworkStatusPill } from "@/client/components/network-status/network-status-pill";
import { Toaster } from "@/client/components/ui/sonner";
import { WindowControls } from "@/client/components/window-controls";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useHoldWindow } from "@/client/hooks/use-hold-window";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SETUP_STEPS, type SetupStep } from "@/shared/setup";
import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";

import { SETUP_PAGES } from "./setup-pages";
import { useSetupState } from "./use-setup-state";

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
  const state = useSetupState();
  // The step a page keeps on screen past the moment its facts settle it,
  // until that page answers or finishes (`hold`).
  const [held, setHeld] = useState<null | {
    isNewStepOnly: boolean;
    step: SetupStep;
  }>(null);
  const step = held?.step ?? state?.step ?? null;
  const isDeveloperMode = useDeveloperMode();
  useHoldWindow(step !== null);
  const { mutate: answer } = useMutation(
    rpcClient.setup.answer.mutationOptions(),
  );
  const { mutate: back } = useMutation(rpcClient.setup.back.mutationOptions());
  const { mutate: finish } = useMutation(
    rpcClient.setup.finish.mutationOptions(),
  );

  if (step === null) {
    return null;
  }
  const Page = SETUP_PAGES[step];
  const isNewStepOnly = held?.isNewStepOnly ?? state?.isNewStepOnly ?? false;
  // Back answers for the step setup is on, so a page held past its step
  // has nowhere to go back to.
  const backTo = state?.step === step ? (state.back ?? null) : null;
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-linear-to-b from-brand-50 to-gray-100 to-50% dark:from-brand-950 dark:to-background"
      data-testid="setup"
    >
      <img
        alt=""
        aria-hidden
        className="pointer-events-none absolute top-[-442px] left-1/2 h-220 w-[1123px] max-w-none -translate-x-1/2 dark:hidden"
        draggable={false}
        src={glowSrc}
      />
      {/* The window's band, which drags it; the system draws the lights at
        its left on macOS, and setup draws minimize and close elsewhere. */}
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-end gap-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Page
          hold={() => {
            setHeld({ isNewStepOnly, step });
          }}
          // A step added after finishing is the only one left, so its way
          // on is the end of setup.
          isLast={isNewStepOnly || SETUP_STEPS.at(-1) === step}
          isNewStepOnly={isNewStepOnly}
          key={step}
          onBack={
            backTo === null
              ? undefined
              : () => {
                  setHeld(null);
                  back({ step });
                }
          }
          onContinue={() => {
            setHeld(null);
            answer({ step });
          }}
          onFinish={() => {
            setHeld(null);
            finish(undefined);
          }}
          step={step}
        />
      </div>
      {/* The app's toaster is not mounted while setup is up, so every toast
        lands here. */}
      <Toaster />
    </div>
  );
}
