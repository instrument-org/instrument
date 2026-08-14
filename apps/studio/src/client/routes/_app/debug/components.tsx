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
import { scenarios } from "./-transcript/scenarios";

export const Route = createFileRoute("/_app/debug/components")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugRoute("components").title }],
  }),
});

function RouteComponent() {
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const onboardingPage = componentPages.find(
    (page) => page.id === "onboarding",
  );
  const transcriptPage = componentPages.find(
    (page) => page.id === "transcript",
  );
  const defaultScenarioId = scenarios[0]?.id;
  const activeScenarioId = search.scenario ?? defaultScenarioId;
  const isTranscriptRoute = pathname === transcriptPage?.to;
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
                  const isOnboardingPage = page.id === "onboarding";
                  const isTranscriptPage = page.id === "transcript";
                  const pageSearch =
                    isTranscriptPage && defaultScenarioId
                      ? { scenario: defaultScenarioId }
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
                      {isTranscriptPage && transcriptPage && (
                        <Collapsible open={isTranscriptRoute}>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {scenarios.map((scenario) => (
                                <SidebarMenuSubItem key={scenario.id}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={
                                      isTranscriptRoute &&
                                      scenario.id === activeScenarioId
                                    }
                                  >
                                    <InternalLink
                                      allowOpenNewTab={false}
                                      search={{ scenario: scenario.id }}
                                      to={transcriptPage.to}
                                    >
                                      <span>{scenario.name}</span>
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
