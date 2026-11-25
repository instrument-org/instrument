import { settingAnchor } from "@/client/components/settings/settings-index";
import { ThemeToggle } from "@/client/components/theme-toggle";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { DeveloperModeBadge } from "@/client/components/tool-part/developer-mode-badge";
import { Card } from "@/client/components/ui/card";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/client/components/ui/select";
import { StateArrival } from "@/client/components/state-arrival";
import { ZoomStepper } from "@/client/components/zoom-controls";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { BellSimpleIcon } from "@phosphor-icons/react/BellSimple";
import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINES,
  SearchEngineIdSchema,
} from "@/shared/search-engines";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { toast } from "@/client/lib/toast";

export function SettingsSection({
  children,
  developerOnly,
  title,
}: {
  children: ReactNode;
  developerOnly?: boolean;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <h3
        className={cn(
          "flex items-center gap-2 text-sm font-medium text-muted-foreground",
          developerOnly && "text-dev-700 dark:text-dev-300",
        )}
      >
        {title}
        {developerOnly && <DeveloperModeBadge />}
      </h3>
      {children}
    </div>
  );
}

export function GeneralSection() {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">General</h3>
      <InterfaceAndTheme />
      <BrowserSearch />
      <Notifications />
      <SettingsSection title="Chats">
        <NextMessageSuggestions />
      </SettingsSection>
    </div>
  );
}

function InterfaceAndTheme() {
  return (
    <SettingsSection title="Interface">
      <Card className="p-4">
        <div className="space-y-5">
          <div
            className="flex items-center justify-between"
            {...settingAnchor("theme")}
          >
            <div className="space-y-0.5">
              <Label htmlFor="theme-toggle">Theme</Label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred color scheme.
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div
            className="flex items-center justify-between"
            {...settingAnchor("zoom")}
          >
            <div className="space-y-0.5">
              <Label>Zoom</Label>
              <p className="text-xs text-muted-foreground">
                Scale the app. Websites have their own zoom.
              </p>
            </div>
            <ZoomStepper />
          </div>
        </div>
      </Card>
    </SettingsSection>
  );
}

