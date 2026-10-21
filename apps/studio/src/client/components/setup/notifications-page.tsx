import { BrandMark } from "@/client/components/brand-mark";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { SetupFooter, SetupPage } from "./kit/setup-page";
import { NotificationRow } from "./kit/setup-row";
import {
  continueFor,
  type NotificationsEvent,
  notificationsStep,
  type NotificationsState,
} from "./notifications-flow";
import { type SetupPageProps } from "./setup-page-props";
import { sendTestNotification } from "./test-notification";

/**
 * Notifications (frames 10 to 13). Allow asks the system; on a yes, a real
 * notification goes out and the page waits for its click, which marks the
 * row Allowed. The step settles itself the moment the system says yes, so
 * the page holds it on screen until Continue. Continue is always there.
 */
export function NotificationsPage({
  hold,
  isLast,
  isNewStepOnly,
  onBack,
  onContinue,
  onFinish,
}: SetupPageProps) {
  const [state, setState] = useState<NotificationsState>("ask");
  const dispatch = (event: NotificationsEvent) => {
    setState((current) => notificationsStep(current, event));
  };
  const { mutate: openSettings } = useMutation(
    rpcClient.preferences.openNotificationSettings.mutationOptions(),
  );

  const sendTest = async () => {
    if ((await sendTestNotification()) === "clicked") {
      dispatch({ type: "clicked" });
    }
  };

  const allow = async () => {
    hold();
    dispatch({ type: "allow" });
    let granted = false;
    try {
      await rpcClient.mac.notifications.request.call();
      // The status, not the request's answer: a click on the body of
      // macOS's prompt reads as a refusal, and turning them on afterwards
      // in System Settings shows up only here.
      const { status } = await rpcClient.mac.notifications.status.call();
      granted = status === "allowed" || status === "provisional";
    } catch {
      // Read as a no: the row says where to turn them on.
    }
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
          <SampleNotification />
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

/** Frame 10's picture: a notification as the system shows one, inside a window's edge. */
function SampleNotification() {
  return (
    <div className="relative h-41 w-117.5 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-49 rounded-[20px] border border-gray-400 opacity-75 mask-b-from-40% mask-b-to-100%" />
      <div className="absolute top-7.5 left-7.5 flex w-102.5 items-center gap-3 rounded-2xl bg-black/5 p-3.5 dark:bg-white/5">
        <BrandMark size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-gray-400">
            <span className="text-[11px] font-medium tracking-[0.04em]">
              {APP_NAME.toUpperCase()}
            </span>
            <span className="text-xs">now</span>
          </div>
          <p className="text-sm font-semibold text-foreground">
            This is an example notification
          </p>
          <p className="text-sm text-gray-600 dark:text-muted-foreground">
            {APP_NAME} will tell you when it’s done working
          </p>
        </div>
      </div>
    </div>
  );
}
