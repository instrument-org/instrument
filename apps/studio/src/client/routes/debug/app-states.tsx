import { crashWindowAtom } from "@/client/atoms/developer-strip";
import { openLogin } from "@/client/atoms/login-modal";
import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { forceWindowControlsAtom } from "@/client/atoms/window-controls";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { type ReactNode } from "react";

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
    <div className="min-w-0 flex-1 overflow-y-auto p-8">
      <h1 className="mb-6 text-base font-semibold">App states</h1>
      <StateSection title="Dialogs">
        <StateButton
          label="Settings"
          onClick={() => {
            openSettings({ tab: "General" });
          }}
        />
        <StateButton
          label="Sign in"
          onClick={() => {
            openLogin();
          }}
        />
        <StateButton label="Keyboard shortcuts" onClick={openShortcutGuide} />
      </StateSection>
      <StateSection title="Updates">
        <StateButton
          label="Downloading"
          onClick={() => {
            simulateDownload(undefined);
          }}
        />
        <StateButton
          label="Check fails"
          onClick={() => {
            simulateError(undefined);
          }}
        />
        <StateButton
          label="Up to date"
          onClick={() => {
            simulateNoUpdate(undefined);
          }}
        />
        <StateButton
          label="Just updated"
          onClick={() => {
            simulateUpdated(undefined);
          }}
        />
        <StateButton
          label="Clear badge"
          onClick={() => {
            clearBadge(undefined);
          }}
        />
      </StateSection>
      <StateSection title="Setup">
        <StateButton
          label="Run setup again"
          onClick={() => {
            runSetupAgain();
          }}
        />
      </StateSection>
      <StateSection title="Window">
        {/* States a dev run on this Mac never reaches by itself: another
          platform's window buttons, and the prompt dev builds skip when an
          agent is running at quit. */}
        {isMacOS() && (
          <label
            className="flex items-center gap-2 pr-3 text-sm"
            title="Draw the minimize, maximize, and close buttons Windows and Linux get, for checking the layout around them"
          >
            <Switch
              checked={forceWindowControls}
              onCheckedChange={setForceWindowControls}
            />
            Windows-style buttons
          </label>
        )}
        <label
          className="flex items-center gap-2 pr-3 text-sm"
          title="Ask before quitting while an agent is running, which dev builds normally skip. Resets on relaunch; a rebuild while it is on waits on the dialog."
        >
          <Switch
            checked={quitGuard?.forced ?? false}
            onCheckedChange={(forced) => {
              setQuitGuardForced({ forced });
            }}
          />
          Quit prompt
        </label>
        <StateButton
          label="Crash the window"
          onClick={() => {
            crashWindow(true);
          }}
        />
      </StateSection>
    </div>
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
    <section className="mb-6">
      <h2 className="mb-2.5 text-sm font-medium">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
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
