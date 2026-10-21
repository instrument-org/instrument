import { devNotificationOverride } from "@/electron-main/lib/mac-native";
import { focusAppWindow } from "@/electron-main/windows/foreground";
import { Notification } from "electron";

/**
 * Kept until clicked, closed or timed out: a notification the garbage
 * collector takes before it is clicked never reports the click.
 */
const live = new Set<Notification>();

/**
 * Setup's test notification: a real one, which answers `clicked` when the
 * person clicks it (and brings the window forward, as any notification's
 * click does), or `timed-out` once `timeoutMs` passes without that. A
 * development build told the click comes (`INSTRUMENT_NOTIFICATION_ANSWER`
 * `clicked`) answers `clicked` shortly after showing it.
 */
export function showTestNotification({
  timeoutMs,
}: {
  timeoutMs: number;
}): Promise<"clicked" | "timed-out"> {
  return new Promise((resolve) => {
    const notification = new Notification({
      body: "Click here to finish setting them up.",
      title: "Notifications work",
    });
    live.add(notification);
    const settle = (answer: "clicked" | "timed-out") => {
      clearTimeout(timer);
      live.delete(notification);
      resolve(answer);
    };
    const timer = setTimeout(() => {
      settle("timed-out");
    }, timeoutMs);
    notification.once("click", () => {
      focusAppWindow();
      settle("clicked");
    });
    notification.show();
    if (devNotificationOverride() === "clicked") {
      setTimeout(() => {
        settle("clicked");
      }, 1500);
    }
  });
}
