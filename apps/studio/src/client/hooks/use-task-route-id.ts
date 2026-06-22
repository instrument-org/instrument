import { useParams } from "@tanstack/react-router";

export function useTaskRouteId() {
  // Task queries use keepPreviousData, so task.id can briefly be
  // the previous task during route switches. Route params are the canonical
  // key for chat/session queries in the current task route.
  const { id } = useParams({
    from: "/_app/tasks/$id/",
  });

  return id;
}
