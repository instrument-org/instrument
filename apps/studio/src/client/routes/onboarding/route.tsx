import { OnboardingLayout } from "@/client/components/onboarding/layout";
import { Toaster } from "@/client/components/ui/sonner";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async () => {
    const [{ data: hasToken }, { data: providers }] = await Promise.all([
      safe(rpcClient.auth.hasToken.call()),
      safe(rpcClient.providerConfig.list.call()),
    ]);
    return {
      hasProviders: providers != null && providers.length > 0,
      hasToken: hasToken === true,
    };
  },
  component: OnboardingRoute,
});

const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

function OnboardingRoute() {
  useWaitingToast();
  const isDeveloperMode = useDeveloperMode();
  const matchRoute = useMatchRoute();
  const isWelcomePage = Boolean(matchRoute({ to: "/onboarding" }));
  const successMatch = matchRoute({ to: "/onboarding/theme" });
  const isSuccessPage =
    successMatch !== false &&
    (successMatch as { success?: boolean }).success === true;
  const isBrandPage = isWelcomePage || isSuccessPage;

  return (
    <OnboardingLayout variant={isBrandPage ? "brand" : "subtle"}>
      <Outlet />
      <Toaster position="top-center" />
      {/* Top right, where the app window's bar carries it, and out of the
          macOS drag strip so it can be clicked. Absolute so the screens lay
          out exactly as they do without developer mode. */}
      {isDeveloperMode && (
        <div className="absolute top-2.5 right-3 z-50 [-webkit-app-region:no-drag]">
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        </div>
      )}
    </OnboardingLayout>
  );
}

type WaitingAsk = RPCOutput["window"]["takePending"][number];

/**
 * Says what was opened with the app before it was set up, a file dropped on
 * its icon or a link, so it does not look ignored: it opens once onboarding
 * is done. One toast, kept up and updated as more arrives.
 */
function useWaitingToast() {
  const { data: waiting } = useQuery(
    rpcClient.window.live.waiting.experimental_liveOptions(),
  );
  useEffect(() => {
    if (waiting && waiting.length > 0) {
      toast(waitingMessage(waiting), {
        duration: Infinity,
        id: "waiting-opens",
      });
    }
  }, [waiting]);
}

function waitingMessage(waiting: WaitingAsk[]) {
  if (waiting.length > 1) {
    const noun = waiting.every((ask) => ask.type === "openFile")
      ? "files"
      : "items";
    return `${waiting.length} ${noun} open when you finish setup.`;
  }
  const name = waiting[0] && nameOf(waiting[0]);
  return name === undefined
    ? "The link opens when you finish setup."
    : `${name} opens when you finish setup.`;
}

/** The file's or folder's name, or nothing for a link to a screen. */
function nameOf(ask: WaitingAsk) {
  if (ask.type === "openFile") {
    return baseName(ask.hostPath);
  }
  if (ask.type === "openSettings") {
    return ask.tab;
  }
  const url = new URL(ask.href, "studio:/");
  const root = url.searchParams.get("root");
  return url.pathname === "/files" && root ? baseName(root) : undefined;
}

function baseName(hostPath: string) {
  return hostPath.split(/[\\/]/).findLast(Boolean) ?? hostPath;
}
