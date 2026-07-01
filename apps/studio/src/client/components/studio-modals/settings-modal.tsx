import {
  settingsModalAtom,
  type SettingsTab,
} from "@/client/atoms/settings-modal";
import { DebugSection } from "@/client/components/settings/debug-section";
import { FeaturesSection } from "@/client/components/settings/features-section";
import { GeneralSection } from "@/client/components/settings/general-section";
import { ProvidersSection } from "@/client/components/settings/providers-section";
import { StorageSection } from "@/client/components/settings/storage-section";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
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
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useOpenSettings } from "@/client/hooks/use-open-settings";
import { rpcClient } from "@/client/rpc/client";
import {
  BugIcon,
  CpuIcon,
  FadersHorizontalIcon,
  FlagIcon,
  HardDrivesIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";

interface NavItem {
  icon: React.ElementType;
  isDeveloperMode?: boolean;
  tab: SettingsTab;
  title: string;
}

/**
 * App-wide settings modal, mounted once at the app-chrome root. Reads
 * `settingsModalAtom` (opened via `openSettings`). The visible section is
 * internal state seeded from the request's `tab`, and Providers can deep-link
 * straight to the add-provider dialog. Traps tab navigation while open.
 */
export function SettingsModal() {
  const [state, setState] = useAtom(settingsModalAtom);
  const isOpen = state !== null;

  useOpenSettings();
  useBlockTabNavigation(isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {state !== null && (
        <SettingsModalContent
          initialTab={state.tab ?? "General"}
          showNewProviderDialog={state.showNewProviderDialog ?? false}
        />
      )}
    </Dialog>
  );
}

function SettingsModalContent({
  initialTab,
  showNewProviderDialog,
}: {
  initialTab: SettingsTab;
  showNewProviderDialog: boolean;
}) {
  const navItems = useNavItems();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  // One-shot: honored only for the initial Providers section, cleared on any
  // section switch so revisiting Providers doesn't reopen add-provider.
  const [autoAddProvider, setAutoAddProvider] = useState(showNewProviderDialog);

  const selectTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    setAutoAddProvider(false);
  };

  return (
    <DialogContent
      aria-describedby={undefined}
      className="h-175 max-h-[calc(96vh/var(--content-zoom))] w-225 max-w-[calc(96vw/var(--content-zoom))] gap-0 overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none sm:max-w-[calc(96vw/var(--content-zoom))]"
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
        <div className="flex min-h-0 flex-1 overflow-x-auto px-3">
          <SidebarProvider className="h-full min-h-0" defaultOpen>
            <Sidebar
              className="h-full max-w-[40%] shrink-0 bg-transparent"
              collapsible="none"
            >
              <SidebarContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem className="group" key={item.title}>
                      <SidebarMenuButton
                        className={
                          item.isDeveloperMode
                            ? "text-dev-700 group-hover:bg-white/10 dark:text-dev-300 [&>svg]:text-dev-700 dark:[&>svg]:text-dev-300"
                            : "group-hover:bg-black/10 dark:group-hover:bg-white/10"
                        }
                        isActive={item.tab === activeTab}
                        onClick={() => {
                          selectTab(item.tab);
                        }}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarContent>
            </Sidebar>
            <SidebarInset className="min-w-0 overflow-y-auto">
              <div className="flex flex-1 flex-col gap-4 p-6">
                <SettingsSectionBody
                  autoAddProvider={autoAddProvider}
                  tab={activeTab}
                />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </div>
    </DialogContent>
  );
}

function SettingsSectionBody({
  autoAddProvider,
  tab,
}: {
  autoAddProvider: boolean;
  tab: SettingsTab;
}) {
  switch (tab) {
    case "Debug": {
      return <DebugSection />;
    }
    case "Features": {
      return <FeaturesSection />;
    }
    case "General": {
      return <GeneralSection />;
    }
    case "Providers": {
      return <ProvidersSection autoOpenAddProvider={autoAddProvider} />;
    }
    case "Storage": {
      return <StorageSection />;
    }
    default: {
      tab satisfies never;
      return null;
    }
  }
}

function useNavItems(): NavItem[] {
  const isDeveloperMode = useDeveloperMode();
  const { data: invalidFolders } = useQuery(
    rpcClient.workspace.storage.invalidFolders.list.queryOptions(),
  );
  const hasUnrecognizedFolders = (invalidFolders?.length ?? 0) > 0;

  return [
    {
      icon: FadersHorizontalIcon,
      tab: "General",
      title: "General",
    },
    {
      icon: CpuIcon,
      tab: "Providers",
      title: "Providers",
    },
    ...(hasUnrecognizedFolders
      ? [
          {
            icon: HardDrivesIcon,
            tab: "Storage" as const,
            title: "Storage",
          },
        ]
      : []),
    ...(isDeveloperMode
      ? [
          {
            icon: FlagIcon,
            isDeveloperMode: true,
            tab: "Features" as const,
            title: "Features",
          },
          {
            icon: BugIcon,
            isDeveloperMode: true,
            tab: "Debug" as const,
            title: "Debug",
          },
        ]
      : []),
  ];
}
