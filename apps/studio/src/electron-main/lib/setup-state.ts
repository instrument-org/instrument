import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { type SetupState, type SetupStep } from "@/shared/setup";

/**
 * Where setup is: the step it's on, or none. Every reader in main (the
 * window's size, the menu, the chords, asks from outside) and the renderer's
 * `setup.live.state` go through this.
 *
 * Until the facts and the record are read, this keeps today's gate: setup
 * is up while no provider has been set up.
 */
export function readSetupState(): SetupState {
  const isUp =
    process.env.SKIP_ONBOARDING !== "true" &&
    !getWorkspaceState().get("hasCompletedProviderSetup");
  return {
    facts: {
      folderSettled: true,
      hasInstrumentAccount: false,
      hasInstrumentPlan: false,
      hasUsableAI: !isUp,
      notificationsAskable: false,
      usedBefore: false,
    },
    isNewStepOnly: false,
    step: isUp ? "way-in" : null,
  };
}

export function isSetupUp(): boolean {
  return readSetupState().step !== null;
}

/** Records a step as answered, so setup moves past it for good. */
export function answerSetupStep(_step: SetupStep): void {
  publisher.publish("setup.updated", null);
}

/** Records setup as finished. */
export function finishSetup(): void {
  publisher.publish("setup.updated", null);
}
