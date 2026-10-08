import { SetupGround } from "@/client/components/onboarding/setup/chrome";
import { SetupContext } from "@/client/components/onboarding/setup/context";
import {
  initialSetupState,
  setupReducer,
} from "@/client/components/onboarding/setup/flow";
import { SetupStepPage } from "@/client/components/onboarding/setup/screens";
import {
  DraftsReadyPanel,
  useSaveSetupDrafts,
} from "@/client/components/onboarding/setup/tasks-landing";
import { useTaskWriting } from "@/client/components/onboarding/setup/tasks-writing";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducer, useState } from "react";

/**
 * Onboarding, drawn over the whole app window while it is pending: on a first
 * launch the window opens at the assistant's own size and grows into the app
 * when it is done, and after an update that adds a step it opens over the
 * window as the person left it. The app loads behind it the whole time, so
 * finishing fades the assistant away onto an app that is already there.
 */
export function SetupAssistant() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery(
    rpcClient.onboarding.live.status.experimental_liveOptions(),
  );
  // Kept up after onboarding is recorded done, for as long as it fades out.
  const [isLeaving, setIsLeaving] = useState(false);
  // Settled once from the first read: signing in partway through changes what
  // the status says, and must not change which welcome the person got.
  const [returning, setReturning] = useState<boolean | undefined>();
  if (returning === undefined && status?.pending) {
    setReturning(status.returning);
  }

  if (returning === undefined || (!status?.pending && !isLeaving)) {
    return <DraftsReadyPanel />;
  }
  return (
    <div
      className={cn(
        "absolute inset-0 z-50 transition-opacity duration-500",
        isLeaving && "pointer-events-none opacity-0",
      )}
      data-setup-assistant
      onTransitionEnd={() => {
        setIsLeaving(false);
      }}
    >
      <SetupFlow
        onFinish={() => {
          setIsLeaving(true);
          // The window read where the Instrument folder is while setup held
          // it, and made nothing; done, it reads again and makes the folder
          // if the folder step never did.
          void rpcClient.onboarding.finish.call().then(() =>
            queryClient.invalidateQueries({
              queryKey: rpcClient.workspace.window.ensure.key(),
            }),
          );
        }}
        returning={returning}
      />
    </div>
  );
}

function SetupFlow({
  onFinish,
  returning,
}: {
  onFinish: () => void;
  returning: boolean;
}) {
  useBlockTabNavigation();
  const [state, dispatch] = useReducer(
    setupReducer,
    { returning },
    initialSetupState,
  );
  // Starts writing the person's tasks as they leave "What fills your week?".
  useTaskWriting(state);
  const saveDrafts = useSaveSetupDrafts();
  const finish = () => {
    saveDrafts(state.answers);
    onFinish();
  };
  return (
    <SetupContext value={{ dispatch, finish, returning, state }}>
      <SetupGround>
        <SetupStepPage step={state.step} />
      </SetupGround>
    </SetupContext>
  );
}
