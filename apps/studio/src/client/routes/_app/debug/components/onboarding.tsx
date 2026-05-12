import { createFileRoute, Outlet } from "@tanstack/react-router";

import { getComponentPage } from "../-debug-routes";

export const Route = createFileRoute("/_app/debug/components/onboarding")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getComponentPage("onboarding").label }],
  }),
});

/** Mimics the Electron onboarding BrowserWindow: 480x600, hiddenInset title bar. */
export function OnboardingWindowFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-black/10 shadow-2xl
        dark:border-white/10"
      style={{ height: 600, width: 480 }}
    >
      {children}
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="flex flex-col gap-12 p-8">
        <Outlet />
      </div>
    </div>
  );
}
