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
  useLocation,
  useSearch,
} from "@tanstack/react-router";

import {
  componentPages,
  getDebugRoute,
  onboardingScreens,
} from "./-debug-routes";
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
  const dataPartsPage = componentPages.find((page) => page.id === "data-parts");
  const onboardingPage = componentPages.find(
    (page) => page.id === "onboarding",
  );
  const defaultSessionId = presetSessions[0]?.id;
  const activeSessionId = search.session ?? defaultSessionId;
  const isChatStreamRoute = pathname === chatStreamPage?.to;
  const isDataPartsRoute = pathname === dataPartsPage?.to;
  // data-parts is a chat rendering, so it lives under the Chat section rather
  // than as its own top-level entry. Keep the section open on either route.
  const isChatSectionOpen = isChatStreamRoute || isDataPartsRoute;
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

                  // Rendered as a sub-item under the Chat section below.
                  if (page.id === "data-parts") {
                    return null;
                  }
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
                        <Collapsible open={isChatSectionOpen}>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {dataPartsPage && (
                                <SidebarMenuSubItem>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isDataPartsRoute}
                                  >
                                    <InternalLink
                                      allowOpenNewTab={false}
                                      to={dataPartsPage.to}
                                    >
                                      <span>{dataPartsPage.label}</span>
                                    </InternalLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              )}
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
