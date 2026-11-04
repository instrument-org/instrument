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
  SidebarGroupLabel,
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

import { appPages, componentPages } from "./-debug-routes";
import { scenarios } from "./-transcript/scenarios";

export const Route = createFileRoute("/debug")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug" }],
  }),
  staticData: { tabIcon: "code" },
});

/** Every debug page behind one sidebar, whichever one is up. */
function RouteComponent() {
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const transcriptPage = componentPages.find(
    (page) => page.id === "transcript",
  );
  const defaultScenarioId = scenarios[0]?.id;
  const activeScenarioId = search.scenario ?? defaultScenarioId;
  const isTranscriptRoute = pathname === transcriptPage?.to;

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <SidebarProvider
        className="min-h-0 w-full flex-1 overflow-hidden"
        defaultOpen
      >
        <Sidebar className="min-h-0 shrink-0" collapsible="none">
          <SidebarContent className="gap-0">
            <SidebarGroup>
              <SidebarGroupLabel>App</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {appPages.map((page) => (
                    <SidebarMenuItem key={page.id}>
                      <SidebarMenuButton
                        asChild
                        className="h-auto"
                        isActive={pathname === page.to}
                      >
                        <InternalLink allowOpenNewTab={false} to={page.to}>
                          <span>{page.label}</span>
                        </InternalLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Components</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {componentPages.map((page) => {
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
                                      // Wrapped rather than truncated. A
                                      // scenario is picked by reading its name,
                                      // and the ends are where several of them
                                      // differ from each other.
                                      className="h-auto py-1 [&>span:last-child]:whitespace-normal"
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
    </main>
  );
}
