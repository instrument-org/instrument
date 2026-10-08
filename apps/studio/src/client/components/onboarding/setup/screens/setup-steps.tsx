import {
  SetupGroup,
  SetupHead,
  SetupPage,
  SetupPill,
  SetupRow,
} from "@/client/components/onboarding/setup/chrome";
import { useSetup } from "@/client/components/onboarding/setup/context";
import {
  LocationFolderGlyph,
  LookMiniature,
  MarkTile,
  type MemoryApp,
  MemoriesArt,
  NotificationArt,
  PackedFolderArt,
  SetupWell,
} from "@/client/components/onboarding/setup/steps-art";
import { WeekGrid } from "@/client/components/onboarding/setup/steps-week";
import { useTheme } from "@/client/components/theme-provider";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { BellIcon } from "@phosphor-icons/react/Bell";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

// ---- F5 ---------------------------------------------------------------------

const MEMORY_APPS: { app: MemoryApp; detail: string; title: string }[] = [
  { app: "chatgpt", detail: "chatgpt.com", title: "ChatGPT" },
  { app: "claude", detail: "claude.ai", title: "Claude" },
  { app: "gemini", detail: "gemini.google.com", title: "Gemini" },
];

/** The assistant's on/off switch, 42 by 24 with the knob riding inside. */
function SetupToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "relative h-6 w-10.5 shrink-0 rounded-full",
        checked ? "bg-brand-500" : "bg-black/15 dark:bg-white/20",
      )}
      onClick={() => {
        onChange(!checked);
      }}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]",
          checked ? "left-5" : "left-0.5",
        )}
      />
    </button>
  );
}

/**
 * F5: apps to save an import-memories prompt for. Nothing is imported here;
 * the tasks page turns what is left on into drafts at the end.
 */
export function MemoriesPage() {
  const { dispatch, state } = useSetup();
  const { memories } = state.answers;
  return (
    <SetupPage
      next={{
        label: "Continue",
        onClick: () => {
          dispatch({ step: "folder", type: "go" });
        },
      }}
      skip={{
        onClick: () => {
          dispatch({
            answers: {
              memories: { chatgpt: false, claude: false, gemini: false },
            },
            type: "answer",
          });
          dispatch({ step: "folder", type: "go" });
        },
      }}
    >
      <SetupHead
        illustration={<MemoriesArt />}
        subtitle="ChatGPT, Claude and Gemini remember things about you. Instrument can import those memories and keep them organized, so it knows you from day one."
        title="Bring your memories with you"
      />
      <SetupGroup
        caption="Import memories from"
        className="mt-7"
        note="For each one you pick, we'll save a prompt in your Instrument drafts. You decide when to start it."
      >
        {MEMORY_APPS.map(({ app, detail, title }) => (
          <SetupRow
            control={
              <SetupToggle
                checked={memories[app]}
                label={`Import memories from ${title}`}
                onChange={(checked) => {
                  dispatch({
                    answers: { memories: { ...memories, [app]: checked } },
                    type: "answer",
                  });
                }}
              />
            }
            detail={detail}
            icon={<MarkTile app={app} size={36} />}
            key={app}
            title={title}
          />
        ))}
      </SetupGroup>
    </SetupPage>
  );
}

// ---- F6, F7 -----------------------------------------------------------------

type FolderLocation = RPCOutput["setupFolder"]["location"];

const PICKER_MESSAGE = "Choose where your Instrument folder goes.";

/**
 * F6, F7: where the Instrument folder lives. Nothing is read or made until
 * Continue, which is when a computer that guards Documents asks for access.
 * A refusal opens the folder picker at the folder's parent, since picking it
 * there grants access, and a folder already holding things is pointed out
 * before the app starts saving into it.
 */
