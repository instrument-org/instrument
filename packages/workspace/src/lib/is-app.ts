import {
  type PreviewSubdomain,
  PreviewSubdomainSchema,
  type ProjectSubdomain,
  ProjectSubdomainSchema,
} from "../schemas/subdomains";

export function isPreviewSubdomain(
  subdomain: string,
): subdomain is PreviewSubdomain {
  return PreviewSubdomainSchema.safeParse(subdomain).success;
}

export function isProjectSubdomain(
  subdomain: string,
): subdomain is ProjectSubdomain {
  return ProjectSubdomainSchema.safeParse(subdomain).success;
}
