import { BrandMark } from "@/client/components/brand-mark";
import { isLinux, isWindows } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { XIcon } from "@phosphor-icons/react/X";

type NotificationLook = "gnome" | "mac" | "windows";

const TITLE = "This is an example notification";
const BODY = `${APP_NAME} will tell you when it’s done working`;

/** The session key a development run sets to draw another system's look. */
const LOOK_KEY = "setup.notificationLook";

/**
 * Which system's notification to draw: this computer's, or in a
 * development build the one `setup.notificationLook` names, so every look
 * can be checked from one machine.
 */
function notificationLook(): NotificationLook {
  if (import.meta.env.DEV) {
    try {
      const look = sessionStorage.getItem(LOOK_KEY);
      if (look === "gnome" || look === "mac" || look === "windows") {
        return look;
      }
    } catch {
      // A run without session storage draws this computer's look.
    }
  }
  return isWindows() ? "windows" : isLinux() ? "gnome" : "mac";
}

/**
 * The screen's edge around each look's notification, as Figma's frame 10
 * draws the Mac's: a small piece of the screen at the corner the
 * notification shows up in, its outline fading out away from it before any
 * other corner rounds. Each crosses two masks (`intersect`): the Mac's top
 * right and Windows' bottom right fade on the diagonal and out to the left;
 * GNOME's top middle fades out to both sides and down.
 */
const SCREEN_EDGE: Record<NotificationLook, string> = {
  gnome:
    "[mask-composite:intersect] [mask-image:linear-gradient(90deg,transparent_10%,black_38%,black_62%,transparent_90%),linear-gradient(180deg,black_20%,transparent_75%)]",
  mac: "[mask-composite:intersect] [mask-image:linear-gradient(17deg,transparent_49%,black_97%),linear-gradient(90deg,transparent_12%,black_45%)]",
  windows:
    "[mask-composite:intersect] [mask-image:linear-gradient(163deg,transparent_49%,black_97%),linear-gradient(90deg,transparent_12%,black_45%)]",
};

/**
 * Frame 10's picture: a notification the way this computer's system draws
 * one, in the corner of the screen it shows up in. Only the words and the
 * icon are ours in the real one; the rest follows the system.
 */
export function NotificationPreview() {
  const look = notificationLook();
  return (
    <div
      className="relative h-41 w-117.5 overflow-hidden"
      data-notification-look={look}
    >
      <div className={`absolute inset-0 opacity-75 ${SCREEN_EDGE[look]}`}>
        <div
          className={
            look === "windows"
              ? "absolute inset-x-0 bottom-0 h-49 rounded-[20px] border border-gray-400"
              : "absolute inset-x-0 top-0 h-49 rounded-[20px] border border-gray-400"
          }
        />
      </div>
      {look === "mac" && <MacBanner />}
      {look === "windows" && <WindowsToast />}
      {look === "gnome" && <GnomeBanner />}
    </div>
  );
}

/** macOS: a frosted banner at the top right, the app's full-color icon at its left. */
function MacBanner() {
  return (
    <div className="absolute top-7.5 left-7.5 flex w-102.5 items-center gap-3 rounded-2xl bg-black/5 p-3.5 dark:bg-white/5">
      <BrandMark size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between text-gray-400">
          <span className="text-[11px] font-medium tracking-[0.04em]">
            {APP_NAME.toUpperCase()}
          </span>
          <span className="text-xs">now</span>
        </div>
        <p className="text-sm font-semibold text-foreground">{TITLE}</p>
        <p className="text-sm text-gray-600 dark:text-muted-foreground">
          {BODY}
        </p>
      </div>
    </div>
  );
}

/**
 * Windows 11: a square-cornered toast at the bottom right, the app's small
 * icon and name in a header with More and Close, then the words.
 */
function WindowsToast() {
  return (
    <div className="absolute right-7.5 bottom-7.5 w-90 rounded-lg border border-black/10 bg-gray-50 px-4 pt-3 pb-4 shadow-lg dark:border-white/10 dark:bg-gray-800">
      <div className="flex items-center gap-2">
        <BrandMark size={16} />
        <span className="flex-1 text-xs text-foreground">{APP_NAME}</span>
        <DotsThreeIcon className="size-4 text-muted-foreground" />
        <XIcon className="ml-2 size-3.5 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm text-foreground">{TITLE}</p>
      <p className="text-sm text-muted-foreground">{BODY}</p>
    </div>
  );
}

/**
 * GNOME: a rounded banner at the top center, the app's icon drawn gray and
 * small beside its name and the time, a round Close at the right.
 */
function GnomeBanner() {
  return (
    <div className="absolute top-7.5 left-1/2 w-100 -translate-x-1/2 rounded-2xl bg-white px-3.5 pt-2.5 pb-3 shadow-md ring-1 ring-black/5 dark:bg-gray-800 dark:ring-white/10">
      <div className="flex items-center gap-1.5">
        <BrandMark className="opacity-70 grayscale" size={16} />
        <span className="text-xs font-semibold text-muted-foreground">
          {APP_NAME}
        </span>
        <span className="flex-1 text-xs text-muted-foreground/70">
          Just now
        </span>
        <span className="grid size-6 place-items-center rounded-full bg-black/5 dark:bg-white/10">
          <XIcon className="size-3 text-foreground" />
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-foreground">{TITLE}</p>
      <p className="text-sm text-foreground/80">{BODY}</p>
    </div>
  );
}
