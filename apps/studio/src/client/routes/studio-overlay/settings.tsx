import { InternalLink } from "@/client/components/internal-link";
import { Button } from "@/client/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/client/components/ui/sidebar";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { type StudioPath } from "@/shared/studio-path";
import {
  BugIcon,
  CpuIcon,
  FadersHorizontalIcon,
  FlagIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/studio-overlay/settings")({
  component: SettingsModal,
});

interface NavItem {
  icon: React.ElementType;
  isDeveloperMode?: boolean;
  path: StudioPath;
  title: string;
}

function SettingsModal() {
  const navItems = useNavItems();

  return (
    <DialogContent
      aria-describedby={undefined}
      className="h-175 max-h-[90vh] w-225 max-w-[min(900px,90vw)] gap-0 overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none sm:max-w-[min(900px,90vw)]"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
      }}
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">Settings</DialogTitle>
      <div className="absolute top-3 right-3 z-10">
        <DialogClose asChild>
          <Button aria-label="Close" type="button" variant="outline">
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      </div>
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <div className="shrink-0 p-3 text-center text-sm font-semibold">
          Settings
        </div>
        <div className="flex min-h-0 flex-1 px-3">
          <SidebarProvider className="h-full min-h-0" defaultOpen>
            <Sidebar
              className="h-full shrink-0 bg-transparent"
              collapsible="none"
            >
              <SidebarContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem className="group" key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className="group-hover:bg-black/10 dark:group-hover:bg-white/10"
                      >
                        <InternalLink
                          activeOptions={{ exact: true, includeSearch: false }}
                          activeProps={{ "data-active": true }}
                          allowOpenNewTab={false}
                          className={
                            item.isDeveloperMode
                              ? "text-dev-700 dark:text-dev-300 [&>svg]:text-dev-700 dark:[&>svg]:text-dev-300"
                              : undefined
                          }
                          to={item.path}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </InternalLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarContent>
            </Sidebar>
            <SidebarInset className="overflow-y-auto">
              <div className="flex flex-1 flex-col gap-4 p-6">
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </div>
    </DialogContent>
  );
}

function useNavItems(): NavItem[] {
  const isDeveloperMode = useDeveloperMode();
  return [
    {
      icon: FadersHorizontalIcon,
      path: "/studio-overlay/settings",
      title: "General",
    },
    {
      icon: CpuIcon,
      path: "/studio-overlay/settings/providers",
      title: "Providers",
    },
    ...(isDeveloperMode
      ? [
          {
            icon: FlagIcon,
            isDeveloperMode: true,
            path: "/studio-overlay/settings/features" as const,
            title: "Features",
          },
          {
            icon: BugIcon,
            isDeveloperMode: true,
            path: "/studio-overlay/settings/debug" as const,
            title: "Debug",
          },
        ]
      : []),
  ];
}
