import { InternalLink } from "@/client/components/internal-link";
import { Collapsible, CollapsibleContent } from "@/client/components/ui/collapsible";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider } from "@/client/components/ui/sidebar";
import { createFileRoute, Outlet, useLocation, useSearch } from "@tanstack/react-router";

import { componentPages, getDebugRoute, onboardingScreens } from "./-debug-routes";
import { presetSessions } from "./-sessions";

export const Route = createFileRoute("/_app/debug/components")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("components").title }],
  }),
});

function RouteComponent() {
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const chatStreamPage = componentPages.find(
    (page) => page.id === "chat-stream",
  );
  const onboardingPage = componentPages.find(
    (page) => page.id === "onboarding",
  );
  const defaultSessionId = presetSessions[0]?.id;
  const activeSessionId = search.session ?? defaultSessionId;
  const isChatStreamRoute =
    chatStreamPage !== undefined && pathname === chatStreamPage.to;
  const isOnboardingRoute =
    onboardingPage !== undefined &&
    pathname.startsWith(onboardingPage.to + "/");

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
                  const isChatStreamPage = page.id === "chat-stream";
                  const isOnboardingPage = page.id === "onboarding";
                  const pageSearch =
                    isChatStreamPage && defaultSessionId
                      ? { session: defaultSessionId }
                      : undefined;

                  return (
                    <SidebarMenuItem key={page.id}>
                      <SidebarMenuButton
                        asChild
                        className="h-auto"
                        isActive={pathname === page.to}
                      >
                        <InternalLink
                          allowOpenNewTab={false}
                          search={pageSearch}
                          to={page.to}
                        >
                          <span>{page.label}</span>
                        </InternalLink>
                      </SidebarMenuButton>
                      {isChatStreamPage && chatStreamPage && (
                        <Collapsible open={isChatStreamRoute}>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {presetSessions.map((session) => (
                                <SidebarMenuSubItem key={session.id}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={
                                      isChatStreamRoute &&
                                      session.id === activeSessionId
                                    }
                                  >
                                    <InternalLink
                                      allowOpenNewTab={false}
                                      search={{ session: session.id }}
                                      to={chatStreamPage.to}
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
                      {isOnboardingPage && (
                        <Collapsible open={isOnboardingRoute}>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {onboardingScreens.map((screen) => (
                                <SidebarMenuSubItem key={screen.id}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={pathname === screen.to}
                                  >
                                    <InternalLink
                                      allowOpenNewTab={false}
                                      to={screen.to}
                                    >
                                      <span>{screen.label}</span>
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
