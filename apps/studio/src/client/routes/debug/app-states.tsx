import { crashWindowAtom } from "@/client/atoms/developer-strip";
import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { showNoticeToast } from "@/client/components/window/notifications-bell";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { type ReactNode } from "react";
import { DebugPageScroller } from "./-page-scroller";
import { DebugState } from "./-shell";
import { appStates } from "./-states/app-states";

export const Route = createFileRoute("/debug/app-states")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug app states" }],
  }),
});

function RouteComponent() {
  const [forceWindowControls, setForceWindowControls] = useAtom(
    forceWindowControlsAtom,
  );
  const crashWindow = useSetAtom(crashWindowAtom);
  const { mutate: simulateDownload } = useMutation(
    rpcClient.debug.trigger.testDownloadNotification.mutationOptions(),
  );
  const { mutate: simulateError } = useMutation(
    rpcClient.debug.trigger.testErrorNotification.mutationOptions(),
  );
  const { mutate: simulateNoUpdate } = useMutation(
    rpcClient.debug.trigger.testNoUpdateNotification.mutationOptions(),
  );
  const { mutate: simulateUpdated } = useMutation(
    rpcClient.debug.trigger.testUpdatedNotice.mutationOptions(),
  );
  const { mutate: fillBell } = useMutation(
    rpcClient.debug.trigger.fillBell.mutationOptions(),
  );
  // The bell's notices that pop up when they arrive, to show again at will:
  // the bell itself shows each once, ever.
  const { data: notices = [] } = useQuery(
    rpcClient.notices.live.list.experimental_liveOptions(),
  );
  const loudNotices = notices.filter((notice) => notice.severity !== "info");
  const { mutate: clearBadge } = useMutation(
    rpcClient.debug.trigger.testSilentNoUpdate.mutationOptions(),
  );
  const { mutate: runSetupAgain } = useMutation(
    rpcClient.setup.dev.reset.mutationOptions(),
  );
  const { data: quitGuard, refetch: refetchQuitGuard } = useQuery(
    rpcClient.debug.getQuitGuardForced.queryOptions(),
  );
  const { mutate: setQuitGuardForced } = useMutation(
    rpcClient.debug.setQuitGuardForced.mutationOptions({
      onSuccess: () => {
        void refetchQuitGuard();
      },
    }),
  );

  return (
    <DebugPageScroller className="min-w-0 flex-1 overflow-y-auto p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <StateSection title="Dialogs">
          <StateRow
            description="Opens Settings on the General tab."
            id="settings"
          >
            <StateButton
              label="Open"
              onClick={() => {
                openSettings({ tab: "General" });
              }}
            />
          </StateRow>
          <StateRow description="Opens the sign-in dialog." id="sign-in">
            <StateButton
              label="Open"
              onClick={() => {
                openLogin();
              }}
            />
          </StateRow>
          <StateRow
            description="Opens the list of keyboard shortcuts."
            id="keyboard-shortcuts"
          >
            <StateButton label="Open" onClick={openShortcutGuide} />
          </StateRow>
        </StateSection>
        <StateSection title="Updates">
          <StateRow
            description="Checks for an update, then pretends to download one until it's ready to install."
            id="update-downloading"
          >
            <StateButton
              label="Start"
              onClick={() => {
                simulateDownload(undefined);
              }}
            />
          </StateRow>
          <StateRow
            description="Checks for an update, and the check fails a second later."
            id="update-check-fails"
          >
            <StateButton
              label="Start"
              onClick={() => {
                simulateError(undefined);
              }}
            />
          </StateRow>
          <StateRow
            description="Checks for an update and finds none."
            id="update-up-to-date"
          >
            <StateButton
              label="Start"
              onClick={() => {
                simulateNoUpdate(undefined);
              }}
            />
          </StateRow>
          <StateRow
            description="Puts the note you get after an update installs in the bell."
            id="update-just-updated"
          >
            <StateButton
              label="Show"
              onClick={() => {
                simulateUpdated(undefined);
              }}
            />
          </StateRow>
          <StateRow
            description="Finds no update without telling you, which takes the update badge away."
            id="update-clear-badge"
          >
            <StateButton
              label="Clear"
              onClick={() => {
                clearBadge(undefined);
              }}
            />
          </StateRow>
        </StateSection>
        <StateSection title="Notifications">
          <StateRow
            description="Puts one of every kind of notification in the bell. The sandbox shows as off until you restart the app."
            id="fill-bell"
          >
            <StateButton
              label="Fill"
              onClick={() => {
                fillBell(undefined);
              }}
            />
          </StateRow>
        </StateSection>
        <StateSection title="Notification pop-ups">
          <DebugState id="notification-pop-ups">
            {loudNotices.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">
                The bell has nothing loud enough to pop up. Fill the bell to see
                them here.
              </p>
            ) : (
              <>
                <p className="px-4 py-3 text-[13px] text-muted-foreground">
                  The bell pops each of these up only once. Show one again here.
                </p>
                {loudNotices.map((notice) => (
                  <Row key={notice.id} label={notice.title}>
                    <StateButton
                      label="Show"
                      onClick={() => {
                        // A preview: its action only closes it.
                        showNoticeToast(notice, () => {});
                      }}
                    />
                  </Row>
                ))}
              </>
            )}
          </DebugState>
        </StateSection>
        <StateSection title="Setup">
          <StateRow
            description="Forgets your setup answers and starts setup again from its first step."
            id="run-setup-again"
          >
            <StateButton
              label="Run"
              onClick={() => {
                runSetupAgain();
              }}
            />
          </StateRow>
        </StateSection>
        <StateSection title="Window">
          {/* States a dev run on this Mac never reaches by itself: another
            platform's window buttons, and the prompt dev builds skip when an
            agent is running at quit. */}
          {isMacOS() && (
            <StateRow
              description="Draws the minimize, maximize and close buttons Windows and Linux get, so you can check the layout around them."
              id="windows-style-buttons"
            >
              <Switch
                aria-label="Windows-style buttons"
                checked={forceWindowControls}
                onCheckedChange={setForceWindowControls}
              />
            </StateRow>
          )}
          <StateRow
            description="Asks before quitting while an agent is running, which dev builds usually skip. It turns off when you relaunch, and a rebuild while it's on waits for you to answer."
            id="quit-prompt"
          >
            <Switch
              aria-label="Quit prompt"
              checked={quitGuard?.forced ?? false}
              onCheckedChange={(forced) => {
                setQuitGuardForced({ forced });
              }}
            />
          </StateRow>
          <StateRow
            description="Throws an error while drawing the window, to show the screen a crash leaves you on."
            id="crash-window"
          >
            <StateButton
              label="Crash"
              onClick={() => {
                crashWindow(true);
              }}
            />
          </StateRow>
        </StateSection>
      </div>
    </DebugPageScroller>
  );
}

function StateSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="flex flex-col divide-y rounded-lg border">{children}</div>
    </section>
  );
}

type AppStateId = (typeof appStates)[number]["id"];

/** One state at its own address: what it is, what it does, and its control. */
function StateRow({
  children,
  description,
  id,
}: {
  children: ReactNode;
  description: string;
  id: AppStateId;
}) {
  const label = appStates.find((state) => state.id === id)?.label ?? id;
  return (
    <DebugState id={id}>
      <Row description={description} label={label}>
        {children}
      </Row>
    </DebugState>
  );
}

function Row({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function StateButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} size="sm" variant="outline">
      {label}
    </Button>
  );
}
