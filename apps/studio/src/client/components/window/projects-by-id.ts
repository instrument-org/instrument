import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";

import { type Project } from "./chats";

/** Every project in use by its id, for a tab standing on one. */
export function useProjectsById(): ReadonlyMap<string, Project> {
  const { data } = useQuery(rpcClient.workspace.projects.list.queryOptions());
  return new Map(
    (data ?? []).flatMap((project) =>
      project.retired ? [] : [[project.id, project] as const],
    ),
  );
}
