import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/client/components/ui/command";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { useToggleCommandMenu } from "@/client/hooks/use-toggle-command-menu";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ProjectSubdomain } from "@instrument-org/workspace/client";
import uFuzzy from "@leeoniya/ufuzzy";
import {
  ArrowsClockwiseIcon,
  ChatCircleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMatch, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FuzzyHighlight } from "./fuzzy-highlight";

interface MatchedProject {
  project: Project;
  titleRanges: null | number[];
}

type Project = RPCOutput["workspace"]["project"]["list"]["projects"][number];

const fuzzy = new uFuzzy({ intraMode: 1 });

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

  const candidateProjects = projects.filter(
    (project) => project.subdomain !== currentProjectSubdomain,
  );

  const matchedProjects = useMemo((): MatchedProject[] => {
    if (!search) {
      return candidateProjects.map((project) => ({
        project,
        titleRanges: null,
      }));
    }

    const haystack = candidateProjects.map((p) => p.title);
    // eslint-disable-next-line unicorn/no-array-method-this-argument
    const indexes = fuzzy.filter(haystack, search);

    if (!indexes || indexes.length === 0) {
      return [];
    }

    const info = fuzzy.info(indexes, haystack, search);
    const order = fuzzy.sort(info, haystack, search);

    return order.flatMap((orderIdx) => {
      const project = candidateProjects[info.idx[orderIdx] ?? -1];
      return project
        ? [{ project, titleRanges: info.ranges[orderIdx] ?? null }]
        : [];
    });
  }, [candidateProjects, search]);

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
      description="Search for a task to open..."
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
        } else {
          handleClose();
        }
      }}
      open={open}
      shouldFilter={false}
      title="Open Task"
    >
      <CommandInput
        onValueChange={setSearch}
        placeholder="Search tasks..."
        value={search}
      />
      <CommandList className="max-h-none! min-h-48 overflow-visible!">
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
            {search &&
              search !== "!dev" &&
              search !== "!beta" &&
              matchedProjects.length === 0 && (
                <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                  No tasks found
                </div>
              )}
            {!search && (
              <CommandGroup>
                {!isOnNewTabPage && (
                  <CommandItem onSelect={handleNewProject} value="new-project">
                    <PlusIcon className="size-4" />
                    <span>New task</span>
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
              </CommandGroup>
            )}
            {/* Only renders when "!dev" is typed exactly, so it never appears in the default list. */}
            {search === "!dev" && (
              <CommandGroup>
                <CommandItem
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
              </CommandGroup>
            )}
            {/* Only renders when "!beta" is typed exactly, so it never appears in the default list. */}
            {search === "!beta" && (
              <CommandGroup>
                <CommandItem
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
              </CommandGroup>
            )}
            {matchedProjects.length > 0 && (
              <VirtualProjectList
                matchedProjects={matchedProjects}
                onSelectProject={handleSelectProject}
              />
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function VirtualProjectList({
  matchedProjects,
  onSelectProject,
}: {
  matchedProjects: MatchedProject[];
  onSelectProject: (subdomain: ProjectSubdomain) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: matchedProjects.length,
    estimateSize: () => 36,
    getScrollElement: () => parentRef.current,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
  });

  return (
    <div className="overflow-hidden p-1">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        Tasks
      </div>
      <div
        className="overflow-y-auto"
        ref={parentRef}
        style={{ maxHeight: "280px" }}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const matched = matchedProjects[virtualItem.index];
            if (!matched) {
              return null;
            }
            const { project, titleRanges } = matched;
            return (
              <div
                className="absolute top-0 left-0 w-full"
                data-index={virtualItem.index}
                key={project.subdomain}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <CommandItem
                  onSelect={() => {
                    onSelectProject(project.subdomain);
                  }}
                  value={project.subdomain}
                >
                  <ChatCircleIcon className="size-4 shrink-0 opacity-50" />
                  <span className="flex-1 truncate text-sm">
                    <FuzzyHighlight ranges={titleRanges} text={project.title} />
                  </span>
                  <span className="text-xs text-muted-foreground/60">
                    {formatDistanceToNow(new Date(project.updatedAt), {
                      addSuffix: true,
                    }).replace(/^about /, "")}
                  </span>
                </CommandItem>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