export function FolderPage() {
  const { dispatch } = useSetup();
  const queryClient = useQueryClient();
  const proposed = useQuery(
    rpcClient.setupFolder.location.queryOptions({ input: {} }),
  );
  const [chosen, setChosen] = useState<FolderLocation | null>(null);
  const [existingItems, setExistingItems] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const location = chosen ?? proposed.data;

  const pick = async (startingAt: string) => {
    const picked = await rpcClient.utils.showFolderPicker.call({
      buttonLabel: "Choose",
      message: PICKER_MESSAGE,
      startingAt,
    });
    if (!picked) {
      return null;
    }
    const next = await rpcClient.setupFolder.location.call({
      picked: picked.path,
    });
    setChosen(next);
    setExistingItems(null);
    return next;
  };

  const create = async (target: FolderLocation, keepExisting: boolean) => {
    const outcome = await rpcClient.setupFolder.create.call({
      folderPath: target.folderPath,
      keepExisting,
    });
    switch (outcome.kind) {
      case "made":
        // The window behind setup read where the folder is before it was
        // made; it reads again now that it is.
        await queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.window.ensure.key(),
        });
        dispatch({ step: "notifications", type: "go" });
        return;
      case "exists":
        setExistingItems(outcome.items);
        return;
      case "denied": {
        const next = await pick(outcome.pickAt);
        if (next) {
          await create(next, false);
        }
      }
    }
  };

  return (
    <SetupPage
      next={{
        disabled: !location || isBusy,
        label: "Continue",
        onClick: () => {
          if (!location) {
            return;
          }
          setIsBusy(true);
          void create(location, existingItems !== null).finally(() => {
            setIsBusy(false);
          });
        },
      }}
    >
      <PackedFolderArt />
      <SetupHead
        subtitle="Instrument saves the things it makes in your Instrument folder by default, unless you tell it otherwise."
        title="Where should your Instrument folder live?"
      />
      <div className="mt-10 w-130">
        <p className="px-4 pb-1.5 text-xs font-medium text-foreground/45">
          Location
        </p>
        <div className="overflow-hidden rounded-2xl bg-card shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
          <div className="flex items-center gap-3 px-4 py-3">
            <LocationFolderGlyph />
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-medium text-foreground">
                {location?.parentName ?? " "}
              </div>
              <div className="truncate text-xs text-foreground/50">
                {location?.displayPath ?? " "}
              </div>
            </div>
            <SetupPill
              disabled={!location || isBusy}
              kind="light"
              onClick={() => {
                if (location) {
                  void pick(location.parentPath);
                }
              }}
              size="small"
            >
              Change…
            </SetupPill>
          </div>
          {existingItems !== null && location && (
            <>
              <div className="ml-14.5 h-px bg-black/[0.07] dark:bg-white/10" />
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="grid w-7.5 shrink-0 place-items-center">
                  <InfoIcon className="size-5 text-foreground/45" />
                </span>
                <p className="min-w-0 flex-1 text-left text-[13px] leading-snug text-foreground/65">
                  There's already a folder called Instrument here, with{" "}
                  {existingItems === 1 ? "1 item" : `${existingItems} items`}.
                  We'll keep everything in it and add new things alongside.
                </p>
                <SetupPill
                  kind="light"
                  onClick={() => {
                    void rpcClient.utils.openFolder.call({
                      folderPath: location.folderPath,
                    });
                  }}
                  size="small"
                >
                  Show folder
                </SetupPill>
              </div>
            </>
          )}
        </div>
      </div>
    </SetupPage>
  );
}

// ---- F8, F9 -----------------------------------------------------------------

type NotifyAnswer = "allowed" | "asking" | "refused" | "unavailable";

/**
 * Asks the system to let Instrument notify, then sends the test notification
 * Settings has, so the first one they see is the app's own. Off macOS, or in
 * a build the Mac bridge cannot reach, the test notification alone is what
 * makes the system ask.
 */
async function allowNotifications(): Promise<NotifyAnswer> {
  const { status } = await rpcClient.mac.notifications.status.call();
  if (status !== "unsupported") {
    const { granted } = await rpcClient.mac.notifications.request.call();
    if (!granted) {
      return "refused";
    }
  }
  const { supported } = await rpcClient.preferences.sendTestNotification.call();
  return supported ? "allowed" : "unavailable";
}

