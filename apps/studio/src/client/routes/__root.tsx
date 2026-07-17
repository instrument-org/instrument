import type { ErrorComponentProps } from "@tanstack/react-router";

import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { ThemeProvider } from "@/client/components/theme-provider";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router";

import { Spinner } from "../components/ui/spinner";
import { TooltipProvider } from "../components/ui/tooltip";

export const Route = createRootRouteWithContext<{
  disableHotkeyReload?: boolean;
  queryClient: QueryClient;
}>()({
  component: RootComponent,
  errorComponent: ErrorComponent,
  notFoundComponent: NotFoundRouteComponent,
  pendingComponent: PendingComponent,
});

function ErrorComponent(props: ErrorComponentProps) {
  return (
    <Root>
      <DefaultErrorComponent {...props} />
    </Root>
  );
}

function PendingComponent() {
  return (
    <Root>
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    </Root>
  );
}

function Root({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      {/* This is the one spot where we use TooltipProvider */}
      {/* eslint-disable-next-line no-restricted-syntax */}
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}

function RootComponent() {
  // Only the foreground tab writes the shared document head. Every open tab
  // stays mounted, so without this gate each would push its own <title>, and
  // `document.title` (the OS window title / accessible window name) would follow
  // whichever tab resolved last rather than the visible one. `useIsActiveTab`
  // defaults to true outside the tab host, so the onboarding window still
  // renders its head.
  const isActiveTab = useIsActiveTab();
  return (
    <Root>
      {isActiveTab ? <HeadContent /> : null}
      <Outlet />
    </Root>
  );
}
