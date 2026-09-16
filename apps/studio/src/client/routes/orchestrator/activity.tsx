import {
  orchestratorRecentsAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  groupRowsByDay,
  matchesActivityFilters,
  mergeRows,
  NO_ACTIVITY_FILTERS,
  visitsOf,
} from "@/client/components/orchestrator/activity";
import { ActivityFilterBar } from "@/client/components/orchestrator/activity-filter-bar";
import { ActivityRow } from "@/client/components/orchestrator/activity-row";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import {
  OrchestratorContext,
  useOrchestrator,
} from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useNow } from "@/client/components/orchestrator/use-now";
import { PageOpenContext } from "@/client/components/page-open-context";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Fragment, useContext, useState } from "react";

/**
 * Activity: one record across every thread of what was asked, replied, and
 * done, newest first under day heads, in the chat's row grammar, each row a
 * door to its thread or its task. The threads' side comes from the workspace,
 * read out of their messages; the user's own visits are what this window
 * remembers showing them, merged in here, since the workspace never sees
 * them.
 */
export const Route = createFileRoute("/orchestrator/activity")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const orchestrator = useOrchestrator();
  const { taskId } = orchestrator;
  const log = useQuery(
    rpcClient.workspace.orchestrator.activityLog.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const topics = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: { id: taskId },
    }),
  );
  const appsBySlug = useAppsBySlug();
  const recents = useAtomValue(orchestratorRecentsAtom);
  const pages = useAtomValue(visitedPagesAtom);
  const openFile = useContext(FileOpenContext);
  const now = useNow();
  const [filters, setFilters] = useState(NO_ACTIVITY_FILTERS);
  useOnScreen({ screen: "activity" });

  const rows = mergeRows(log.data ?? [], visitsOf(recents, pages));
  const shown = rows.filter((row) => matchesActivityFilters(row, filters));
  const groups = groupRowsByDay(shown, now);
  const topicsById = new Map(
    (topics.data ?? []).map((topic) => [topic.id, topic]),
  );

  return (
    // Activity is a tab, so what a row opens goes in a tab beside it rather
    // than in its place: the openers all say so.
    <OrchestratorContext
      value={{
        ...orchestrator,
        openPage: (url) => {
          orchestrator.openPage(url, { newTab: true });
        },
        openScreen: (href) => {
          orchestrator.openScreen(href, { newTab: true });
        },
        opensNewTab: true,
      }}
    >
      <FileOpenContext
        value={(path) => {
          openFile?.(path, { newTab: true });
        }}
      >
        <PageOpenContext
          value={(url) => {
            orchestrator.openPage(url, { newTab: true });
          }}
        >
          <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 pt-5 pb-10">
            <div className="mx-auto w-full max-w-3xl">
              <ActivityFilterBar
                appsBySlug={appsBySlug}
                filters={filters}
                onFiltersChange={setFilters}
                rows={rows}
                topics={topics.data ?? []}
              />
              {log.data === undefined ? (
                <div className="flex justify-center py-10">
                  <Spinner className="size-5" />
                </div>
              ) : groups.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nothing has happened yet."
                    : "Nothing matches."}
                </p>
              ) : (
                <div className="mt-2">
                  {groups.map(([label, group]) => (
                    <Fragment key={label}>
                      <p className="flex items-center gap-3 px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        <span className="h-px flex-1 bg-border" />
                        {label}
                        <span className="h-px flex-1 bg-border" />
                      </p>
                      {group.map((row) => (
                        <ActivityRow
                          appsBySlug={appsBySlug}
                          key={row.id}
                          row={row}
                          topicsById={topicsById}
                        />
                      ))}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        </PageOpenContext>
      </FileOpenContext>
    </OrchestratorContext>
  );
}
