import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/debug")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug" }],
  }),
  staticData: { tabIcon: "code" },
});

function RouteComponent() {
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <Outlet />
    </main>
  );
}
