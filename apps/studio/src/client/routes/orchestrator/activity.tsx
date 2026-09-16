import { NO_ACTIVITY_FILTERS } from "@/client/components/orchestrator/activity";
import { ActivityFilterBar } from "@/client/components/orchestrator/activity-filter-bar";
import { ActivityList } from "@/client/components/orchestrator/activity-list";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useActivity } from "@/client/components/orchestrator/use-activity";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

/**
 * Activity: one record across every thread of what was asked, replied, and
 * done, newest first under day heads, in the chat's row grammar, each row a
 * door to its thread or its task. A door opens in this tab's place, the way
 * a link on any screen does; a middle or modified click asks for a tab of its
 * own. The same list sits behind the clock in the window bar, with fewer
 * filters; this page has all of them.
 */
export const Route = createFileRoute("/orchestrator/activity")({
  component: ActivityRoute,
});

function ActivityRoute() {
  const { taskId } = useOrchestrator();
  const activity = useActivity(taskId);
  const appsBySlug = useAppsBySlug();
  const [filters, setFilters] = useState(NO_ACTIVITY_FILTERS);
  useOnScreen({ screen: "activity" });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-6 pt-5 pb-10">
      <div className="mx-auto w-full max-w-3xl">
        <ActivityFilterBar
          appsBySlug={appsBySlug}
          filters={filters}
          onFiltersChange={setFilters}
          rows={activity.rows}
          topics={activity.topics}
        />
        <div className="mt-2">
          <ActivityList
            appsBySlug={appsBySlug}
            filters={filters}
            isLoading={activity.isLoading}
            rows={activity.rows}
            topics={activity.topics}
          />
        </div>
      </div>
    </div>
  );
}