function BrowserSearch() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const queryClient = useQueryClient();
  const options = {
    onError: (error: Error) => {
      toast.error("Couldn't change that setting", { cause: error });
    },
    // What one engine suggested is not what the next one would.
    onSuccess: () => {
      queryClient.removeQueries({
        queryKey: rpcClient.browser.searchSuggestions.key(),
      });
    },
  };
  const setSearchEngine = useMutation(
    rpcClient.preferences.setSearchEngine.mutationOptions(options),
  );
  const setSuggestSearches = useMutation(
    rpcClient.preferences.setSuggestSearches.mutationOptions(options),
  );
  const engine = preferences?.searchEngine ?? DEFAULT_SEARCH_ENGINE;
  return (
    <SettingsSection title="Browser">
      <Card className="p-4">
        <div className="space-y-5">
          <div
            className="flex items-center justify-between gap-4"
            {...settingAnchor("search-engine")}
          >
            <div className="space-y-0.5">
              <Label htmlFor="search-engine">Search engine</Label>
              <p className="text-xs text-muted-foreground">
                Words you type in the address field are searched here.
              </p>
            </div>
            <Select
              disabled={setSearchEngine.isPending}
              onValueChange={(value) => {
                const picked = SearchEngineIdSchema.safeParse(value);
                if (picked.success) {
                  setSearchEngine.mutate({ engine: picked.data });
                }
              }}
              value={engine}
            >
              <SelectTrigger
                className="bg-card bg-none dark:bg-gray-700"
                id="search-engine"
              >
                {SEARCH_ENGINES[engine].name}
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {SearchEngineIdSchema.options.map((id) => (
                  <SelectItem key={id} value={id}>
                    {SEARCH_ENGINES[id].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            className="flex items-center justify-between gap-4"
            {...settingAnchor("suggest-searches")}
          >
            <div className="space-y-0.5">
              <Label htmlFor="suggest-searches">Suggest searches</Label>
              <p className="text-xs text-muted-foreground">
                What you type in the address field goes to{" "}
                {SEARCH_ENGINES[engine].name} as you type, so it can suggest
                searches.
              </p>
            </div>
            <Switch
              checked={preferences?.suggestSearches !== false}
              disabled={setSuggestSearches.isPending}
              id="suggest-searches"
              onCheckedChange={(enabled) => {
                setSuggestSearches.mutate({ enabled });
              }}
            />
          </div>
        </div>
      </Card>
    </SettingsSection>
  );
}

const NOTIFICATION_MODES = [
  { menuLabel: "Always", triggerLabel: "Always", value: "always" },
  {
    menuLabel: "Only when not focused",
    triggerLabel: "Not focused",
    value: "unfocused",
  },
  { menuLabel: "Never", triggerLabel: "Never", value: "never" },
] as const;

/**
 * Whether a chat that comes to rest asks its model for the person's likely
 * next messages, shown under the reply. Each ask is a request on the chat's
 * own model, so this is where someone saving usage turns it off.
 */
function NextMessageSuggestions() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setSuggestNextMessage = useMutation(
    rpcClient.preferences.setSuggestNextMessage.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  return (
    <label
      className="flex items-start justify-between gap-4"
      {...settingAnchor("suggest-next-message")}
    >
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Suggest a next message
        </span>
        <span className="block text-xs text-muted-foreground">
          After each reply, {APP_NAME} suggests what you might say next. It adds
          a little to your AI usage.
        </span>
      </span>
      <Switch
        checked={preferences?.suggestNextMessage !== false}
        disabled={setSuggestNextMessage.isPending}
        onCheckedChange={(enabled) => {
          setSuggestNextMessage.mutate({ enabled });
        }}
      />
    </label>
  );
}

function Notifications() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setAgentCompletionNotificationsMutation = useMutation(
    rpcClient.preferences.setAgentCompletionNotifications.mutationOptions(),
  );
  const sendTestNotificationMutation = useMutation(
    rpcClient.preferences.sendTestNotification.mutationOptions(),
  );
  const openNotificationSettingsMutation = useMutation(
    rpcClient.preferences.openNotificationSettings.mutationOptions(),
  );
  const { data: canOpenNotificationSettings = false } = useQuery(
    rpcClient.preferences.canOpenNotificationSettings.queryOptions(),
  );
  // What macOS says about the app's notifications, read again each time the
  // window takes focus, which is when someone returns from System Settings
  // having changed it. Switching apps leaves the page visible, so the query
  // library's own refetch-on-focus never fires here.
  const permission = useQuery(
    rpcClient.mac.notifications.status.queryOptions(),
  );
  const { data: windowFocusChanged } = useQuery(
    rpcClient.utils.events.windowFocusChanged.experimental_liveOptions(),
  );
  const refetchPermission = permission.refetch;
  useEffect(() => {
    void refetchPermission();
  }, [windowFocusChanged, refetchPermission]);
  const requestPermission = useMutation(
    rpcClient.mac.notifications.request.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't ask macOS about notifications", {
          cause: error,
        });
      },
      onSettled: () => {
        void permission.refetch();
      },
      onSuccess: ({ error }) => {
        // macOS refused without asking anyone: in development because the
        // build is not signed, which is the one case worth explaining.
        if (error !== undefined) {
          toast.error("macOS didn't allow notifications", {
            cause: error,
            description: import.meta.env.DEV
              ? "Development builds aren't signed, and macOS lets only a signed app notify."
              : undefined,
          });
        }
      },
    }),
  );
  const status = permission.data?.status;
  // Where the app is allowed but banners are off, nothing shows on screen.
  const isQuiet =
    status === "provisional" ||
    (status === "allowed" && permission.data?.alerts === false);

  const mode = preferences?.agentCompletionNotifications ?? "unfocused";
  const triggerLabel =
    NOTIFICATION_MODES.find((option) => option.value === mode)?.triggerLabel ??
    "Not focused";

  const handleSendTest = async () => {
    const sent = await sendTestNotificationMutation
      .mutateAsync(undefined)
      .catch((error: unknown) => {
        toast.error("Couldn't send a test notification", { cause: error });
        return null;
      });
    if (sent === null) {
      return;
    }
    if (!sent.supported) {
      toast.error("This computer doesn't support notifications");
      return;
    }
    toast.success("Test notification sent", {
      // Where the system has no notification settings to open, the
      // description alone says what to look for.
      action: canOpenNotificationSettings
        ? {
            label: "Open settings",
            onClick: () => {
              openNotificationSettingsMutation.mutate(undefined);
            },
          }
        : undefined,
      description: `Not seeing it? Turn on notifications for ${APP_NAME}.`,
    });
  };

  // Until macOS lets the app notify, the setting would read as working when
  // nothing can appear, so the section asks for that first.
  const gate =
    status === "not-asked"
      ? "not-asked"
      : status === "denied"
        ? "off"
        : isQuiet
          ? "quiet"
          : undefined;
  // Which of the two the section shows, so it settles in when macOS changes
  // its answer while someone is in System Settings.
  const arrival = status === undefined ? undefined : (gate ?? "allowed");
  if (gate !== undefined) {
    return (
      <SettingsSection title="Notifications">
        <StateArrival state={arrival}>
          <NotificationsPermission
            isPending={requestPermission.isPending}
            onAllow={() => {
              requestPermission.mutate(undefined);
            }}
            onOpenSettings={() => {
              openNotificationSettingsMutation.mutate(undefined);
            }}
            state={gate}
          />
        </StateArrival>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Notifications">
      <StateArrival state={arrival}>
        <Card className="p-4">
          <div
            className="flex items-start justify-between gap-4"
            {...settingAnchor("notifications")}
          >
            <div className="space-y-1">
              <Label htmlFor="agent-completion-notifications">
                Notify when tasks finish
              </Label>
              <p className="text-xs text-muted-foreground">
                Show a desktop notification when a task finishes.
              </p>
              <Button
                className="h-auto p-0 text-xs font-normal text-foreground"
                disabled={sendTestNotificationMutation.isPending}
                onClick={handleSendTest}
                variant="link"
              >
                Send a test notification
              </Button>
            </div>
            <Select
              disabled={setAgentCompletionNotificationsMutation.isPending}
              onValueChange={(value) => {
                const option = NOTIFICATION_MODES.find(
                  (o) => o.value === value,
                );
                if (option) {
                  setAgentCompletionNotificationsMutation.mutate({
                    mode: option.value,
                  });
                }
              }}
              value={mode}
            >
              <SelectTrigger
                className="bg-card bg-none dark:bg-gray-700"
                id="agent-completion-notifications"
              >
                {triggerLabel}
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {NOTIFICATION_MODES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.menuLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
      </StateArrival>
    </SettingsSection>
  );
}

// oxlint-disable studio/no-os-words -- shown only on macOS, the one system that asks before an app may notify
/**
 * Notifications before macOS lets the app show any: what they are for and
 * the one thing that gets them going, asking macOS the first time and
 * opening System Settings once it has an answer.
 */
function NotificationsPermission({
  isPending,
  onAllow,
  onOpenSettings,
  state,
}: {
  isPending: boolean;
  onAllow: () => void;
  onOpenSettings: () => void;
  state: "not-asked" | "off" | "quiet";
}) {
  const detail = {
    "not-asked": "Get a notification when a task finishes or needs you.",
    off: "Notifications are off in System Settings.",
    quiet: "Banners are off in System Settings, so nothing shows on screen.",
  }[state];
  return (
    <Card className="p-4">
      <div
        className="flex items-center gap-3.5"
        {...settingAnchor("notifications")}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white">
          <BellSimpleIcon className="size-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">Notify when tasks finish</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button
          className="shrink-0 rounded-full px-5"
          disabled={isPending}
          onClick={state === "not-asked" ? onAllow : onOpenSettings}
          size="sm"
          variant={state === "not-asked" ? "brand" : "outline"}
        >
          {state === "not-asked" ? "Allow" : "Open System Settings"}
        </Button>
      </div>
    </Card>
  );
}
// oxlint-enable studio/no-os-words
