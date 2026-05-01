import { InternalLink } from "@/client/components/internal-link";
import { createIconMeta } from "@/shared/tabs";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { debugRoutes } from "./-debug-routes";

const linkBaseClasses =
  "rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground";
const linkActiveClasses = "bg-background text-foreground! shadow-xs";

export const Route = createFileRoute("/_app/debug")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: "Debug",
      },
      createIconMeta("bug"),
    ],
  }),
});

function RouteComponent() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 w-full shrink-0 border-b bg-background px-4 py-3">
        <nav className="flex min-w-0 items-center">
          <div className="flex min-w-0 gap-1 overflow-x-auto rounded-full border bg-muted/40 p-1">
            {debugRoutes.map((route) => {
              if (!route.showNav) {
                return null;
              }

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
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
