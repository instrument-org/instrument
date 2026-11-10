import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SetupFooter, SetupPage } from "../kit/setup-page";
import { NotificationRow } from "../kit/setup-row";
import {
  continueFor,
  type NotificationsEvent,
  notificationsStep,
  type NotificationsState,
} from "../notifications-flow";
import { type SetupStepProps } from "../step-props";
import { NotificationPreview } from "../notification-preview";
import { sendTestNotification } from "../test-notification";

/** Whether the system has notifications on for the app. */
async function notificationsAreOn(): Promise<boolean> {
  try {
    const { status } = await rpcClient.mac.notifications.status.call();
    return status === "allowed" || status === "provisional";
  } catch {
    // Read as a no: the row says where to turn them on.
    return false;
  }
}

/** Asks the system for notifications, then whether they are on. */
async function requestNotifications(): Promise<boolean> {
  try {
    await rpcClient.mac.notifications.request.call();
  } catch {
    return false;
  }
  // The status, not the request's answer: a click on the body of macOS's
  // prompt reads as a refusal, and turning them on afterwards in System
  // Settings shows up only here.
  return notificationsAreOn();
}

/**
 * Notifications (frames 10 to 13). Allow asks the system; on a yes, a real
 * notification goes out and the page waits for its click, which marks the
 * row Allowed. The step settles itself the moment the system says yes, so
 * the page holds it on screen until Continue. Continue is always there.
 * After a no, turning them on in the system's settings marks the row
 * Allowed when the window is next in front.
 */
export function NotificationsStep({
  hold,
  isLast,
  isNewStepOnly,
  onBack,
  onContinue,
  onFinish,
}: SetupStepProps) {
  const [state, setState] = useState<NotificationsState>("ask");
  const dispatch = (event: NotificationsEvent) => {
    setState((current) => notificationsStep(current, event));
  };
  const { mutate: openSettings } = useMutation(
    rpcClient.preferences.openNotificationSettings.mutationOptions(),
  );

  // A refusal is undone in the system's settings, in another window, so the
  // row asks the system again each time the person comes back to this one.
  useEffect(() => {
    if (state !== "off") {
      return;
    }
    const onFocus = async () => {
      if (await notificationsAreOn()) {
        setState((current) => notificationsStep(current, { type: "turnedOn" }));
      }
    };
    const listener = () => {
      void onFocus();
    };
    window.addEventListener("focus", listener);
    return () => {
      window.removeEventListener("focus", listener);
    };
  }, [state]);

  const sendTest = async () => {
    if ((await sendTestNotification()) === "clicked") {
      dispatch({ type: "clicked" });
    }
  };

  const allow = async () => {
    hold();
    dispatch({ type: "allow" });
    const granted = await requestNotifications();
    dispatch({ granted, type: "answered" });
    if (granted) {
      void sendTest();
    }
  };

  return (
    <SetupPage
      className="pt-22"
      footer={
        <SetupFooter
          back={!isNewStepOnly}
          label={state === "allowed" ? "Continue" : "Skip"}
          next={continueFor(state)}
          onBack={onBack}
          onContinue={isLast ? onFinish : onContinue}
        />
      }
      hero={
        <div className="flex flex-col items-center gap-6">
          {isNewStepOnly && (
            <p className="rounded-full bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-black/5">
              One new thing to set up
            </p>
          )}
          <NotificationPreview />
        </div>
      }
      subtitle="Get a heads-up when a task is done or needs you"
      title={`Allow ${APP_NAME} to notify you`}
    >
      <div className="mt-8">
        <NotificationRow
          line="For completed tasks and questions"
          onAllow={
            state === "ask"
              ? () => {
                  void allow();
                }
              : undefined
          }
          onOpenSettings={() => {
            openSettings(undefined);
          }}
          onSendAgain={() => {
            void sendTest();
          }}
          state={state === "asking" ? "ask" : state}
        />
      </div>
    </SetupPage>
  );
}
