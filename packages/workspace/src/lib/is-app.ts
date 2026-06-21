import {
  type ProjectSubdomain,
  ProjectSubdomainSchema,
} from "../schemas/subdomains";

export function isProjectSubdomain(
  subdomain: string,
): subdomain is ProjectSubdomain {
  return ProjectSubdomainSchema.safeParse(subdomain).success;
}
