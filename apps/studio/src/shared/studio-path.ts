import { type FileRoutesByPath } from "@tanstack/react-router";

// Exclude layout routes ("") and non-root index routes with trailing slash (e.g. "/debug/")
export type StudioPath = Exclude<
  FileRoutesByPath[keyof FileRoutesByPath]["fullPath"],
  "" | `${string}/${string}/`
>;
