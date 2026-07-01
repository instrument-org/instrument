import { type FileRoutesByPath } from "@tanstack/react-router";

// Exclude layout routes ("") and internal debug/onboarding index routes
// (e.g. "/debug/", "/debug/components/"), which aren't real tab destinations.
export type StudioPath = Exclude<
  FileRoutesByPath[keyof FileRoutesByPath]["fullPath"],
  "" | `/debug${string}/` | `/onboarding${string}/`
>;
