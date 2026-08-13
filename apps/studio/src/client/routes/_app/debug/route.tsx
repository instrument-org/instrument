import { InternalLink } from "@/client/components/internal-link";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { debugNavigationRoutes } from "./-debug-routes";

const linkBaseClasses =
  "rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground";
const linkActiveClasses = "bg-background text-foreground! shadow-xs";

export const Route = createFileRoute("/_app/debug")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug" }],
  }),
  staticData: { tabIcon: "code" },
});

function RouteComponent() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 w-full shrink-0 border-b bg-background px-4 py-3">
        <nav className="flex min-w-0 items-center">
          <div className="flex min-w-0 flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
            {debugNavigationRoutes.map((route) => {
              return (
                <InternalLink
                  activeOptions={{ exact: route.to === "/debug" }}
                  activeProps={{
                    className: linkActiveClasses,
                  }}
                  className={linkBaseClasses}
                  key={route.to}
                  to={route.to}
                >
                  {route.label}
                </InternalLink>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
