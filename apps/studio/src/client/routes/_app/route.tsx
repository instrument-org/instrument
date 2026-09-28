import { useInvalidateRouterOnUserChange } from "@/client/hooks/use-invalidate-router-on-user-change";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
});

function RouteComponent() {
  // The window chrome (toolbar/sidebar) is rendered once by AppChrome, outside
  // the per-tab routers; each tab's router only renders its own content here.
  // The 2.0 window draws its own around its tabs the same way.
  useInvalidateRouterOnUserChange();
  return <Outlet />;
}
