import {
  ProjectSubdomainSchema,
  type SandboxSubdomain,
} from "../schemas/subdomains";

export function projectSubdomainForSubdomain(subdomain: SandboxSubdomain) {
  const projectSubdomain = ProjectSubdomainSchema.parse(
    subdomain.split(".")[1],
  );
  return projectSubdomain;
}
