import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { useToggleCommandMenu } from "@/client/hooks/use-toggle-command-menu";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectSubdomain } from "@instrument-org/workspace/client";
import {
  ArrowsClockwiseIcon,
  ChatCircleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function StudioCommandMenu() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { navigateTab } = useTabActions();

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions({ enabled: open }),
  );

  const { mutate: setDeveloperMode } = useMutation(
    rpcClient.preferences.setDeveloperMode.mutationOptions(),
  );

  const { mutate: setReleaseChannel } = useMutation(
    rpcClient.preferences.setReleaseChannel.mutationOptions(),
  );

  const { mutate: checkForUpdates } = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );
  const projectRouteMatch = useMatch({
    from: "/_app/projects/$subdomain/",
    shouldThrow: false,
  });
  const newTabRouteMatch = useMatch({
    from: "/_app/new-tab",
    shouldThrow: false,
  });
  const { data: projectsData, isLoading } = useQuery(
    rpcClient.workspace.project.list.queryOptions({
      enabled: open,
      input: { direction: "desc", sortBy: "updatedAt" },
      placeholderData: (prev) => prev,
    }),
  );

  const projects = projectsData?.projects ?? [];

  const currentProjectSubdomain = projectRouteMatch?.params.subdomain;

  const filteredProjects = projects.filter(
    (project) => project.subdomain !== currentProjectSubdomain,
  );

  const isOnNewTabPage = !!newTabRouteMatch;

  useToggleCommandMenu(
    useCallback(() => {
      setOpen((prev) => !prev);
    }, []),
  );

  const handleClose = () => {
    setOpen(false);
    // Delay reset until after the close animation (200ms) to avoid a flicker.
    setTimeout(() => {
      setSearch("");
    }, 200);
  };

  const handleSelectProject = (subdomain: ProjectSubdomain) => {
    handleClose();
    void navigateTab({
      params: { subdomain },
      to: "/projects/$subdomain",
    });
  };

  const handleNewProject = () => {
    handleClose();
    void navigate({ to: "/new-tab" });
  };

  return (
    <CommandDialog
      description="Search for a project to open..."
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else {
          handleClose();
        }
      }}
      open={open}
      title="Open Project"
    >
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search projects..."
        value={search}
      />
      <CommandList className="h-96">
        {isLoading && projects.length === 0 ? (
          <div className="space-y-4 px-2 py-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div className="flex items-center gap-x-3" key={i}>
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <CommandEmpty>
              <span className="text-muted-foreground">No commands found</span>
            </CommandEmpty>
            <CommandGroup>
              {!isOnNewTabPage && (
                <CommandItem onSelect={handleNewProject} value="new-project">
                  <PlusIcon className="size-4" />
                  <span>New project</span>
                </CommandItem>
              )}
              <CommandItem
                onSelect={() => {
                  handleClose();
                  checkForUpdates({});
                }}
                value="check-for-updates"
              >
                <ArrowsClockwiseIcon className="size-4" />
                <span>Check for updates</span>
              </CommandItem>
              {/* Only renders when "!dev" is typed exactly, so it never appears in the default list. */}
              {search === "!dev" && (
                <CommandItem
                  keywords={["!dev"]}
                  onSelect={() => {
                    handleClose();
                    const next = !(preferences?.developerMode ?? false);
                    setDeveloperMode({ enabled: next });
                    toast(
                      next
                        ? "Developer mode enabled"
                        : "Developer mode disabled",
                    );
                  }}
                  value="toggle-developer-mode"
                >
                  <span>Toggle developer mode</span>
                </CommandItem>
              )}
              {/* Only renders when "!beta" is typed exactly, so it never appears in the default list. */}
              {search === "!beta" && (
                <CommandItem
                  keywords={["!beta"]}
                  onSelect={() => {
                    handleClose();
                    const isBeta = preferences?.releaseChannel === "beta";
                    setReleaseChannel({
                      channel: isBeta ? undefined : "beta",
                    });
                    toast(
                      isBeta ? "Beta channel removed" : "Beta channel enabled",
                    );
                  }}
                  value="toggle-beta-channel"
                >
                  <span>Toggle beta channel</span>
                </CommandItem>
              )}
            </CommandGroup>
            {filteredProjects.length > 0 && (
              <CommandGroup heading="Projects">
                {filteredProjects.map((project) => (
                  <CommandItem
                    key={project.subdomain}
                    keywords={[project.title]}
                    onSelect={() => {
                      handleSelectProject(project.subdomain);
                    }}
                    value={project.subdomain}
                  >
                    <ChatCircleIcon className="size-4 shrink-0 opacity-50" />
                    <span className="flex-1 truncate">{project.title}</span>
                    <span className="text-xs text-muted-foreground/60">
                      {formatDistanceToNow(new Date(project.updatedAt), {
                        addSuffix: true,
                      }).replace(/^about /, "")}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
