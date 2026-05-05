import { InternalLink } from "@/client/components/internal-link";
import {
  Collapsible,
  CollapsibleContent,
} from "@/client/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/client/components/ui/sidebar";
import {
  createFileRoute,
  Outlet,
  useMatchRoute,
  useSearch,
} from "@tanstack/react-router";

import { componentPages, getDebugRoute } from "./-debug-routes";
import { presetSessions } from "./-sessions";

export const Route = createFileRoute("/_app/debug/components")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("components").title }],
  }),
});

function RouteComponent() {
  const matchRoute = useMatchRoute();
  const search = useSearch({ strict: false });
  const sessionStreamPage = componentPages.find(
    (page) => page.id === "session-stream",
  );
  const defaultSessionId = presetSessions[0]?.id;
  const activeSessionId = search.session ?? defaultSessionId;
  const isSessionStreamRoute =
    sessionStreamPage !== undefined &&
    !!matchRoute({ to: sessionStreamPage.to });

  return (
    <SidebarProvider
      className="min-h-0 w-full flex-1 overflow-hidden"
      defaultOpen
    >
      <Sidebar className="min-h-0 shrink-0" collapsible="none">
        <SidebarContent className="gap-0">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {componentPages.map((page) => {
                  const isSessionStreamPage = page.id === "session-stream";
                  const pageSearch =
                    isSessionStreamPage && defaultSessionId
                      ? { session: defaultSessionId }
                      : undefined;

                  return (
                    <SidebarMenuItem key={page.id}>
                      <SidebarMenuButton
                        asChild
                        className="h-auto"
                        isActive={!!matchRoute({ to: page.to })}
                      >
                        <InternalLink
                          allowOpenNewTab={false}
                          search={pageSearch}
                          to={page.to}
                        >
                          <span>{page.label}</span>
                        </InternalLink>
                      </SidebarMenuButton>
                      {isSessionStreamPage && sessionStreamPage && (
                        <Collapsible open={isSessionStreamRoute}>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {presetSessions.map((session) => (
                                <SidebarMenuSubItem key={session.id}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={
                                      isSessionStreamRoute &&
                                      session.id === activeSessionId
                                    }
                                  >
                                    <InternalLink
                                      allowOpenNewTab={false}
                                      search={{ session: session.id }}
                                      to={sessionStreamPage.to}
                                    >
                                      <span>{session.name}</span>
                                    </InternalLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
