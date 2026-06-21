import { type ProjectSubdomain } from "../../schemas/subdomains";

// Transitional shim: a task is now just its id. createAppConfig used to build a
// carrier object; it now returns the id directly so callers keep compiling
// until the subdomain→id rename removes it entirely.
export function createAppConfig({
  subdomain,
}: {
  subdomain: ProjectSubdomain;
}): ProjectSubdomain {
  return subdomain;
}
