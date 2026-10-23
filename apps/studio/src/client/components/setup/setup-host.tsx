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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useState } from "react";

import { SetupPageSwitch } from "./kit/setup-page-switch";

import { SETUP_PAGES } from "./step-pages";
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
 * command menu and back and forward wait until it is done. Each step's page
 * slides in by the way setup moved, and when setup finishes it fades out
 * over the app as the window takes its own size back.
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
  const isReduced = useReducedMotion() ?? false;
  const isNewStepOnly = held?.isNewStepOnly ?? state?.isNewStepOnly ?? false;

  return (
    <AnimatePresence>
      {step !== null && (
        <motion.div
          className="absolute inset-0 z-50"
          exit={{ opacity: 0, transition: { duration: isReduced ? 0 : 0.3 } }}
          key="setup"
        >
          <SetupScreen
            answer={(answered) => {
              setHeld(null);
              answer({ step: answered });
            }}
            back={(from) => {
              setHeld(null);
              back({ step: from });
            }}
            backTo={state?.step === step ? (state.back ?? null) : null}
            finish={() => {
              setHeld(null);
              finish(undefined);
            }}
            hold={() => {
              setHeld({ isNewStepOnly, step });
            }}
            isDeveloperMode={isDeveloperMode}
            isNewStepOnly={isNewStepOnly}
            step={step}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Setup on screen at one step: the ground, the window's band, and the step's page. */
function SetupScreen({
  answer,
  back,
  backTo,
  finish,
  hold,
  isDeveloperMode,
  isNewStepOnly,
  step,
}: {
  answer: (step: SetupStep) => void;
  back: (step: SetupStep) => void;
  /** The step Back goes to; a page held past its step has nowhere to go back to. */
  backTo: null | SetupStep;
  finish: () => void;
  hold: () => void;
  isDeveloperMode: boolean;
  isNewStepOnly: boolean;
  step: SetupStep;
}) {
  const Page = SETUP_PAGES[step];
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden bg-linear-to-b from-setup-ground-top to-setup-ground-bottom to-50% dark:to-100%"
      data-testid="setup"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-442px] left-1/2 h-220 w-[1123px] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--color-setup-glow),transparent_74%)]"
      />
      {/* The window's band, which drags it; the system draws the lights at
        its left on macOS, and setup draws minimize and close elsewhere. It
        lies over the page rather than above it, so a page taller than the
        window (zoomed in, say) scrolls up under it as a Mac window's
        content does, and keeps its full height. */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
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
      <SetupPageSwitch depth={SETUP_STEPS.indexOf(step)} page={step}>
        <Page
          hold={hold}
          // A step added after finishing is the only one left, so its way
          // on is the end of setup.
          isLast={isNewStepOnly || SETUP_STEPS.at(-1) === step}
          isNewStepOnly={isNewStepOnly}
          onBack={
            backTo === null
              ? undefined
              : () => {
                  back(step);
                }
          }
          onContinue={() => {
            answer(step);
          }}
          onFinish={finish}
          step={step}
        />
      </SetupPageSwitch>
      {/* The app's toaster is not mounted while setup is up, so every toast
        lands here. */}
      <Toaster />
    </div>
  );
}