/** F8, F9: notifications, with Continue quiet until they allow. */
export function NotificationsPage() {
  const { dispatch } = useSetup();
  const permission = useQuery(
    rpcClient.mac.notifications.status.queryOptions(),
  );
  const [answer, setAnswer] = useState<NotifyAnswer | null>(null);
  const shown: NotifyAnswer | null =
    answer ?? (permission.data?.status === "allowed" ? "allowed" : null);
  const isAllowed = shown === "allowed";

  return (
    <SetupPage
      next={{
        label: "Continue",
        onClick: () => {
          dispatch({ step: "week", type: "go" });
        },
        quiet: !isAllowed,
      }}
    >
      <SetupHead
        illustration={<NotificationArt />}
        subtitle="Get a heads-up when a task is done or needs you."
        title="Allow Instrument to notify you"
      />
      <SetupGroup className="mt-8 w-105">
        <SetupRow
          control={
            isAllowed ? (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-brand-700 dark:text-brand-400">
                <CheckCircleIcon className="size-4.5" weight="fill" />
                Allowed
              </span>
            ) : shown === "refused" ? (
              <SetupPill
                kind="light"
                onClick={() => {
                  void rpcClient.preferences.openNotificationSettings.call();
                }}
                size="small"
              >
                Open Settings
              </SetupPill>
            ) : shown === "unavailable" ? undefined : (
              <SetupPill
                className="px-5"
                disabled={shown === "asking"}
                onClick={() => {
                  setAnswer("asking");
                  void allowNotifications()
                    .catch((): NotifyAnswer => "refused")
                    .then(setAnswer);
                }}
                size="small"
              >
                Allow
              </SetupPill>
            )
          }
          detail={
            shown === "refused"
              ? "They're turned off. You can turn them on in Settings."
              : shown === "unavailable"
                ? "This computer can't show notifications from Instrument."
                : "Finished tasks and questions"
          }
          icon={
            <SetupWell hue="#ea8a2e" size={36}>
              <BellIcon weight="fill" />
            </SetupWell>
          }
          title="Notifications"
        />
      </SetupGroup>
    </SetupPage>
  );
}

// ---- F10, F11 ---------------------------------------------------------------

/**
 * F10, F11: the kinds of work that fill their week. The answers stay in
 * `answers.work` (by id) and `answers.workOther`; the tasks page writes
 * from them once the person moves on, and any change clears the tasks
 * written from earlier answers.
 */
export function WeekPage() {
  const { dispatch, state } = useSetup();
  const { work, workOther } = state.answers;
  const [isOtherOpen, setIsOtherOpen] = useState(workOther.trim() !== "");
  return (
    <SetupPage
      next={{
        label: "Continue",
        onClick: () => {
          dispatch({ step: "look", type: "go" });
        },
      }}
      skip={{
        onClick: () => {
          dispatch({
            answers: { tasks: [], work: [], workOther: "" },
            type: "answer",
          });
          dispatch({ step: "look", type: "go" });
        },
      }}
    >
      <SetupHead
        subtitle="Pick any that fit. Instrument uses this to suggest a few tasks."
        title="What fills your week?"
      />
      <WeekGrid
        isOtherOpen={isOtherOpen}
        onOpenOther={setIsOtherOpen}
        onOtherChange={(text) => {
          dispatch({ answers: { tasks: [], workOther: text }, type: "answer" });
        }}
        onToggle={(id) => {
          dispatch({
            answers: {
              tasks: [],
              work: work.includes(id)
                ? work.filter((picked) => picked !== id)
                : [...work, id],
            },
            type: "answer",
          });
        }}
        other={workOther}
        picked={work}
      />
    </SetupPage>
  );
}

// ---- F12 --------------------------------------------------------------------

const LOOKS = [
  { label: "Light", theme: "light" },
  { label: "Dark", theme: "dark" },
  { label: "Auto", theme: "system" },
] as const;

/**
 * F12: light, dark, or automatic, applied as soon as it is picked. Auto is
 * the app's System theme, which follows the computer's setting.
 */
export function LookPage() {
  const { dispatch } = useSetup();
  const { setTheme, theme } = useTheme();
  return (
    <SetupPage
      next={{
        label: "Continue",
        onClick: () => {
          dispatch({ step: "tasks", type: "go" });
        },
      }}
    >
      <SetupHead
        subtitle="You can change this any time in Settings."
        title="Choose your look"
      />
      <div className="mt-10 flex gap-8">
        {LOOKS.map((look) => {
          const isPicked = theme === look.theme;
          return (
            <button
              aria-pressed={isPicked}
              className="flex flex-col items-center gap-3 focus-visible:outline-none"
              key={look.theme}
              onClick={() => {
                setTheme(look.theme);
              }}
              type="button"
            >
              <span
                className={cn(
                  "rounded-2xl p-1.25 transition-shadow",
                  isPicked
                    ? "ring-[3px] ring-brand-500"
                    : "ring-1 ring-black/10 dark:ring-white/15",
                )}
              >
                <LookMiniature look={look.theme} />
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  isPicked ? "text-foreground" : "text-foreground/55",
                )}
              >
                {look.label}
              </span>
            </button>
          );
        })}
      </div>
    </SetupPage>
  );
}
