import { useParams } from "@tanstack/react-router";

export function useProjectRouteSubdomain() {
  // Project queries use keepPreviousData, so project.subdomain can briefly be
  // the previous project during route switches. Route params are the canonical
  // key for chat/session queries in the current project route.
  const { subdomain } = useParams({
    from: "/_app/projects/$subdomain/",
  });

  return subdomain;
}
